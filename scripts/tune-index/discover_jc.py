#!/usr/bin/env python3
"""Discover bulk ABC collections through JC's public collection-listing CGI."""
import concurrent.futures
import json
import re
import urllib.parse
from pathlib import Path
from build import fetch, Links, ROOT

BASE = 'https://trillian.mit.edu'
ROOT_PATH = '/~jc/music/book/'


def listing(path):
    api = BASE + '/~jc/cgi/abc/coll.cgi' + path.removeprefix('/~jc')
    html = re.sub(r'(?s)<!--.*?-->', '', fetch(api).decode('utf-8', errors='replace'))
    parser = Links()
    parser.feed(html)
    dirs = set()
    for href in parser.links:
        target = urllib.parse.urlsplit(urllib.parse.urljoin(BASE + path, href))
        if target.hostname == 'trillian.mit.edu' and target.path.startswith(ROOT_PATH) and target.path.endswith('/') and target.path != path:
            dirs.add(target.path)
    files = {}
    for row in re.findall(r'(?is)<tr\b[^>]*>(.*?)</tr>', html):
        cells = re.findall(r'(?is)<td\b[^>]*>(.*?)</td>', row)
        if len(cells) < 11:
            continue
        links = Links()
        links.feed(cells[1])
        for href in links.links:
            url = urllib.parse.urljoin(BASE + path, href)
            if urllib.parse.urlsplit(url).path.lower().endswith('.abc'):
                size = re.sub('<[^>]*>', '', cells[10]).strip()
                if size.isdigit():
                    files[url] = int(size)
    if not dirs and not files:
        # Some collections return an empty CGI page even though their linked public
        # directory is healthy (for example Aird). Use its ordinary download links.
        fallback = Links()
        fallback.feed(fetch(BASE + path).decode('utf-8', errors='replace'))
        candidates = set()
        for href in fallback.links:
            url = urllib.parse.urljoin(BASE + path, href)
            target = urllib.parse.urlsplit(url)
            if target.hostname != 'trillian.mit.edu' or not target.path.startswith(ROOT_PATH):
                continue
            if target.path.endswith('/') and target.path != path:
                dirs.add(target.path)
            elif target.path.lower().endswith('.abc'):
                candidates.add(url)
        # Unknown sizes: include only small directory listings, not unbounded single exports.
        if len(candidates) <= 50:
            files.update({url: -1 for url in candidates})
    return dirs, files


def main():
    seen, pending, files, errors = set(), {ROOT_PATH}, {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for depth in range(5):
            batch = sorted(pending - seen)
            if not batch:
                break
            if len(seen) + len(batch) > 1000:
                raise RuntimeError('Directory budget exceeded; inspect discovery before expanding')
            pending = set()
            futures = {pool.submit(listing, path): path for path in batch}
            for future in concurrent.futures.as_completed(futures):
                path = futures[future]
                seen.add(path)
                try:
                    dirs, found = future.result()
                    pending.update(dirs - seen)
                    files.update(found)
                except Exception as error:
                    errors.append({'path': path, 'error': str(error)})
                if len(seen) % 25 == 0:
                    print(f'Discovery: {len(seen)} directories, {len(files)} ABC files', flush=True)
    # Bulk files provide complete collections in a single request; avoid thousands of
    # redundant single-tune files and ABC v1/v2 duplicate exports when v2 is available.
    bulk = {url: size for url, size in files.items() if size >= 6000 or size == -1}
    groups = {}
    for url in sorted(bulk):
        name = urllib.parse.urlsplit(url).path[len(ROOT_PATH):].split('/')[0]
        groups.setdefault(name, []).append(url)
    sources = [{'id': 'jc-' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
                'name': "JC archive: " + name, 'optional': True, 'files': urls, 'max_files': len(urls) + 100,
                'discovered_via': BASE + '/~jc/cgi/abc/coll.cgi/music/book/'}
               for name, urls in sorted(groups.items())]
    output = ROOT / 'scripts/tune-index/jc-sources.json'
    if not sources:
        raise RuntimeError('Discovery returned no collections; retaining the published manifest')
    if output.exists() and (errors or pending - seen):
        previous = json.loads(output.read_text())['sources']
        by_id = {source['id']: source for source in sources}
        for old in previous:
            if old['id'] in by_id:
                current = by_id[old['id']]
                current['files'] = sorted(set(current['files']) | set(old['files']))
                current['max_files'] = len(current['files']) + 100
            else:
                sources.append(old)
    output.write_text(json.dumps({'sources': sources, 'discovery': {
        'directories': len(seen), 'abc_files': len(files), 'bulk_files': len(bulk),
        'unvisited_directories': sorted(pending - seen), 'errors': errors}}, indent=2) + '\n')
    print(f'Discovered {len(bulk)} bulk files in {len(sources)} collections; {len(errors)} directory errors', flush=True)


if __name__ == '__main__':
    main()
