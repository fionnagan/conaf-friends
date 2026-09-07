#!/usr/bin/env python3
"""
sync-transcripts.py
Keeps the RAG transcript corpus (scripts/ingest/transcripts/, chunks.jsonl,
and the Pinecone index behind search_episodes) in sync with new podcast
episodes, incrementally.

Run as part of the weekly ingest workflow, after fetch-podcast-rss has
refreshed scripts/cache/podcast-episodes.json. Safe to run every week: each
stage skips work it has already done (fetch-transcripts.py skips episodes
with an existing transcript file; embed-and-upsert.py skips episodes already
recorded in embedded-episodes.json), so a normal run with 0-1 new episodes
does a few seconds of work, not a full-corpus rebuild.

Usage:
  python3 scripts/ingest/sync-transcripts.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
PODCAST_CACHE = ROOT / 'scripts/cache/podcast-episodes.json'
TRANSCRIPT_DIR = ROOT / 'scripts/ingest/transcripts'
NEW_EPISODES_TMP = ROOT / 'scripts/ingest/.new-episodes.json'


def slugify(title: str) -> str:
    s = title.lower()
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[':\.\!\?,]", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


def parse_date_ymd(pub_date: str):
    m = re.search(r'(\d{1,2}) (\w{3}) (\d{4})', pub_date or '')
    if not m:
        return None
    day, mon, year = m.groups()
    months = {n: i + 1 for i, n in enumerate(
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}
    mi = months.get(mon)
    return f'{year}-{mi:02d}-{int(day):02d}' if mi else None


def has_transcript(ep) -> bool:
    """Mirrors fetch-transcripts.py's own dedup/disambiguation logic, so an episode
    it already handled (directly, or under a disambiguated slug for a title
    collision) isn't queued again."""
    base_slug = slugify(ep['title'])
    ep_date = parse_date_ymd(ep.get('pubDate'))
    base_path = TRANSCRIPT_DIR / f'{base_slug}.json'
    if not base_path.exists():
        return False
    existing = json.load(open(base_path))
    if parse_date_ymd(existing.get('pubDate')) == ep_date:
        return True
    alt_path = TRANSCRIPT_DIR / f'{base_slug}--{ep_date or "unknown"}.json'
    return alt_path.exists()


def main():
    if not PODCAST_CACHE.exists():
        print('No scripts/cache/podcast-episodes.json found — run the RSS fetch step first. '
              'Skipping RAG sync.')
        return

    episodes = json.load(open(PODCAST_CACHE))
    guest_episodes = [
        e for e in episodes
        if e.get('guestName') and not e.get('isFanSegment') and not e.get('isStaffEpisode')
    ]

    new_episodes = [e for e in guest_episodes if not has_transcript(e)]

    print(f'{len(guest_episodes)} guest episodes total, {len(new_episodes)} without a transcript yet.')

    if new_episodes:
        json.dump(new_episodes, open(NEW_EPISODES_TMP, 'w'))
        print(f'\nFetching {len(new_episodes)} new transcript(s) from podscripts.co...')
        try:
            subprocess.run(
                [sys.executable, str(ROOT / 'scripts/ingest/fetch-transcripts.py'), str(NEW_EPISODES_TMP)],
                check=True,
            )
        finally:
            NEW_EPISODES_TMP.unlink(missing_ok=True)
    else:
        print('Nothing new to fetch.')

    print('\nRebuilding chunks.jsonl from all transcripts on disk...')
    subprocess.run([sys.executable, str(ROOT / 'scripts/ingest/chunk-transcripts.py')], check=True)

    print('\nEmbedding + upserting any un-embedded episodes into Pinecone...')
    subprocess.run([sys.executable, str(ROOT / 'scripts/ingest/embed-and-upsert.py')], check=True)


if __name__ == '__main__':
    main()
