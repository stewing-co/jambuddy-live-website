// All-tunes collections: every tune of a genre once, with its versions and where they're from.
// The library's index/tunes/<genre>.json lists its tunes; JamBuddy's own collections add the
// versions the library doesn't already have (same notes, ignoring chords and decorations).
import { createHash } from 'node:crypto';
import { ABC_COLLECTIONS, loadCollection } from './abcCollections';
import { fetchIndexJson, LIBRARY_BASE } from './abcLibrary';

type LibraryVersion = { id: string; file: number; n: number; x: string; key: string; source: string; fp: string; also?: string[] };
type LibraryTune = { id: string; match: string; title: string; type: string; titles?: string[]; versions: LibraryVersion[] };
type LibraryTuneList = { genre: string; name: string; sources: Record<string, string>; files: string[]; tunes: LibraryTune[] };

/** A version: [id, file index, tune position in the file, key, source id, sources with identical copies]. */
export type GenreVersion = [string, number, number, string, string, string[]?];
/** A tune: [id, title, type, other titles, versions]. */
export type GenreTune = [string, string, string, string[], GenreVersion[]];
export type GenreTuneList = {
  version: 1;
  genre: string;
  name: string;
  /** Library files are relative to [base]; JamBuddy's collections start with "/". */
  base: string;
  files: string[];
  sources: Record<string, string>;
  tunes: GenreTune[];
};

// Ports of jambuddy-abc's scripts/build_index.py, so JamBuddy's tunes group and de-duplicate the
// same way as the library's.
const CATEGORIES: [string, RegExp][] = [
  ['slip jig', /slip ?jig/], ['hop jig', /hop ?jig/], ['single jig', /single ?jig/],
  ['jig', /jig|jigg/], ['reel', /reel/], ['hornpipe', /hornpipe/], ['polka', /polka/],
  ['slide', /slide/], ['strathspey', /strathspey/], ['waltz', /waltz|vals/],
  ['mazurka', /mazurka/], ['barndance', /barn ?dance|fling|highland/],
  ['three-two', /three[- ]?two|3\/2/], ['march', /march/], ['schottische', /schottis/],
  ['polska', /polska/], ['set dance', /set ?dance/], ['air', /air|lament|song|ballad/],
  ['morris', /morris/], ['carol', /carol/]
];
const METER_CATEGORIES: Record<string, string> = { '6/8': 'jig', '9/8': 'slip jig', '12/8': 'slide' };
const MODES: Record<string, string> = { '': 'maj', maj: 'maj', major: 'maj', ion: 'maj', ionian: 'maj',
  m: 'min', min: 'min', minor: 'min', aeo: 'min', aeolian: 'min', dor: 'dor', dorian: 'dor',
  mix: 'mix', mixolydian: 'mix', phr: 'phr', phrygian: 'phr', lyd: 'lyd', lydian: 'lyd', loc: 'loc', locrian: 'loc' };

const fields = (text: string, key: string) =>
  [...text.matchAll(new RegExp(`^${key}:\\s*([^\\r\\n]+)`, 'gm'))].map((match) => match[1].trim());

function category(rhythm: string, meter: string) {
  const lower = rhythm.toLowerCase();
  for (const [name, pattern] of CATEGORIES) if (pattern.test(lower)) return name;
  return METER_CATEGORIES[meter.replace(/ /g, '')] ?? 'other';
}

function normalizeKey(key: string) {
  const match = key.match(/^\s*([A-Ga-g])([#b]?)\s*([A-Za-z]*)/);
  if (!match) return key.trim();
  const mode = match[3].toLowerCase();
  return match[1].toUpperCase() + match[2] + (MODES[mode] ?? mode.slice(0, 3));
}

export function normalizeTitle(title: string) {
  let text = title.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
  text = text.replace(/\(.*?\)|\[.*?\]/g, ' ');
  text = text.trim().replace(/^(the|an|a)\s+|,\s*(the|an|a)$/, '');
  return text.replace(/[^a-z0-9]+/g, ' ').trim();
}

function fingerprint(part: string) {
  const header = fields(part, 'K').slice(0, 1).map(normalizeKey).join(' ') + '|' + fields(part, 'L').slice(0, 1).join('');
  let body = part.split('\n').filter((line) => !/^(?:[A-Za-z]:|%)/.test(line)).join('\n');
  body = body.replace(/"[^"]*"|![^!\n]*!|\+[^+\n]*\+|\{[^}]*\}|[~.HLMOPSTuv]/g, '');
  body = body.replace(/[\s\\]|\[?\|+\]?|:/g, '');
  return { notes: body, fp: createHash('sha256').update(header + body).digest('hex').slice(0, 24) };
}

/** Tunes of an ABC file, numbered as the library numbers them (and the viewer finds them). */
export function splitTunes(text: string) {
  const parts = text.replace(/\r\n?/g, '\n').replace(/^\ufeff/, '').split(/(?=^X:\s*\S)/m);
  // Drop the file header before the first tune (JavaScript, unlike Python, yields no empty one).
  return /^X:\s*\S/.test(parts[0] ?? '') ? parts : parts.slice(1);
}

const hash = (text: string, length: number) => createHash('sha256').update(text).digest('hex').slice(0, length);

let libraryLists: Promise<Map<string, LibraryTuneList>> | null = null;

/** Every genre's library tune list, by genre id; empty when the library can't be reached. */
function loadLibraryLists() {
  libraryLists ??= fetchIndexJson('genres.json')
    .then((manifest) => Promise.all((manifest.genres || []).map((genre: { genre: string }) =>
      fetchIndexJson(`tunes/${genre.genre}.json`).then((list: LibraryTuneList) => [genre.genre, list] as const))))
    .then((entries) => new Map(entries))
    .catch((error) => {
      console.warn(`ABC library tune lists unavailable: ${error}`);
      return new Map<string, LibraryTuneList>();
    });
  return libraryLists;
}

let genreLists: Promise<Map<string, GenreTuneList>> | null = null;

/** Every genre's all-tunes list: the library's tunes plus JamBuddy's versions it lacks. */
export function loadGenreTuneLists() {
  genreLists ??= loadLibraryLists().then((library) => {
    const known = new Set<string>();
    for (const list of library.values()) for (const tune of list.tunes) for (const version of tune.versions) known.add(version.fp);
    const genres = new Set([...library.keys(), ...ABC_COLLECTIONS.map((c) => c.genre)]);
    const result = new Map<string, GenreTuneList>();
    for (const genre of genres) {
      const list = library.get(genre);
      const files = [...(list?.files ?? [])];
      const sources: Record<string, string> = { ...(list?.sources ?? {}) };
      type Entry = { id: string; match: string; title: string; type: string; titles: string[]; versions: GenreVersion[] };
      const tunes: Entry[] = (list?.tunes ?? []).map((tune) => ({
        id: tune.id, match: tune.match, title: tune.title, type: tune.type, titles: tune.titles ?? [],
        versions: tune.versions.map((v) => [v.id, v.file, v.n, v.key, v.source, ...(v.also ? [v.also] : [])] as GenreVersion)
      }));
      const byMatch = new Map(tunes.map((tune) => [tune.match, tune]));
      const byTitle = new Map<string, Entry[]>();
      for (const tune of tunes) {
        const title = tune.match.split('|')[0];
        byTitle.set(title, [...(byTitle.get(title) ?? []), tune]);
      }
      for (const collection of ABC_COLLECTIONS.filter((c) => c.genre === genre)) {
        const { content } = loadCollection(collection.slug);
        if (!content) continue;
        const source = `jambuddy:${collection.slug}`;
        let file = -1;
        splitTunes(content).forEach((part, ordinal) => {
          const title = fields(part, 'T')[0];
          const key = fields(part, 'K')[0];
          const { notes, fp } = fingerprint(part);
          // Skip header-only placeholders, and tunes the library already has.
          if (!title || !key || (notes.match(/[A-Ga-g]/g) ?? []).length < 8 || known.has(fp)) return;
          known.add(fp);
          if (file < 0) {
            file = files.push(`/collections/${collection.filename}`) - 1;
            sources[source] = collection.title;
          }
          const name = normalizeTitle(title);
          const type = category(fields(part, 'R')[0] ?? '', fields(part, 'M')[0] ?? '');
          // An untyped tune joins the title's best-known typed tune; a typed one joins the untyped tune.
          const sameTitle = (byTitle.get(name) ?? []).sort((a, b) => b.versions.length - a.versions.length);
          let tune = byMatch.get(`${name}|${type}`)
            ?? (type === 'other' ? sameTitle[0] : sameTitle.find((t) => t.type === 'other'));
          if (!tune) {
            tune = { id: `jb${hash(`${name}|${type}`, 14)}`, match: `${name}|${type}`, title, type, titles: [], versions: [] };
            tunes.push(tune);
            byMatch.set(tune.match, tune);
            byTitle.set(name, [...sameTitle, tune]);
          }
          if (tune.type === 'other') tune.type = type;
          tune.versions.push([`jb${hash(`${collection.slug}#${ordinal}`, 6)}`, file, ordinal, normalizeKey(key), source]);
        });
      }
      if (!tunes.length) continue;
      // Versions most collections share first, then by source; JamBuddy's are mixed in with the rest.
      const sourceName = (id: string) => (sources[id] ?? id).toLowerCase();
      for (const tune of tunes) {
        tune.versions.sort((a, b) => (b[5]?.length ?? 0) - (a[5]?.length ?? 0)
          || sourceName(a[4]).localeCompare(sourceName(b[4])) || a[1] - b[1] || a[2] - b[2]);
      }
      // Titles that are only notes or numbers ("?", "[Unknown]", "1") go last.
      const unnamed = (title: string) => (/[a-z]/.test(normalizeTitle(title)) ? 0 : 1);
      tunes.sort((a, b) => unnamed(a.title) - unnamed(b.title)
        || (normalizeTitle(a.title) || a.title).localeCompare(normalizeTitle(b.title) || b.title) || a.type.localeCompare(b.type));
      result.set(genre, {
        version: 1,
        genre,
        name: list?.name ?? genre.charAt(0).toUpperCase() + genre.slice(1),
        base: LIBRARY_BASE,
        files,
        sources,
        tunes: tunes.map((tune) => [tune.id, tune.title, tune.type, tune.titles, tune.versions])
      });
    }
    return result;
  });
  return genreLists;
}
