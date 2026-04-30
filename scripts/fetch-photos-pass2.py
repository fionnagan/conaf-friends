#!/usr/bin/env python3
"""
Second-pass photo fetcher.
Handles: rate-limited real people, 'Live From...' entries, multi-person entries.
Slower rate (2s) to avoid 429s.
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

def wiki_page_images(name: str) -> Optional[str]:
    """Try fetching images listed on the Wikipedia article."""
    try:
        # Get list of image files on the page
        params = urllib.parse.urlencode({
            'action':'query','prop':'images','titles':name,
            'format':'json','imlimit':15,'redirects':1
        })
        data = get_json('https://en.wikipedia.org/w/api.php?' + params)
        page = list(data['query']['pages'].values())[0]
        images = page.get('images', [])
        # Filter for likely portraits (jpg/jpeg, not logos)
        skip = re.compile(r'logo|award|icon|map|chart|poster|album|flag|symbol|sign', re.I)
        candidates = [
            img['title'] for img in images
            if re.search(r'\.(jpg|jpeg|png)$', img['title'], re.I)
            and not skip.search(img['title'])
        ][:5]
        if not candidates:
            return None
        time.sleep(0.5)
        params2 = urllib.parse.urlencode({
            'action':'query','prop':'imageinfo',
            'titles':'|'.join(candidates),
            'format':'json','iiprop':'url','iiurlwidth':500
        })
        data2 = get_json('https://en.wikipedia.org/w/api.php?' + params2)
        for p in data2['query']['pages'].values():
            ii = p.get('imageinfo', [{}])[0]
            url = ii.get('thumburl') or ii.get('url')
            if url:
                return url
        return None
    except Exception:
        return None

def extract_person_name(raw: str) -> str:
    """Extract primary person name from compound entries."""
    # 'X Live From/at Y' -> 'X'
    raw = re.sub(r'\s+(live\s+(?:from|at|with)|at\s+the)\b.*', '', raw, flags=re.I).strip()
    # 'X And The Songs That Inspired Him' -> 'X'
    raw = re.sub(r'\s+and\s+the\s+songs\s+.*', '', raw, flags=re.I).strip()
    # 'X and Y' (two people) -> 'X'
    m = re.match(r'^(.+?)\s+and\s+(?:[A-Z]|\w+\s[A-Z])', raw)
    if m:
        candidate = m.group(1).strip()
        # Make sure it's a plausible person name (2+ chars, not a preposition)
        if len(candidate) > 3:
            raw = candidate
    return raw

def fetch_photo(guest_name: str) -> Optional[str]:
    person = extract_person_name(guest_name)
    names_to_try = list(dict.fromkeys([person, guest_name]))  # dedupe preserving order

    for name in names_to_try:
        url = wiki_thumb(name)
        if url:
            return url
        time.sleep(0.8)
        url = wiki_page_images(name)
        if url:
            return url
        time.sleep(0.8)

    return None

# Entries that are clearly not real people — skip silently
SKIP_PATTERNS = re.compile(
    r'staff review|fanhausen|snack attack|power point|rascally|club grub|'
    r'haunted hoochie|kidditch|avalanche terrain|slush metal|claro que si|'
    r'skull soup|craic mechanic|conapotamia|blueberry jam|goulash|safari so|'
    r'pen pals|sgt\. micro|lux et|social morays|gonzo|melissa and the|'
    r'uncle chutney|sasha and the|avery blaze|energeeza|pre bottled|'
    r'^fupa$|c\.u\.t\.i\.e|inaction figure|aguerotic|brazilian butt|'
    r'bedside conan|recessive elegance|trapped and neutered|karaoke tribal|'
    r'a belgian in france|hometown dermatologist|a cobb salad|coroner o\'brien|'
    r'therizinosaurus|down to the cock|pre bottled|weekend at conan|'
    r'in cyberspace|hot ones medical|amish brotherhood|rum and cokes|'
    r'my ghoulish|goofy goo|slimealier|separated at birth|muahaha|'
    r'old sharp-ass|three days from|yope|off to the ice|fun facts about|'
    r'spatchcock|let him do his bits|lost in translation|swipeout|'
    r'keepin.* in the family|underground museum|red ass|klingons and cowboys|'
    r'undercover rabbi|welcome to the jungle|party in my mouth|need, by conan|'
    r'a very special self-quarantine|snack attack|a hint of lube|'
    r'matt gourley needs a fan|mike sweeney and jessie|sean and the snapping|'
    r'lats and longs|scents and sensibility|charles and the chocolate|'
    r'a strong dose|play it|a clown is not|a cobb salad|a lesson in provinces|'
    r'arrowverse|kingsman|fanhausen|beacon theatre|majestic theatre|'
    r'chicago, illinois|tbs just for laughs|game of thrones|breaking bad|'
    r'aquaman|veronica mars|the predator|bright$|the lego|'
    r'^\[\d+\]|minecraft|canada o\'brien|one ring to rule|'
    r'let him cook|a belgian|hometown derm|steve carell$',  # Steve Carell already done
    re.I
)

def main():
    data   = json.loads(DATA_FILE.read_text())
    cache  = json.loads(CACHE_FILE.read_text())
    guests = [g['name'] for g in data['guests']]
    missing = [n for n in guests if not cache.get(n, {}).get('url')]

    to_fetch = [n for n in missing if not SKIP_PATTERNS.search(n)]
    print(f'Pass 2: {len(to_fetch)} guests to retry (skipping {len(missing)-len(to_fetch)} non-persons)\n')

    found = 0; failed = []
    for i, name in enumerate(to_fetch):
        url = fetch_photo(name)
        now = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
        cache[name] = {'url': url, 'fetchedAt': now}
        status = '✓' if url else '✗'
        person = extract_person_name(name)
        tag = f'(searched: {person!r})' if person != name else ''
        print(f'[{i+1:3}/{len(to_fetch)}] {status} {name} {tag}')
        if url: found += 1
        else: failed.append(name)
        if (i+1) % 20 == 0:
            CACHE_FILE.write_text(json.dumps(cache, indent=2))
        time.sleep(2.0)

    CACHE_FILE.write_text(json.dumps(cache, indent=2))
    total = sum(1 for n in guests if cache.get(n,{}).get('url'))
    print(f'\n=== Pass 2 Done ===')
    print(f'Found: {found}/{len(to_fetch)}')
    print(f'Total with photos: {total}/{len(guests)}')
    if failed:
        print(f'\nStill missing ({len(failed)}):')
        for n in failed: print(f'  {n}')

if __name__ == '__main__':
    main()
