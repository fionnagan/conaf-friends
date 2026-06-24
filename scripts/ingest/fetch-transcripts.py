#!/usr/bin/env python3
"""
fetch-transcripts.py
Fetches raw transcript HTML from podscripts.co for a list of episodes,
parses (timestamp, sentence) pairs, and writes normalized transcript JSON
files to scripts/ingest/transcripts/.

Usage:
  python3 scripts/ingest/fetch-transcripts.py /tmp/ingestion_sample_20.json
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
OUT_DIR = ROOT / 'scripts/ingest/transcripts'
PODCAST_SLUG = 'conan-obrien-needs-a-friend'
BASE = f'https://podscripts.co/podcasts/{PODCAST_SLUG}/'

def slugify(title: str) -> str:
    s = title.lower()
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[':\.\!\?,]", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')

def fetch_html(url: str) -> str:
    for attempt in range(5):
        r = subprocess.run(
            ['curl', '-sL', '-A', 'Mozilla/5.0', '--max-time', '30', url],
            capture_output=True, text=True,
        )
        html = r.stdout
        if '429 - Too Many Requests' not in html[:2000]:
            return html
        wait = 8 * (attempt + 1)
        print(f'  429 rate-limited, retrying in {wait}s…')
        time.sleep(wait)
    return html

def parse_transcript(html: str):
    """Returns list of {ts, text} groups, and the page title."""
    title_m = re.search(r'<title>(.*?)</title>', html)
    page_title = title_m.group(1) if title_m else ''
    if 'podcast-transcript' not in html:
        return None, page_title

    groups = re.findall(
        r'<div data-group-id="\d+" class="single-sentence">.*?'
        r'Starting point is (\d{2}:\d{2}:\d{2}).*?'
        r'</div>',
        html, re.S,
    )
    # Re-extract with text content per group since the regex above only grabs ts.
    group_blocks = re.findall(
        r'<div data-group-id="\d+" class="single-sentence">(.*?)</div>(?=<div data-group-id|\s*$)',
        html, re.S,
    )
    out = []
    for block in group_blocks:
        ts_m = re.search(r'Starting point is (\d{2}:\d{2}:\d{2})', block)
        if not ts_m:
            continue
        sentences = re.findall(
            r'class="pod_text seek_pod_segment sentence-tooltip transcript-text">\s*(.*?)\s*<!---->',
            block, re.S,
        )
        text = ' '.join(s.strip() for s in sentences if s.strip())
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            out.append({'ts': ts_m.group(1), 'text': text})
    return out, page_title

def main():
    sample_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ingestion_sample_20.json'
    episodes = json.load(open(sample_path))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    for ep in episodes:
        title = ep['title']
        slug = slugify(title)
        url = BASE + slug
        print(f'\n{title}  ->  {url}')
        html = fetch_html(url)
        groups, page_title = parse_transcript(html)
        if not groups:
            print(f'  MISS (no transcript markup found, page title: {page_title!r})')
            results.append({'title': title, 'slug': slug, 'url': url, 'ok': False})
            continue
        out_path = OUT_DIR / f'{slug}.json'
        json.dump({
            'title': title,
            'slug': slug,
            'url': url,
            'pubDate': ep.get('pubDate'),
            'guestName': ep.get('guestName'),
            'segments': groups,
        }, open(out_path, 'w'), indent=2)
        n_words = sum(len(g['text'].split()) for g in groups)
        print(f'  OK — {len(groups)} segments, ~{n_words} words -> {out_path.name}')
        results.append({'title': title, 'slug': slug, 'url': url, 'ok': True, 'segments': len(groups), 'words': n_words})
        time.sleep(4)

    misses = [r for r in results if not r['ok']]
    print(f'\n{"="*60}\n{len(results)-len(misses)}/{len(results)} fetched OK')
    if misses:
        print('Misses (need slug fix or alternate source):')
        for m in misses:
            print(f"  - {m['title']}  ({m['url']})")
    json.dump(results, open('/tmp/fetch_transcripts_results.json', 'w'), indent=2)

if __name__ == '__main__':
    main()
