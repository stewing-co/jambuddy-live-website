// JamBuddy's ABC library: tunes gathered into github.com/stewing-co/jambuddy-abc, grouped by
// genre. Pages read the repo's collections.json at build time; tune search and sheet music are
// fetched from GitHub in the browser.

export const LIBRARY_BASE = 'https://raw.githubusercontent.com/stewing-co/jambuddy-abc/main/';

export type LibraryFile = { path: string; tunes: number; first: string };
export type LibrarySource = { id: string; name: string; origin?: string | string[] | null; tunes: number; files: LibraryFile[] };
export type LibraryGenre = { genre: string; name: string; tunes: number; sources: LibrarySource[] };

let cached: Promise<LibraryGenre[]> | null = null;

export function loadLibrary(): Promise<LibraryGenre[]> {
  cached ??= fetch(`${LIBRARY_BASE}index/collections.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => (data?.version === 1 && Array.isArray(data.genres) ? data.genres : []))
    .catch((error) => {
      // A GitHub outage shouldn't break the whole site build; the library pages say it's unavailable.
      console.warn(`ABC library unavailable: ${error}`);
      return [];
    });
  return cached;
}

/** Viewer link for a repo file (path like "sources/norbeck/i/hnr0.abc"), optionally at tune X.
 *  [genre] keeps that genre selected in the collection picker. */
export function viewerHref(path: string, x?: string, genre?: string) {
  const params = new URLSearchParams({ src: path });
  if (x) params.set('tune', x);
  if (genre) params.set('genre', genre);
  return `/abc/library/view?${params}`;
}

export function originUrl(origin: LibrarySource['origin']) {
  const first = Array.isArray(origin) ? origin[0] : origin;
  return typeof first === 'string' && /^https?:\/\//.test(first) ? first : null;
}

// Collection picker: genres, each with JamBuddy's bundled collections and the library's tunebooks.
export type PickerOption = { label: string; href: string; src?: string };
export type PickerGroup = { label: string; options: PickerOption[] };
export type PickerGenre = { genre: string; name: string; groups: PickerGroup[] };

type BookSource = { id: string; name: string; books: { label: string; path: string; tunes: number }[] };

let books: Promise<{ genre: string; name: string; sources: BookSource[] }[]> | null = null;

function loadBooks() {
  books ??= fetch(`${LIBRARY_BASE}index/books.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => (data?.version === 1 && Array.isArray(data.genres) ? data.genres : []))
    .catch((error) => {
      console.warn(`ABC library tunebooks unavailable: ${error}`);
      return [];
    });
  return books;
}

export const collectionHref = (slug: string) => (slug === 'old-time-jam-tunes' ? '/abc' : `/abc/${slug}`);

/** Genres for the collection picker; [bundled] are JamBuddy's own collections. */
export async function loadPickerGenres(
  bundled: { slug: string; title: string; genre: string }[]
): Promise<PickerGenre[]> {
  const genres = await loadBooks();
  const result: PickerGenre[] = genres.map((genre) => ({
    genre: genre.genre,
    name: genre.name,
    groups: [
      { label: 'JamBuddy', options: bundled.filter((c) => c.genre === genre.genre).map((c) => ({ label: c.title, href: collectionHref(c.slug) })) },
      ...genre.sources.map((source) => ({
        label: source.name,
        options: source.books.map((book) => ({
          label: `${book.label} (${book.tunes.toLocaleString('en-US')})`,
          href: viewerHref(book.path, undefined, genre.genre),
          src: book.path
        }))
      }))
    ].filter((group) => group.options.length > 0)
  }));
  // Without the library (GitHub unreachable at build time), still offer the bundled collections.
  if (!result.length) {
    for (const genre of [...new Set(bundled.map((c) => c.genre))]) {
      result.push({ genre, name: genre.charAt(0).toUpperCase() + genre.slice(1), groups: [{ label: 'JamBuddy', options:
        bundled.filter((c) => c.genre === genre).map((c) => ({ label: c.title, href: collectionHref(c.slug) })) }] });
    }
  }
  return result;
}
