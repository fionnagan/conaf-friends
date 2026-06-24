#!/usr/bin/env python3
"""
chunk-transcripts.py
Chunks normalized transcript JSON (scripts/ingest/transcripts/*.json) into
~180-word windows, carrying metadata + chunk_id = {slug}#{ts_start}.

No diarization is available from the podscripts.co source (timestamp groups
only, no speaker labels) — see design doc Open Question #6. Episodes follow a
3-act structure: intro banter (Conan + Sona/Matt/staff, 3+ voices, genuinely
ambiguous to attribute) -> interview (near-strictly Conan <-> guest, 2 voices)
-> outro banter (same ambiguity as the intro). We tag each chunk's
segment_type from that structure so attribution-sensitive answers can be
scoped to the interview zone instead of treating the whole transcript as one
undifferentiated blob.

Boundary detection is explicit-phrase-only (Conan announcing the guest /
thanking them), found in ~72% of celebrity-guest episodes tested. A
turn-density fallback (avg words/sentence per segment, to catch episodes that
never say the phrase) was tried and dropped — segment boundaries in the
source come from pause length, not speaker turns, so the signal bounced
between 4 and 25 with no usable threshold. Better to leave segment_type
unknown on the ~28% miss than fabricate a boundary with hidden false
confidence. Unknown-boundary chunks are treated conservatively as
non-attributable, same as banter.

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

INTRO_RE = re.compile(r'my guest|today.s guest is|i.m joined today by', re.I)
OUTRO_RE = re.compile(
    r'thank you (so much )?for (having|coming)|thanks for (having|coming)|thank you for being',
    re.I,
)


def find_boundaries(segments):
    """Returns (intro_end_idx, outro_start_idx) — segment indices marking the
    interview zone as [intro_end_idx, outro_start_idx). Either side is None
    if its announcement phrase wasn't found (segment_type stays 'unknown'
    for that side rather than guessing)."""
    intro_end = None
    for i, seg in enumerate(segments):
        if INTRO_RE.search(seg['text']):
            intro_end = i  # the announcement segment itself starts the interview
            break

    outro_start = None
    for i in range(len(segments) - 1, -1, -1):
        if OUTRO_RE.search(segments[i]['text']):
            outro_start = i + 1  # interview ends right after the thank-you line
            break

    return intro_end, outro_start


def segment_type_for(idx, intro_end, outro_start):
    if intro_end is not None and idx < intro_end:
        return 'intro_banter'
    if outro_start is not None and idx >= outro_start:
        return 'outro_banter'
    if intro_end is not None or outro_start is not None:
        return 'interview'
    return 'unknown'

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
    intro_end, outro_start = find_boundaries(segments)

    chunks = []
    cur_words, cur_text, cur_ts, cur_types = [], [], None, []
    for i, seg in enumerate(segments):
        if cur_ts is None:
            cur_ts = seg['ts']
        words = seg['text'].split()
        cur_words.extend(words)
        cur_text.append(seg['text'])
        cur_types.append(segment_type_for(i, intro_end, outro_start))
        if len(cur_words) >= TARGET_WORDS:
            chunks.append((cur_ts, ' '.join(cur_text), cur_types))
            cur_words, cur_text, cur_ts, cur_types = [], [], None, []
    if cur_text:
        chunks.append((cur_ts, ' '.join(cur_text), cur_types))

    out = []
    for ts_start, text, types in chunks:
        # Majority vote across the segments in this chunk — a chunk straddling
        # a boundary inherits whichever side it mostly belongs to.
        majority_type = max(set(types), key=types.count)
        out.append({
            'chunk_id': f"{ep['slug']}#{ts_start}",
            'episode_slug': ep['slug'],
            'episode_title': ep['title'],
            'guest_name': ep.get('guestName'),
            'pub_date': parse_date(ep.get('pubDate')),
            'ts_start': ts_start,
            'source_url': ep['url'],
            'diarized': False,
            'segment_type': majority_type,
            'attributable': majority_type == 'interview',
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

    from collections import Counter
    by_type = Counter(c['segment_type'] for c in all_chunks)
    print(f'\n{len(all_chunks)} total chunks -> {OUT_PATH}')
    print('segment_type breakdown:', dict(by_type))
    attributable = sum(1 for c in all_chunks if c['attributable'])
    print(f'attributable (interview-zone) chunks: {attributable}/{len(all_chunks)} ({attributable/len(all_chunks):.0%})')

if __name__ == '__main__':
    main()
