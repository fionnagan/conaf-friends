#!/usr/bin/env python3
"""
Slow retry for rate-limited photo lookups. Uses 5s delays to stay within Wikipedia limits.
"""
import json, time, re, urllib.request, urllib.parse
from pathlib import Path
from typing import Optional

BASE_DIR   = Path(__file__).parent.parent
CACHE_FILE = BASE_DIR / 'scripts' / 'cache' / 'photos.json'
DATA_FILE  = BASE_DIR / 'data' / 'guests.json'
HEADERS    = {'User-Agent': 'FriendRegistry-Bot/1.0 (fan project; github.com/conan-friends)'}
DELAY      = 5.0  # seconds between requests

def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
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
    except Exception as e:
        if '429' in str(e):
            print(f'  [429] rate limited on {name!r}, sleeping 30s...')
            time.sleep(30)
        return None

def wiki_search_thumb(name: str) -> Optional[str]:
    try:
        params = urllib.parse.urlencode({
            'action':'query','list':'search','srsearch':name,
            'format':'json','srlimit':3,'srnamespace':0
        })
        data = get_json('https://en.wikipedia.org/w/api.php?' + params)
        hits = data['query']['search']
        if not hits: return None
        best = hits[0]['title']
        time.sleep(DELAY)
        return wiki_thumb(best)
    except Exception as e:
        if '429' in str(e): time.sleep(30)
        return None

def extract_names(guest_name: str) -> list:
    candidates = []

    # "Remembering X" → X
    m = re.match(r'^Remembering\s+(.+)$', guest_name, re.I)
    if m: candidates.append(m.group(1).strip())

    # "Live with X at/from Y" → X
    m2 = re.match(r'^Live\s+with\s+(.+?)\s+(?:at|from)\b', guest_name, re.I)
    if m2: candidates.append(m2.group(1).strip())

    # "X featuring Y" → Y
    m3 = re.search(r'featuring\s+(.+?)(?:\s*$)', guest_name, re.I)
    if m3: candidates.append(m3.group(1).strip())

    # "X Live From/at Y" → X
    stripped = re.sub(r'\s+(live\s+(?:from|at|with)|at\s+the)\b.*', '', guest_name, flags=re.I).strip()
    if stripped and stripped != guest_name: candidates.append(stripped)

    # "Neil Young And The Songs..." → Neil Young
    m4 = re.match(r'^(.+?)\s+and\s+the\s+', guest_name, re.I)
    if m4: candidates.insert(0, m4.group(1).strip())

    # "X and Y" → X (first person)
    m5 = re.match(r'^(.+?)\s+(?:and|&)\s+([A-Z].+?)(?:\s+Live\b|\s+from\b|$)', guest_name, re.I)
    if m5:
        p1, p2 = m5.group(1).strip(), m5.group(2).strip()
        if len(p1) > 3: candidates.append(p1)
        if len(p2) > 3: candidates.append(p2)

    # Original as last resort
    candidates.append(guest_name)

    seen, out = set(), []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out

# Manual overrides for entries that aren't real people
SKIP = {
    'Kingsman: The Golden Circle',
    'The Guest Book',
    'Mike Sweeney and Jessie Gaskell',  # staff, not famous
    'John Wilson',                       # director, likely no portrait thumb
}

# Direct name overrides (guestName → Wikipedia article name)
OVERRIDES = {
    'Triumph the Insult Comic Dog': 'Triumph the Insult Comic Dog',
    'Beastie Boys':                 'Beastie Boys',
    'Spinal Tap Live From The SiriusXM Garage': 'Spinal Tap (band)',
    'Kurt and Wyatt Russell Live from SiriusXM Miami Studios': 'Kurt Russell',
}

def main():
    data   = json.loads(DATA_FILE.read_text())
    cache  = json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}
    guests = [g['name'] for g in data['guests']]

    missing = [n for n in guests if not cache.get(n, {}).get('url')]
    print(f'Guests still needing photos: {len(missing)}\n')

    # Warm up — wait for rate limit reset
    print('Waiting 60s for Wikipedia rate limit to reset...')
    time.sleep(60)

    found = 0
    failed = []

    for i, name in enumerate(missing):
        if name in SKIP:
            print(f'[{i+1:3}/{len(missing)}] SKIP {name}')
            failed.append(name)
            continue

        # Apply manual override if present
        if name in OVERRIDES:
            names_to_try = [OVERRIDES[name]]
        else:
            names_to_try = extract_names(name)

        url = None
        for try_name in names_to_try:
            url = wiki_thumb(try_name)
            if url: break
            time.sleep(DELAY)
            url = wiki_search_thumb(try_name)
            if url: break
            time.sleep(DELAY)

        now = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
        cache[name] = {'url': url, 'fetchedAt': now}

        status = '✓' if url else '✗'
        tried = names_to_try[0] if names_to_try[0] != name else ''
        tag = f'(tried: {tried!r})' if tried else ''
        print(f'[{i+1:3}/{len(missing)}] {status} {name} {tag}')

        if url: found += 1
        else: failed.append(name)

        if (i + 1) % 5 == 0:
            CACHE_FILE.write_text(json.dumps(cache, indent=2))

        time.sleep(DELAY)

    CACHE_FILE.write_text(json.dumps(cache, indent=2))

    total = sum(1 for n in guests if cache.get(n, {}).get('url'))
    print(f'\n=== Retry Done ===')
    print(f'Found: {found}/{len(missing)}')
    print(f'Total with photos: {total}/{len(guests)}')
    if failed:
        print(f'\nStill missing ({len(failed)}):')
        for n in failed: print(f'  {n}')

if __name__ == '__main__':
    main()
