// Searches JamBuddy's ABC tune library (github.com/stewing-co/jambuddy-abc) in the browser.
// Each genre's search index is downloaded the first time it's needed (all genres together are
// about 9 MB compressed) and kept in memory for the rest of the visit.
(function () {
  const BASE = 'https://raw.githubusercontent.com/stewing-co/jambuddy-abc/main/';
  const PAGE = 100;
  const genreTunes = new Map();
  let manifest = null;

  const normalize = (text) => String(text || '').normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // A title without its bracketed notes ("(hornpipe) (ONMI)") and articles ("The", ", The").
  const core = (text) => normalize(String(text || '').replace(/\(.*?\)|\[.*?\]/g, ' '))
    .replace(/^(the|an|a) /, '').replace(/ (the|an|a)$/, '');

  // Tune types and keys, normalized the way the library's index is (scripts/build_index.py).
  // Most specific names first: "slip jig" must not match "jig".
  const CATEGORIES = [
    ['slip jig', /slip ?jig/], ['hop jig', /hop ?jig/], ['single jig', /single ?jig/],
    ['jig', /jig|jigg/], ['reel', /reel/], ['hornpipe', /hornpipe/], ['polka', /polka/],
    ['slide', /slide/], ['strathspey', /strathspey/], ['waltz', /waltz|vals/],
    ['mazurka', /mazurka/], ['barndance', /barn ?dance|fling|highland/],
    ['three-two', /three[- ]?two|3\/2/], ['march', /march/], ['schottische', /schottis/],
    ['polska', /polska/], ['set dance', /set ?dance/], ['air', /air|lament|song|ballad/],
    ['morris', /morris/], ['carol', /carol/]
  ];
  const METER_CATEGORIES = { '6/8': 'jig', '9/8': 'slip jig', '12/8': 'slide' };
  const MODES = { '': 'maj', maj: 'maj', major: 'maj', ion: 'maj', ionian: 'maj',
    m: 'min', min: 'min', minor: 'min', aeo: 'min', aeolian: 'min', dor: 'dor', dorian: 'dor',
    mix: 'mix', mixolydian: 'mix', phr: 'phr', phrygian: 'phr', lyd: 'lyd', lydian: 'lyd', loc: 'loc', locrian: 'loc' };
  const MODE_NAMES = { maj: 'major', min: 'minor', dor: 'dorian', mix: 'mixolydian', phr: 'phrygian', lyd: 'lydian', loc: 'locrian' };

  function category(rhythm, meter) {
    const lower = String(rhythm || '').toLowerCase();
    for (const [name, pattern] of CATEGORIES) if (pattern.test(lower)) return name;
    return METER_CATEGORIES[String(meter || '').replace(/\s+/g, '')] || 'other';
  }

  /** "G", "Gmaj", "G major" → "Gmaj"; "Ador" → "Ador". Unparseable keys (K:none, K:HP) → ''. */
  function normalizeKey(key) {
    const match = String(key || '').match(/^\s*([A-Ga-g])([#b]?)\s*([A-Za-z]*)/);
    if (!match) return '';
    const mode = MODES[match[3].toLowerCase()] ?? MODES[match[3].toLowerCase().slice(0, 3)];
    return mode ? match[1].toUpperCase() + match[2] + mode : '';
  }

  /** "Gmaj" → "G major", "F#min" → "F♯ minor". */
  function keyLabel(key) {
    const match = String(key || '').match(/^([A-G][#b]?)([a-z]{3})$/);
    if (!match) return key;
    return `${match[1].replace('#', '♯').replace('b', '♭')} ${MODE_NAMES[match[2]] || match[2]}`;
  }

  const typeLabel = (type) => (type ? type.charAt(0).toUpperCase() + type.slice(1) : type);

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
        .then((data) => (data.tunes || []).map((tune) => ({
          ...tune, genre: id,
          search: tune.titles.map(normalize), cores: tune.titles.map(core)
        })))
        .catch((error) => {
          genreTunes.delete(id);
          throw error;
        }));
    }
    return genreTunes.get(id);
  }

  /**
   * Ranks titles against a query: exact title (ignoring articles and bracketed notes), then title
   * prefix, then every word starting a word of the title, then every word anywhere in the title.
   * [titles] and [cores] are normalize()d and core()d titles. Returns [rank, title index], or null.
   */
  function rank(titles, cores, query) {
    const queryCore = query.core || query.text;
    let best = null;
    titles.forEach((title, index) => {
      const titleCore = cores ? cores[index] : title;
      const r = title === query.text || titleCore === queryCore ? 0
        : title.startsWith(query.text) || titleCore.startsWith(queryCore) ? 1
        : query.words.every((word) => title.startsWith(word) || title.includes(` ${word}`)) ? 2
        : query.words.every((word) => title.includes(word)) ? 3 : null;
      if (r !== null && (best === null || r < best[0])) best = [r, index];
    });
    return best;
  }

  /** Prepares a query for rank(); null when it has no searchable text. */
  function parseQuery(text) {
    const normalized = normalize(text);
    if (!normalized) return null;
    return { text: normalized, core: core(text), words: normalized.split(' ') };
  }

  function viewerHref(tune) {
    const params = new URLSearchParams({
      src: decodeURIComponent(tune.url.slice(BASE.length)), tune: String(tune.x), n: String(tune.ordinal), genre: tune.genre
    });
    return `/abc/library/view?${params}`;
  }

  /**
   * Resolves to { total, results, failedGenres, keys, types }. Results carry title, genreName,
   * sourceName, type, key and href (a viewer link). [genres] limits the search to those genre ids
   * (default all); [type] and [key] keep only tunes of that category and normalized key. With
   * filters but no query, lists every matching tune by title. [keys] and [types] count the tunes
   * matching the query for each key and type, for filter menus.
   */
  async function search(text, { genres = null, limit = PAGE, type = '', key = '' } = {}) {
    const query = parseQuery(text);
    if (!query && !type && !key) return { total: 0, results: [], failedGenres: [], keys: {}, types: {} };
    const info = await loadManifest();
    const ids = genres || (info.genres || []).map((genre) => genre.genre);
    const names = Object.fromEntries((info.genres || []).map((genre) => [genre.genre, genre.name]));
    const loaded = await Promise.allSettled(ids.map(loadGenre));
    const failedGenres = ids.filter((_, index) => loaded[index].status === 'rejected');
    if (failedGenres.length === ids.length) throw new Error('Tune library unavailable');
    const hits = [];
    const keys = {};
    const types = {};
    for (const result of loaded) {
      if (result.status !== 'fulfilled') continue;
      for (const tune of result.value) {
        const match = query ? rank(tune.search, tune.cores, query) : [0, 0];
        if (!match) continue;
        // Facet counts ignore their own filter so the menus offer every alternative.
        if (!type || tune.category === type) keys[tune.key || ''] = (keys[tune.key || ''] || 0) + 1;
        if (!key || tune.key === key) types[tune.category || ''] = (types[tune.category || ''] || 0) + 1;
        if ((type && tune.category !== type) || (key && tune.key !== key)) continue;
        hits.push([match[0], tune, match[1]]);
      }
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].cores[a[2]].localeCompare(b[1].cores[b[2]]));
    delete keys[''];
    delete types[''];
    return {
      total: hits.length,
      failedGenres,
      keys,
      types,
      // Show the title that matched; a tune's first title can be unrelated to the query.
      results: hits.slice(0, limit).map(([, tune, index]) => ({
        title: tune.titles[index], genre: tune.genre, genreName: names[tune.genre] || tune.genre,
        sourceName: (info.sources || {})[tune.source] || tune.source, type: tune.category || '', key: tune.key || '',
        href: viewerHref(tune)
      }))
    };
  }

  /** Fills a filter <select> with "[anyLabel]" and the counted values, keeping [selected]. */
  function fillSelect(select, counts, anyLabel, label, selected) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (selected && !(selected in counts)) entries.unshift([selected, 0]);
    select.replaceChildren(new Option(anyLabel, ''),
      ...entries.map(([value, count]) => new Option(count ? `${label(value)} (${count.toLocaleString('en-US')})` : label(value), value)));
    select.value = selected || '';
  }

  /**
   * Wires a search box, optional type/key/genre filter menus and a "show more" button to a result
   * list (used by the library pages). The search and filters are kept in the page URL.
   */
  function attach({ input, status, list, more = null, typeSelect = null, keySelect = null, genreSelect = null,
    genres = null, showGenre = false }) {
    let timer = null;
    let latest = 0;
    let limit = PAGE;
    const params = new URLSearchParams(window.location.search);
    input.value = params.get('q') || '';
    const initial = { type: params.get('type') || '', key: params.get('key') || '', genre: params.get('genre') || '' };
    const selectedGenres = () => (genreSelect && genreSelect.value ? [genreSelect.value] : genres);

    function syncUrl() {
      const url = new URL(window.location.href);
      const values = { q: input.value.trim(), type: typeSelect?.value, key: keySelect?.value, genre: genreSelect?.value };
      for (const [name, value] of Object.entries(values)) {
        if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
      }
      history.replaceState(history.state, '', url);
    }

    function render(found) {
      list.replaceChildren(...found.results.map((tune) => {
        const item = document.createElement('li');
        item.className = 'py-1.5 text-sm';
        const link = document.createElement('a');
        link.href = tune.href;
        link.className = 'text-blue-300 hover:text-blue-200';
        link.textContent = tune.title;
        const meta = document.createElement('span');
        meta.className = 'text-gray-500';
        const details = [showGenre && tune.genreName, tune.type && tune.type !== 'other' && typeLabel(tune.type),
          tune.key && keyLabel(tune.key), tune.sourceName].filter(Boolean);
        meta.textContent = ` · ${details.join(' · ')}`;
        item.append(link, meta);
        return item;
      }));
    }

    async function run({ resetLimit = true } = {}) {
      const run = ++latest;
      if (resetLimit) limit = PAGE;
      syncUrl();
      const type = typeSelect ? typeSelect.value : '';
      const key = keySelect ? keySelect.value : '';
      if (!normalize(input.value) && !type && !key) {
        list.replaceChildren();
        status.textContent = '';
        if (more) more.hidden = true;
        return;
      }
      status.textContent = 'Searching…';
      let found;
      try {
        found = await search(input.value, { genres: selectedGenres(), limit, type, key });
      } catch (error) {
        if (run === latest) status.textContent = 'Could not load the tune library. Please try again later.';
        return;
      }
      if (run !== latest) return; // A newer search replaced this one.
      if (typeSelect) fillSelect(typeSelect, found.types, 'Any type', typeLabel, type);
      if (keySelect) fillSelect(keySelect, found.keys, 'Any key', keyLabel, key);
      const shown = found.results.length;
      status.textContent = (found.total === 0 ? 'No matching tunes'
        : found.total > shown ? `Showing ${shown.toLocaleString('en-US')} of ${found.total.toLocaleString('en-US')} matches`
        : `${found.total.toLocaleString('en-US')} ${found.total === 1 ? 'match' : 'matches'}`)
        + (found.failedGenres.length ? ' (some genres could not be loaded)' : '');
      render(found);
      if (more) more.hidden = found.total <= shown;
    }

    // Until a search runs, the filter menus list what the genre manifest knows.
    loadManifest().then((info) => {
      if (genreSelect) {
        genreSelect.replaceChildren(new Option('All genres', ''), ...(info.genres || []).map((g) => new Option(g.name, g.genre)));
        genreSelect.value = initial.genre;
      }
      const ids = new Set(selectedGenres() || (info.genres || []).map((g) => g.genre));
      const types = {};
      for (const genre of info.genres || []) {
        if (!ids.has(genre.genre)) continue;
        for (const [name, count] of Object.entries(genre.categories || {})) types[name] = (types[name] || 0) + count;
      }
      if (typeSelect && typeSelect.options.length <= 1) fillSelect(typeSelect, types, 'Any type', typeLabel, initial.type);
      if (keySelect && keySelect.options.length <= 1) fillSelect(keySelect, {}, 'Any key', keyLabel, initial.key);
      if (input.value.trim() || initial.type || initial.key) run();
    }).catch(() => {});

    const preload = () => {
      loadManifest().then((info) => (selectedGenres() || (info.genres || []).map((g) => g.genre))
        .forEach((id) => loadGenre(id).catch(() => {}))).catch(() => {});
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
    // Start downloading as soon as someone heads for the search box or a filter.
    for (const control of [input, typeSelect, keySelect]) control?.addEventListener('focus', preload, { once: true });
    for (const control of [typeSelect, keySelect, genreSelect]) control?.addEventListener('change', () => run());
    more?.addEventListener('click', () => { limit += PAGE; run({ resetLimit: false }); });
  }

  window.JamBuddyLibrary = { search, attach, normalize, core, parseQuery, rank, category, normalizeKey, keyLabel, typeLabel };
})();
