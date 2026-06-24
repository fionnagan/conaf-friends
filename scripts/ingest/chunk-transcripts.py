#!/usr/bin/env python3
"""
chunk-transcripts.py
Chunks normalized transcript JSON (scripts/ingest/transcripts/*.json) into
~180-word windows, carrying metadata + chunk_id = {slug}#{ts_start}.

No diarization is available from the podscripts.co source (timestamp groups
only, no speaker labels) — see design doc Open Question #6. Chunks are
episode-level, not speaker-attributed.

Usage:
  python3 scripts/ingest/chunk-transcripts.py
Writes scripts/ingest/chunks.jsonl
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
TRANSCRIPT_DIR = ROOT / 'scripts/ingest/transcripts'
OUT_PATH = ROOT / 'scripts/ingest/chunks.jsonl'

TARGET_WORDS = 180

def parse_date(pub_date: str) -> str:
    m = re.search(r'(\d{1,2}) (\w{3}) (\d{4})', pub_date or '')
    if not m:
        return None
    day, mon, year = m.groups()
    months = {n: i+1 for i, n in enumerate(
        ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}
    mi = months.get(mon)
    if not mi:
        return None
    return f'{year}-{mi:02d}-{int(day):02d}'

def chunk_episode(ep: dict):
    segments = ep['segments']
    chunks = []
    cur_words, cur_text, cur_ts = [], [], None
    for seg in segments:
        if cur_ts is None:
            cur_ts = seg['ts']
        words = seg['text'].split()
        cur_words.extend(words)
        cur_text.append(seg['text'])
        if len(cur_words) >= TARGET_WORDS:
            chunks.append((cur_ts, ' '.join(cur_text)))
            cur_words, cur_text, cur_ts = [], [], None
    if cur_text:
        chunks.append((cur_ts, ' '.join(cur_text)))

    out = []
    for ts_start, text in chunks:
        out.append({
            'chunk_id': f"{ep['slug']}#{ts_start}",
            'episode_slug': ep['slug'],
            'episode_title': ep['title'],
            'guest_name': ep.get('guestName'),
            'pub_date': parse_date(ep.get('pubDate')),
            'ts_start': ts_start,
            'source_url': ep['url'],
            'diarized': False,
            'text': text,
        })
    return out

def main():
    all_chunks = []
    for path in sorted(TRANSCRIPT_DIR.glob('*.json')):
        ep = json.load(open(path))
        chunks = chunk_episode(ep)
        all_chunks.extend(chunks)
        print(f'{ep["title"]}: {len(chunks)} chunks')

    with open(OUT_PATH, 'w') as f:
        for c in all_chunks:
            f.write(json.dumps(c) + '\n')
    print(f'\n{len(all_chunks)} total chunks -> {OUT_PATH}')

if __name__ == '__main__':
    main()
