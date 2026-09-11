# Web ABC index

`public/tune-index/index.json` is served at https://jambuddy.live/tune-index/index.json.
It indexes external web collections, independently of JamBuddy's onboard library.
Only titles, keys, rhythms, source URLs, X numbers, file ordinals and setting hashes
are published. ABC scores remain at the original sites; source terms still apply.

Run `python3 scripts/tune-index/build.py` from the website repository to refresh.
The standard Netlify build copies the index unchanged. The weekly GitHub workflow
refreshes metadata on `main`; its commit triggers the existing Netlify deployment.
Failures retain the last successful metadata for that file/source. A first build
with an entirely unavailable source fails instead of publishing a misleading index.

Add sources in `sources.json`, either a `page` containing same-host ABC download
links or an explicit `files` list. Discovery is bounded by `max_files`, HTTPS-only,
and paced. It does not crawl the entire internet or republish source notation.
Review new collections before adding them. New source hosts must also be added to
Android's `AbcTuneCatalog.sourceHosts` allowlist. Existing-host files are picked up
by the next index refresh without an app release.

Schema version 1: `sources` describes collection names and stale/failed fetches;
`tunes` contains stable IDs, alternate `titles`, `key`, `rhythm`, `url`, `x`,
zero-based `ordinal`, `source`, and a `setting` fingerprint. Repeated X numbers are
supported. Clients should verify X/title on import because source files can change.

Android downloads this index on first web search, caches it, and checks for updates
on a later app session after 24 hours. Offline users can search a cached index;
loading uncached notation still requires the original source to be available.

Tests: `python3 -m unittest discover -s scripts/tune-index -p 'test_*.py'`.
