#!/usr/bin/env python3
"""
Targeted photo fix for the 48 remaining guests without photos.
Handles compound titles like 'X Live From Y', 'X and Y', 'Remembering X'.
"""
import json, time, re, urllib.request, urllib.parse
from pathlib import Path
from typing import Optional

BASE_DIR   = Path(__file__).parent.parent
CACHE_FILE = BASE_DIR / 'scripts' / 'cache' / 'photos.json'
DATA_FILE  = BASE_DIR / 'data' / 'guests.json'
HEADERS    = {'User-Agent': 'FriendRegistry-Bot/1.0 (fan project)'}

def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)

def wiki_thumb(name: str) -> Optional[str]:
    params = urllib.parse.urlencode({
        'action':'query','prop':'pageimages','titles':name,
        'format':'json','pithumbsize':500,'redirects':1
    })
    try:
        data = get_json('https://en.wikipedia.org/w/api.php?' + params)
        page = list(data['query']['pages'].values())[0]
        return page.get('thumbnail',{}).get('source')
    except Exception:
        return None

def wiki_search(name: str) -> Optional[str]:
    """Search Wikipedia and take the first hit."""
    try:
        params = urllib.parse.urlencode({
            'action':'query','list':'search','srsearch':name,
            'format':'json','srlimit':3,'srnamespace':0
        })
        data = get_json('https://en.wikipedia.org/w/api.php?' + params)
        hits = data['query']['search']
        if not hits:
            return None
        best = hits[0]['title']
        time.sleep(0.4)
        return wiki_thumb(best)
    except Exception:
        return None

def extract_primary_name(guest_name: str) -> list:
    """Return list of Wikipedia search strings to try, best first."""
    candidates = []

    # "Remembering Paul Reubens" → Paul Reubens
    m = re.match(r'^Remembering\s+(.+)$', guest_name, re.I)
    if m:
        candidates.append(m.group(1).strip())

    # "X Live From/at/with Y" → X
    m = re.sub(r'\s+(live\s+(?:from|at|with)|at\s+the)\b.*', '', guest_name, flags=re.I).strip()
    if m and m != guest_name:
        candidates.append(m)

    # "Live with X at Y" → X
    m2 = re.match(r'^Live\s+with\s+(.+?)\s+(?:at|from)\b', guest_name, re.I)
    if m2:
        candidates.append(m2.group(1).strip())

    # "X and Y" or "X & Y" → X, Y separately
    m3 = re.match(r'^(.+?)\s+(?:and|&)\s+(.+?)(?:\s+Live\b|\s+from\b|$)', guest_name, re.I)
    if m3:
        candidates.append(m3.group(1).strip())
        candidates.append(m3.group(2).strip())

    # "Neil Young And The Songs That Inspired Him" → Neil Young
    m4 = re.match(r'^(.+?)\s+and\s+the\s+', guest_name, re.I)
    if m4:
        candidates.insert(0, m4.group(1).strip())

    # "A Very Special ... featuring Andy Daly" → Andy Daly
    m5 = re.search(r'featuring\s+(.+?)(?:\s*$)', guest_name, re.I)
    if m5:
        candidates.append(m5.group(1).strip())

    # Always add the original name as last resort
    candidates.append(guest_name)

    # Dedupe preserving order
    seen = set()
    out = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out

def fetch_photo(guest_name: str) -> Optional[str]:
    names = extract_primary_name(guest_name)
    for name in names:
        url = wiki_thumb(name)
        if url:
            return url
        time.sleep(0.5)
        url = wiki_search(name)
        if url:
            return url
        time.sleep(0.5)
    return None

def main():
    data   = json.loads(DATA_FILE.read_text())
    cache  = json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}
    guests = [g['name'] for g in data['guests']]

    # Clear null entries for guests in the current guest list
    cleared = 0
    for name in guests:
        if name in cache and not cache[name].get('url'):
            del cache[name]
            cleared += 1
    print(f'Cleared {cleared} stale null entries for current guests.\n')

    missing = [n for n in guests if n not in cache or not cache.get(n, {}).get('url')]
    print(f'Guests to fetch: {len(missing)}\n')

    found = 0
    failed = []

    for i, name in enumerate(missing):
        names_tried = extract_primary_name(name)
        url = fetch_photo(name)
        now = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
        cache[name] = {'url': url, 'fetchedAt': now}

        status = '✓' if url else '✗'
        tag = f'(tried: {names_tried[0]!r})' if names_tried[0] != name else ''
        print(f'[{i+1:3}/{len(missing)}] {status} {name} {tag}')

        if url:
            found += 1
        else:
            failed.append(name)

        if (i + 1) % 10 == 0:
            CACHE_FILE.write_text(json.dumps(cache, indent=2))

        time.sleep(1.5)

    CACHE_FILE.write_text(json.dumps(cache, indent=2))

    total = sum(1 for n in guests if cache.get(n, {}).get('url'))
    print(f'\n=== Done ===')
    print(f'Found: {found}/{len(missing)}')
    print(f'Total with photos: {total}/{len(guests)}')
    if failed:
        print(f'\nStill missing ({len(failed)}):')
        for n in failed:
            print(f'  {n}')

if __name__ == '__main__':
    main()
