// Searches JamBuddy's ABC tune library (github.com/stewing-co/jambuddy-abc) in the browser.
// Each genre's search index is downloaded the first time it's needed (all genres together are
// about 9 MB compressed) and kept in memory for the rest of the visit.
(function () {
  const BASE = 'https://raw.githubusercontent.com/stewing-co/jambuddy-abc/main/';
  const genreTunes = new Map();
  let manifest = null;

  const normalize = (text) => String(text || '').normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  function fetchJson(url) {
    return fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function loadManifest() {
    manifest ??= fetchJson(`${BASE}index/genres.json`).catch((error) => {
      manifest = null; // Retry on the next search.
      throw error;
    });
    return manifest;
  }

  function loadGenre(id) {
    if (!genreTunes.has(id)) {
      genreTunes.set(id, fetchJson(`${BASE}index/search/${id}.json`)
        .then((data) => (data.tunes || []).map((tune) => ({ ...tune, genre: id, search: tune.titles.map(normalize) })))
        .catch((error) => {
          genreTunes.delete(id);
          throw error;
        }));
    }
    return genreTunes.get(id);
  }

  // Same ranking as the app: exact title, then "the"-insensitive, prefix, all words.
  // Returns [rank, index of the best-matching title], or null.
  function rank(titles, query, words) {
    let best = null;
    titles.forEach((title, index) => {
      const r = title === query ? 0
        : title.replace(/^the /, '') === query.replace(/^the /, '') ? 1
        : title.startsWith(query) ? 2
        : words.every((word) => title.includes(word)) ? 3 : null;
      if (r !== null && (best === null || r < best[0])) best = [r, index];
    });
    return best;
  }

  function viewerHref(tune) {
    const params = new URLSearchParams({
      src: decodeURIComponent(tune.url.slice(BASE.length)), tune: String(tune.x), n: String(tune.ordinal), genre: tune.genre
    });
    return `/abc/library/view?${params}`;
  }

  /**
   * Resolves to { total, results, failedGenres }. Results carry title, genreName, sourceName and
   * href (a viewer link). [genres] limits the search to those genre ids; default is all.
   */
  async function search(query, { genres = null, limit = 100 } = {}) {
    const normalized = normalize(query);
    if (!normalized) return { total: 0, results: [], failedGenres: [] };
    const info = await loadManifest();
    const ids = genres || (info.genres || []).map((genre) => genre.genre);
    const names = Object.fromEntries((info.genres || []).map((genre) => [genre.genre, genre.name]));
    const loaded = await Promise.allSettled(ids.map(loadGenre));
    const failedGenres = ids.filter((_, index) => loaded[index].status === 'rejected');
    if (failedGenres.length === ids.length) throw new Error('Tune library unavailable');
    const words = normalized.split(' ');
    const hits = [];
    for (const result of loaded) {
      if (result.status !== 'fulfilled') continue;
      for (const tune of result.value) {
        const match = rank(tune.search, normalized, words);
        if (match) hits.push([match[0], tune, match[1]]);
      }
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].search[a[2]].localeCompare(b[1].search[b[2]]));
    return {
      total: hits.length,
      failedGenres,
      // Show the title that matched; a tune's first title can be unrelated to the query.
      results: hits.slice(0, limit).map(([, tune, index]) => ({
        title: tune.titles[index], genre: tune.genre, genreName: names[tune.genre] || tune.genre,
        sourceName: (info.sources || {})[tune.source] || tune.source, href: viewerHref(tune)
      }))
    };
  }

  /** Wires a search box to a result list (used by the library pages). */
  function attach({ input, status, list, genres = null, showGenre = false, limit = 100 }) {
    let timer = null;
    let latest = 0;
    async function run() {
      const run = ++latest;
      const query = input.value;
      list.replaceChildren();
      if (!normalize(query)) { status.textContent = ''; return; }
      status.textContent = 'Searching…';
      let found;
      try {
        found = await search(query, { genres, limit });
      } catch (error) {
        if (run === latest) status.textContent = 'Could not load the tune library. Please try again later.';
        return;
      }
      if (run !== latest) return; // A newer search replaced this one.
      status.textContent = (found.total > limit ? `Showing ${limit} of ${found.total} matches` : `${found.total} matches`)
        + (found.failedGenres.length ? ' (some genres could not be loaded)' : '');
      for (const tune of found.results) {
        const item = document.createElement('li');
        item.className = 'py-1.5 text-sm';
        const link = document.createElement('a');
        link.href = tune.href;
        link.className = 'text-blue-300 hover:text-blue-200';
        link.textContent = tune.title;
        const meta = document.createElement('span');
        meta.className = 'text-gray-500';
        meta.textContent = ` · ${showGenre ? `${tune.genreName} · ` : ''}${tune.sourceName}`;
        item.append(link, meta);
        list.append(item);
      }
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
    // Start downloading as soon as someone heads for the search box.
    input.addEventListener('focus', () => {
      loadManifest().then((info) => (genres || (info.genres || []).map((g) => g.genre)).forEach((id) => loadGenre(id).catch(() => {})))
        .catch(() => {});
    }, { once: true });
  }

  window.JamBuddyLibrary = { search, attach, normalize };
})();
