#!/usr/bin/env python3
"""
backfill-metadata.py
Patches metadata (segment_type, attributable) on vectors already upserted by
an older version of embed-and-upsert.py that predated those fields — no
re-embedding, just a metadata OVERWRITE per id from the authoritative local
chunks.jsonl. Cheap relative to a full re-embed (no Voyage calls) but each
call still counts against Upstash's daily write quota, so run this BEFORE
resuming embed-and-upsert.py's checkpoint to avoid burning quota twice on
the same range.

Requires env vars: UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN

Usage:
  python3 scripts/ingest/backfill-metadata.py [end_index]
  # end_index defaults to the embed-and-upsert.py checkpoint (.embed_progress)
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent.parent
CHUNKS_PATH = ROOT / 'scripts/ingest/chunks.jsonl'
PROGRESS_PATH = ROOT / 'scripts/ingest/.embed_progress'
BACKFILL_PROGRESS_PATH = ROOT / 'scripts/ingest/.backfill_progress'

UPSTASH_URL = os.environ.get('UPSTASH_VECTOR_REST_URL')
UPSTASH_TOKEN = os.environ.get('UPSTASH_VECTOR_REST_TOKEN')

def update_metadata(chunk):
    body = {
        'id': chunk['chunk_id'],
        'metadata': {
            'episode_slug': chunk['episode_slug'],
            'episode_title': chunk['episode_title'],
            'guest_name': chunk['guest_name'],
            'pub_date': chunk['pub_date'],
            'ts_start': chunk['ts_start'],
            'source_url': chunk['source_url'],
            'diarized': chunk['diarized'],
            'segment_type': chunk.get('segment_type', 'unknown'),
            'attributable': chunk.get('attributable', False),
            'text': chunk['text'],
        },
        'metadataUpdateMode': 'OVERWRITE',
    }
    r = requests.post(
        f'{UPSTASH_URL}/update',
        headers={'Authorization': f'Bearer {UPSTASH_TOKEN}', 'Content-Type': 'application/json'},
        json=body, timeout=30,
    )
    r.raise_for_status()
    return r.json()

def main():
    if not (UPSTASH_URL and UPSTASH_TOKEN):
        print('Missing UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN. Set them and re-run.')
        sys.exit(1)

    chunks = [json.loads(l) for l in open(CHUNKS_PATH)]

    if len(sys.argv) > 1:
        end_index = int(sys.argv[1])
    elif PROGRESS_PATH.exists():
        end_index = int(PROGRESS_PATH.read_text().strip())
    else:
        print('No end_index given and no .embed_progress checkpoint found. '
              'Pass the range explicitly, e.g.: python3 backfill-metadata.py 9248')
        sys.exit(1)

    start_at = int(BACKFILL_PROGRESS_PATH.read_text().strip()) if BACKFILL_PROGRESS_PATH.exists() else 0
    target = chunks[:end_index]
    print(f'Backfilling metadata for chunks [{start_at}:{end_index}] of {len(chunks)} total')

    for i in range(start_at, len(target)):
        chunk = target[i]
        try:
            update_metadata(chunk)
        except requests.exceptions.HTTPError as exc:
            BACKFILL_PROGRESS_PATH.write_text(str(i))
            if exc.response is not None and exc.response.status_code == 403 and 'daily write limit' in exc.response.text.lower():
                print(f'\nHit Upstash daily write limit at {i}/{len(target)}. '
                      f'Checkpoint saved — re-run after the quota resets.')
                sys.exit(0)
            raise
        if (i + 1) % 100 == 0 or i + 1 == len(target):
            print(f'  patched {i + 1}/{len(target)}')
        time.sleep(0.05)

    BACKFILL_PROGRESS_PATH.unlink(missing_ok=True)
    print('Done. Now safe to resume embed-and-upsert.py for the remaining chunks.')

if __name__ == '__main__':
    main()
