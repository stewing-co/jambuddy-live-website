#!/usr/bin/env python3
"""Discover and validate ABC collections on hosts the app does not yet trust.

Unlike discover_jc.py (bounded to trillian.mit.edu, a host the Android app already
allowlists), this crawls arbitrary seed pages/hosts listed in seeds.json - sites found
by web search, not by an automated, unattended process. Because these hosts are not yet
trusted, its output (discovered-sources.json) is a review artifact only: build.py does
NOT read it. A person must review the per-host summary and manually promote entries into
sources.json, and add the host to Android's AbcTuneCatalog.sourceHosts, before any of it
is trusted.
"""
import json
import time
import urllib.parse
import urllib.robotparser
from pathlib import Path

from build import ROOT, Links, fetch, index_abc

SEEDS = ROOT / 'scripts/tune-index/seeds.json'
OUTPUT = ROOT / 'scripts/tune-index/discovered-sources.json'
MAX_DEPTH = 4
MAX_PAGES_PER_HOST = 300
USER_AGENT = 'JamBuddyTuneIndex/1.0 (+https://jambuddy.live)'


def _is_page_link(path):
    lower = path.lower()
    last_segment = lower.rsplit('/', 1)[-1]
    return lower.endswith('/') or lower.endswith(('.html', '.htm')) or '.' not in last_segment


def robots_allowed(url, loader, cache):
    host = urllib.parse.urlsplit(url).hostname
    parser = cache.get(host)
    if parser is None:
        parser = urllib.robotparser.RobotFileParser()
        try:
            parser.parse(loader(f'https://{host}/robots.txt').decode('utf-8', errors='replace').splitlines())
        except Exception:
            # No reachable robots.txt: default to allow, same convention every crawler follows.
            parser.allow_all = True
        cache[host] = parser
    return parser.allow_all or parser.can_fetch(USER_AGENT, url)


def crawl_host(seed_url, loader=fetch):
    """Same-host bounded BFS from seed_url. Returns (candidate .abc urls, visited pages, errors)."""
    host = urllib.parse.urlsplit(seed_url).hostname
    robots_cache = {}
    seen, pending, candidates, errors = set(), {seed_url}, set(), []
    for _ in range(MAX_DEPTH):
        batch = sorted(pending - seen)
        if not batch:
            break
        if len(seen) + len(batch) > MAX_PAGES_PER_HOST:
            errors.append(f'Page budget exceeded for {host}; stopping discovery early')
            break
        pending = set()
        for page in batch:
            seen.add(page)
            if not robots_allowed(page, loader, robots_cache):
                errors.append(f'robots.txt disallows {page}')
                continue
            try:
                html = loader(page).decode('utf-8', errors='replace')
            except Exception as error:
                errors.append(f'{page}: {error}')
                continue
            parser = Links()
            parser.feed(html)
            for href in parser.links:
                target = urllib.parse.urljoin(page, href)
                split = urllib.parse.urlsplit(target)
                if split.hostname != host or split.scheme != 'https':
                    continue
                if split.path.lower().endswith('.abc'):
                    candidates.add(target)
                elif _is_page_link(split.path) and target not in seen:
                    pending.add(target)
    return candidates, seen, errors


def validate(url, source, loader=fetch):
    """Fetches and validates one candidate .abc URL as real ABC content."""
    try:
        data = loader(url)
    except Exception as error:
        return {'url': url, 'ok': False, 'error': str(error)}
    text = encoding = None
    for candidate_encoding in ('utf-8', 'windows-1252'):
        try:
            text = data.decode(candidate_encoding)
            encoding = candidate_encoding
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return {'url': url, 'ok': False, 'error': 'undecodable as utf-8 or windows-1252'}
    try:
        tunes = index_abc(text, url, source, encoding)
    except Exception as error:
        return {'url': url, 'ok': False, 'error': str(error)}
    return {'url': url, 'ok': True, 'tune_count': len(tunes), 'encoding': encoding,
            'sample_titles': [t['titles'][0] for t in tunes[:5]]}


def discover(seed, loader=fetch):
    source = {'id': seed['id'], 'name': seed['name']}
    candidates, visited, errors = set(), set(), []
    for page in seed['seed_pages']:
        found, pages, page_errors = crawl_host(page, loader)
        candidates |= found
        visited |= pages
        errors += page_errors
    results = [validate(url, source, loader) for url in sorted(candidates)]
    ok = [r for r in results if r['ok']]
    failed = [r for r in results if not r['ok']]
    return {
        'id': seed['id'], 'name': seed['name'], 'found_via': seed.get('found_via', ''),
        'pages_visited': len(visited), 'candidates_found': len(candidates),
        'files': [r['url'] for r in ok], 'max_files': len(ok) + 20,
        'tune_count': sum(r['tune_count'] for r in ok),
        'sample_titles': [title for r in ok for title in r['sample_titles']][:10],
        'failures': errors + [f"{r['url']}: {r['error']}" for r in failed],
    }


def main():
    seeds = json.loads(SEEDS.read_text())
    reports = [discover(seed) for seed in seeds]
    OUTPUT.write_text(json.dumps({
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'note': 'Review artifact only - not read by build.py. Promote approved hosts into '
                'sources.json and Android AbcTuneCatalog.sourceHosts by hand.',
        'sources': reports,
    }, indent=2) + '\n')
    for report in reports:
        print(f"{report['id']}: {report['tune_count']} tunes in {len(report['files'])} files "
              f"({report['pages_visited']} pages visited, {len(report['failures'])} failures)", flush=True)


if __name__ == '__main__':
    main()
