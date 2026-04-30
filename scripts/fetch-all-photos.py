#!/usr/bin/env python3
"""
Bulk photo fetcher with multi-source fallback.

Sources tried in order per guest:
  1. Wikipedia pageimages API       (highest quality, most reliable)
  2. Wikipedia search + pageimages  (handles name variants / redirects)
  3. Wikimedia Commons search       (broader coverage)
  4. DuckDuckGo Instant Answer API  (last resort for known people)

Run: python3 scripts/fetch-all-photos.py
Updates: scripts/cache/photos.json
"""

import json, time, sys, urllib.request, urllib.parse, urllib.error
from pathlib import Path
from typing import Optional

BASE_DIR   = Path(__file__).parent.parent
CACHE_FILE = BASE_DIR / 'scripts' / 'cache' / 'photos.json'
DATA_FILE  = BASE_DIR / 'data' / 'guests.json'

HEADERS    = {'User-Agent': 'FriendRegistry-Bot/1.0 (fan project; contact via GitHub)'}
THUMB_SIZE = 500

def get(url, timeout=10):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def api(base, **params):
    qs = urllib.parse.urlencode(params)
    return get(f'{base}?{qs}')

# ── Source 1: Wikipedia pageimages (direct title lookup) ─────────────────────
def wiki_thumb(name: str) -> Optional[str]:
    try:
        data = api('https://en.wikipedia.org/w/api.php',
                   action='query', prop='pageimages', titles=name,
                   format='json', pithumbsize=THUMB_SIZE, redirects=1)
        pages = data['query']['pages']
        page  = next(iter(pages.values()))
        return page.get('thumbnail', {}).get('source')
    except Exception:
        return None

# ── Source 2: Wikipedia search → best hit → pageimages ───────────────────────
def wiki_search_thumb(name: str) -> Optional[str]:
    try:
        # Find the most relevant Wikipedia article title
        search = api('https://en.wikipedia.org/w/api.php',
                     action='query', list='search', srsearch=name,
                     format='json', srlimit=3, srnamespace=0)
        hits = search['query']['search']
        if not hits:
            return None
        best_title = hits[0]['title']
        if best_title.lower() == name.lower():
            return None  # already tried this exact title in source 1
        return wiki_thumb(best_title)
    except Exception:
        return None

# ── Source 3: Wikimedia Commons portrait search ───────────────────────────────
def commons_thumb(name: str) -> Optional[str]:
    try:
        # Search Commons for files
        search = api('https://commons.wikimedia.org/w/api.php',
                     action='query', list='search',
                     srsearch=f'{name} portrait -logo -album -poster',
                     srnamespace=6, srlimit=5, format='json')
        hits = search['query']['search']
        if not hits:
            return None
        titles = '|'.join(h['title'] for h in hits[:3])
        info = api('https://commons.wikimedia.org/w/api.php',
                   action='query', prop='imageinfo', titles=titles,
                   format='json', iiprop='url', iiurlwidth=THUMB_SIZE)
        for page in info['query']['pages'].values():
            ii = page.get('imageinfo', [{}])[0]
            url = ii.get('thumburl') or ii.get('url')
            if url and _looks_like_portrait(url, name):
                return url
        return None
    except Exception:
        return None

def _looks_like_portrait(url: str, name: str) -> bool:
    bad = ('logo', 'award', 'poster', 'album', 'cover', 'icon', 'map',
           'chart', 'symbol', 'flag', 'sign', 'stamp')
    u = url.lower()
    if any(b in u for b in bad):
        return False
    # Bonus: name fragments in URL
    parts = name.lower().split()
    return any(p in u for p in parts if len(p) > 3)

# ── Source 4: DuckDuckGo Instant Answer ──────────────────────────────────────
def ddg_image(name: str) -> Optional[str]:
    try:
        data = api('https://api.duckduckgo.com/',
                   q=name, format='json', no_html=1, skip_disambig=1)
        img = data.get('Image', '')
        if img and img.startswith('http') and 'logo' not in img.lower():
            return img
        # Try related topics
        for topic in data.get('RelatedTopics', []):
            img = topic.get('Image', '')
            if img and img.startswith('http') and 'logo' not in img.lower():
                return img
        return None
    except Exception:
        return None

# ── Fetch with fallback chain ─────────────────────────────────────────────────
def fetch_photo(name: str) -> Optional[str]:
    url = wiki_thumb(name)
    if url: return url
    time.sleep(0.3)

    url = wiki_search_thumb(name)
    if url: return url
    time.sleep(0.3)

    url = commons_thumb(name)
    if url: return url
    time.sleep(0.2)

    url = ddg_image(name)
    return url

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    data   = json.loads(DATA_FILE.read_text())
    guests = [g['name'] for g in data['guests']]

    cache: dict = {}
    if CACHE_FILE.exists():
        cache = json.loads(CACHE_FILE.read_text())

    # Clear stale null entries (so they get retried)
    cleared = 0
    for name in list(cache.keys()):
        if not cache[name].get('url'):
            del cache[name]
            cleared += 1
    print(f'Cleared {cleared} stale null entries.')

    missing = [n for n in guests if n not in cache]
    print(f'Guests to fetch: {len(missing)} / {len(guests)} total\n')

    found = 0
    failed = []

    for i, name in enumerate(missing):
        url = fetch_photo(name)
        cache[name] = {'url': url, 'fetchedAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z'}

        status = '✓' if url else '✗'
        src = ''
        if url:
            if 'wikipedia' in url or 'wikimedia' in url:
                src = '(wiki)'
            elif 'duckduckgo' in url:
                src = '(ddg)'
            found += 1
        else:
            failed.append(name)

        print(f'[{i+1:3}/{len(missing)}] {status} {name} {src}')

        # Save every 20 guests
        if (i + 1) % 20 == 0:
            CACHE_FILE.write_text(json.dumps(cache, indent=2))

        # Rate limiting: 1.0s between requests (Wikipedia guidelines)
        time.sleep(1.0)

    CACHE_FILE.write_text(json.dumps(cache, indent=2))

    total_with = sum(1 for v in cache.values() if v.get('url'))
    print(f'\n=== Done ===')
    print(f'Found:  {found}/{len(missing)} new photos')
    print(f'Total:  {total_with}/{len(guests)} guests with photos')

    if failed:
        print(f'\nStill missing ({len(failed)}):')
        for n in failed:
            print(f'  {n}')

if __name__ == '__main__':
    main()
