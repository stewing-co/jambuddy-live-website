#!/usr/bin/env python3
"""Index public web ABC files. Publish metadata/links only, never the source scores."""
import concurrent.futures
import threading
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/tune-index/index.json'
MAX_BYTES = 8_000_000
CACHE = ROOT / 'scripts/tune-index/.cache'
FETCH_LOCK = threading.Lock()
LAST_FETCH = 0.0


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'a':
            self.links.extend(value for key, value in attrs if key.lower() == 'href' and value)


def fetch(url):
    global LAST_FETCH
    cache = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if cache.exists() and time.time() - cache.stat().st_mtime < 6 * 86400:
        return cache.read_bytes()
    with FETCH_LOCK:
        time.sleep(max(0, 0.22 - (time.monotonic() - LAST_FETCH)))
        LAST_FETCH = time.monotonic()
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('Only HTTPS sources are supported')
    request = urllib.request.Request(url, headers={'User-Agent': 'JamBuddyTuneIndex/1.0 (+https://jambuddy.live)'})
    with urllib.request.urlopen(request, timeout=25) as response:
        if urllib.parse.urlsplit(response.url).scheme != 'https':
            raise ValueError('Insecure redirect')
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Source exceeds size limit')
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data


def discover(page, html):
    parser = Links()
    parser.feed(html)
    host = urllib.parse.urlsplit(page).hostname
    return sorted({urllib.parse.urljoin(page, link) for link in parser.links
                   if urllib.parse.urlsplit(urllib.parse.urljoin(page, link)).hostname == host
                   and urllib.parse.urlsplit(urllib.parse.urljoin(page, link)).scheme == 'https'
                   and urllib.parse.urlsplit(link).path.lower().endswith('.abc')})


def fields(text, key):
    return [value.strip() for value in re.findall(r'^' + key + r':\s*([^\r\n]+)', text, re.M)]


def index_abc(text, url, source, encoding="utf-8"):
    text = text.replace('\r\n', '\n').replace('\r', '\n').lstrip('\ufeff')
    if re.search(r'<(?:!doctype|html|body)\b', text, re.I):
        raise ValueError('HTML returned instead of ABC')
    result = []
    for ordinal, part in enumerate(re.split(r'(?m)(?=^X:\s*\S)', text)[1:]):
        titles = list(dict.fromkeys(fields(part, 'T')))
        keys = fields(part, 'K')
        if not titles or not keys:
            continue
        x = fields(part, 'X')[0]
        # Ordinal disambiguates collections which repeat X numbers.
        identity = hashlib.sha256(f'{url}#{ordinal}:{x}'.encode()).hexdigest()[:24]
        music = '\n'.join(line.strip() for line in part.splitlines()
                          if line.strip() and not re.match(r'^(?:[XTNSZH]:|%)', line))
        result.append({'id': identity, 'titles': titles, 'key': keys[0],
                       'rhythm': next(iter(fields(part, 'R')), ''), 'url': url,
                       'x': x, 'ordinal': ordinal, 'source': source['id'], 'encoding': encoding,
                       'setting': hashlib.sha256(music.encode()).hexdigest()[:24]})
    if not result:
        raise ValueError('No valid ABC tunes found')
    return result


def build(sources, previous=None, loader=fetch, pause=time.sleep):
    old = (previous or {}).get('tunes', [])
    tunes, reports = [], []
    for source in sources:
        failures = []
        try:
            urls = source.get('files') or discover(source['page'], loader(source['page']).decode('utf-8', errors='replace'))
            if not urls or len(urls) > source['max_files']:
                raise ValueError('Unexpected collection file count')
        except Exception as error:
            retained = [tune for tune in old if tune['source'] == source['id']]
            if not retained:
                raise RuntimeError(f"Cannot initialize {source['id']}: {error}") from error
            tunes.extend(retained)
            reports.append({'id': source['id'], 'name': source['name'], 'stale': True, 'failures': [str(error)]})
            continue
        def load_file(url):
            data = loader(url)
            try:
                encoding = source.get('encoding', 'utf-8')
                text = data.decode(encoding)
            except UnicodeDecodeError:
                encoding = 'windows-1252'
                text = data.decode(encoding)
            return index_abc(text, url, source, encoding)

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(load_file, url): url for url in urls}
            for future in concurrent.futures.as_completed(futures):
                url = futures[future]
                try:
                    tunes.extend(future.result())
                except Exception as error:
                    retained = [tune for tune in old if tune['source'] == source['id'] and tune['url'] == url]
                    tunes.extend(retained)
                    failures.append(url + ': ' + str(error))
        print(f"{source['id']}: {len(tunes)} total settings, {len(failures)} failed files", flush=True)
        if not source.get('optional') and not any(tune['source'] == source['id'] for tune in tunes):
            raise RuntimeError(f"No tunes available for {source['id']}")
        reports.append({'id': source['id'], 'name': source['name'], 'stale': bool(failures), 'failures': failures})
    if not tunes:
        raise ValueError('Refusing to publish an empty index')
    return {'version': 1, 'sources': reports, 'tunes': sorted(tunes, key=lambda tune: tune['id'])}


def main():
    sources = json.loads((ROOT / 'scripts/tune-index/sources.json').read_text())['sources']
    discovered = ROOT / 'scripts/tune-index/jc-sources.json'
    if discovered.exists():
        sources.extend(dict(source, optional=True) for source in json.loads(discovered.read_text())['sources'])
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else None
    catalog = build(sources, previous)
    payload = json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n'
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix('.pending')
    temporary.write_text(payload)
    temporary.replace(OUTPUT)
    print(f"Indexed {len(catalog['tunes'])} web settings from {len(catalog['sources'])} collections")
    for source in catalog['sources']:
        print(source['id'], 'stale' if source['stale'] else 'current', len(source['failures']), 'failed files')


if __name__ == '__main__':
    main()
