#!/usr/bin/env python3
"""Index public web ABC files. Publish metadata/links only, never the source scores."""
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


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'a':
            self.links.extend(value for key, value in attrs if key.lower() == 'href' and value)


def fetch(url):
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('Only HTTPS sources are supported')
    request = urllib.request.Request(url, headers={'User-Agent': 'JamBuddyTuneIndex/1.0 (+https://jambuddy.live)'})
    with urllib.request.urlopen(request, timeout=25) as response:
        if urllib.parse.urlsplit(response.url).scheme != 'https':
            raise ValueError('Insecure redirect')
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Source exceeds size limit')
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
        for url in urls:
            try:
                data = loader(url)
                try:
                    encoding = source.get('encoding', 'utf-8')
                    text = data.decode(encoding)
                except UnicodeDecodeError:
                    encoding = 'windows-1252'
                    text = data.decode(encoding)
                tunes.extend(index_abc(text, url, source, encoding))
            except Exception as error:
                retained = [tune for tune in old if tune['source'] == source['id'] and tune['url'] == url]
                tunes.extend(retained)
                failures.append(url + ': ' + str(error))
            pause(0.15)
        if not any(tune['source'] == source['id'] for tune in tunes):
            raise RuntimeError(f"No tunes available for {source['id']}")
        reports.append({'id': source['id'], 'name': source['name'], 'stale': bool(failures), 'failures': failures})
    if not tunes:
        raise ValueError('Refusing to publish an empty index')
    return {'version': 1, 'sources': reports, 'tunes': sorted(tunes, key=lambda tune: tune['id'])}


def main():
    sources = json.loads((ROOT / 'scripts/tune-index/sources.json').read_text())['sources']
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
