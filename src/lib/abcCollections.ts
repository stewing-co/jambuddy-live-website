import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AbcCollectionMeta = {
  slug: string;
  title: string;
  filename: string;
};

export type AbcTuneSearchEntry = {
  collectionSlug: string;
  collectionTitle: string;
  x: string;
  title: string;
  titles: string[];
  searchText: string;
  headers: Record<string, string[]>;
};

export const ABC_COLLECTIONS: AbcCollectionMeta[] = [
  { slug: 'old-time-jam-tunes', title: 'JamBuddy (Old-Time)', filename: 'old_time_jam_tunes_collection.abc' },
  { slug: 'bluegrass-jam-tunes', title: 'JamBuddy (Bluegrass)', filename: 'bluegrass_jam_tunes_collection.abc' },
  { slug: 'irish-session-top100', title: 'The Session (Irish)', filename: 'irish_session_top100_collection.abc' },
  { slug: 'mandozine', title: 'Mandozine (Various)', filename: 'mandozine.abc' },
  { slug: 'practice-techniques', title: 'Practice Techniques', filename: 'practice.abc' },
  { slug: 'open-hymnal', title: 'Open Hymnal (Christian)', filename: 'open_hymnal_collection.abc' },
  { slug: 'roaring-jelly-2024', title: 'Roaring Jelly (Old-Time)', filename: 'roaring_jelly_collection.abc' },
  { slug: 'nigel-gatherer-collection', title: 'Nigel Gatherer (Various)', filename: 'nigel_gatherer_collection.abc' },
  { slug: 'antifascist', title: 'JamBuddy (Antifascist)', filename: 'antifascist_collection.abc' },
  { slug: 'everyday-songbook-1927', title: 'Everyday Songbook 1927 (Various)', filename: 'everyday_songbook.abc' },
  { slug: 'richard-robinsons-tunebook', title: 'Richard Robinsons Tunebook (Various)', filename: 'richard_robinsons_tunebook.abc' }
];

export const ABC_FILENAME_MAP = Object.fromEntries(
  ABC_COLLECTIONS.map((collection) => [collection.slug, collection.filename])
) as Record<string, string>;

export const ABC_TITLE_MAP = Object.fromEntries(
  ABC_COLLECTIONS.map((collection) => [collection.slug, collection.title])
) as Record<string, string>;

const currentDir = fileURLToPath(new URL('.', import.meta.url));

const searchRoots = [
  '../../public/collections',
  '../public/collections',
  './public/collections',
  'public/collections',
  '../../../jb_android/app/src/main/assets/tunes',
  '../../../jb_ios/jb_ios/Resources/Tunes'
];

export function loadCollection(slug: string) {
  const filename = ABC_FILENAME_MAP[slug];
  if (!filename) {
    return { content: null as string | null, attempts: [] as string[], source: null as string | null };
  }

  const attempts: string[] = [];
  let projectRoot = currentDir;
  let depth = 0;
  const maxDepth = 10;

  while (depth < maxDepth) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const directPath = path.join(projectRoot, 'public', 'collections', filename);
      if (!attempts.includes(directPath)) {
        attempts.push(directPath);
      }
      if (fs.existsSync(directPath)) {
        try {
          const content = fs.readFileSync(directPath, 'utf8');
          return { content, attempts, source: directPath };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attempts[attempts.length - 1] = `${directPath} (read failed: ${message})`;
        }
      }
      break;
    }
    projectRoot = path.dirname(projectRoot);
    depth += 1;
  }

  for (const root of searchRoots) {
    const candidate = path.resolve(currentDir, root, filename);
    if (!attempts.includes(candidate)) {
      attempts.push(candidate);
    }

    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const content = fs.readFileSync(candidate, 'utf8');
      return { content, attempts, source: candidate };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts[attempts.length - 1] = `${candidate} (read failed: ${message})`;
    }
  }

  return { content: null as string | null, attempts, source: null as string | null };
}

function normalizeSortTitle(title: string) {
  const trimmed = (title || '').trim();
  const stripped = trimmed.replace(/^(?:the|an|a)\s+/i, '');
  return (stripped || trimmed).toLocaleLowerCase();
}

export function parseTunesFromAbc(abcText: string, collectionSlug: string, collectionTitle: string): AbcTuneSearchEntry[] {
  const lines = (abcText || '').split(/\r?\n/);
  const tunes: AbcTuneSearchEntry[] = [];
  let current: Omit<AbcTuneSearchEntry, 'searchText'> & { searchText?: string } | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const titleTokens = [...current.titles, current.title, current.x].filter(Boolean);
    tunes.push({
      ...current,
      searchText: titleTokens.join(' ').toLocaleLowerCase()
    });
  };

  for (const line of lines) {
    const xMatch = line.match(/^X:\s*(\d+)/);
    if (xMatch) {
      pushCurrent();
      current = {
        collectionSlug,
        collectionTitle,
        x: xMatch[1],
        title: 'Untitled',
        titles: [],
        headers: {}
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const titleMatch = line.match(/^T:\s*(.+)/);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      if (title) {
        current.titles.push(title);
        if (current.title === 'Untitled') {
          current.title = title;
        }
      }
    }

    const headerMatch = line.match(/^([A-Za-z]):\s*(.*)$/);
    if (headerMatch) {
      const header = headerMatch[1].toUpperCase();
      const value = (headerMatch[2] || '').trim();
      if (header !== 'X' && header !== 'T' && value) {
        const existing = current.headers[header] || [];
        if (!existing.includes(value)) {
          current.headers[header] = [...existing, value];
        }
      }
    }
  }

  pushCurrent();

  tunes.sort((a, b) => {
    const titleA = normalizeSortTitle(a.title);
    const titleB = normalizeSortTitle(b.title);
    if (titleA < titleB) return -1;
    if (titleA > titleB) return 1;
    const xA = Number(a.x) || 0;
    const xB = Number(b.x) || 0;
    return xA - xB;
  });

  return tunes;
}

export function buildAllCollectionSearchIndex() {
  const entries: AbcTuneSearchEntry[] = [];
  for (const collection of ABC_COLLECTIONS) {
    const { content } = loadCollection(collection.slug);
    if (!content) continue;
    entries.push(...parseTunesFromAbc(content, collection.slug, collection.title));
  }
  return entries;
}
