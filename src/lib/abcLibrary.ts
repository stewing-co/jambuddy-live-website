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
