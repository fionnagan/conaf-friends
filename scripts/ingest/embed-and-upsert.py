#!/usr/bin/env python3
"""
embed-and-upsert.py
Embeds scripts/ingest/chunks.jsonl with Voyage voyage-3 and upserts into
Upstash Vector.

Requires env vars: VOYAGE_API_KEY, UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN

Usage:
  python3 scripts/ingest/embed-and-upsert.py
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

VOYAGE_API_KEY = os.environ.get('VOYAGE_API_KEY')
UPSTASH_URL = os.environ.get('UPSTASH_VECTOR_REST_URL')
UPSTASH_TOKEN = os.environ.get('UPSTASH_VECTOR_REST_TOKEN')

VOYAGE_MODEL = 'voyage-3'
BATCH_SIZE = 32

def embed_batch(texts):
    r = requests.post(
        'https://api.voyageai.com/v1/embeddings',
        headers={'Authorization': f'Bearer {VOYAGE_API_KEY}'},
        json={'input': texts, 'model': VOYAGE_MODEL, 'input_type': 'document'},
        timeout=60,
    )
    r.raise_for_status()
    return [d['embedding'] for d in r.json()['data']]

def upsert_batch(vectors):
    r = requests.post(
        f'{UPSTASH_URL}/upsert',
        headers={'Authorization': f'Bearer {UPSTASH_TOKEN}', 'Content-Type': 'application/json'},
        json=vectors,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()

def main():
    missing = [n for n, v in [
        ('VOYAGE_API_KEY', VOYAGE_API_KEY),
        ('UPSTASH_VECTOR_REST_URL', UPSTASH_URL),
        ('UPSTASH_VECTOR_REST_TOKEN', UPSTASH_TOKEN),
    ] if not v]
    if missing:
        print(f'Missing env vars: {", ".join(missing)}. Set them and re-run.')
        sys.exit(1)

    chunks = [json.loads(l) for l in open(CHUNKS_PATH)]
    start_at = int(PROGRESS_PATH.read_text().strip()) if PROGRESS_PATH.exists() else 0
    if start_at:
        print(f'Resuming from checkpoint: skipping {start_at} already-upserted chunks')
    print(f'{len(chunks)} chunks to embed + upsert')

    for i in range(start_at, len(chunks), BATCH_SIZE):
        batch = chunks[i:i + BATCH_SIZE]
        texts = [c['text'] for c in batch]
        embeddings = embed_batch(texts)
        vectors = [
            {
                'id': c['chunk_id'],
                'vector': emb,
                'metadata': {
                    'episode_slug': c['episode_slug'],
                    'episode_title': c['episode_title'],
                    'guest_name': c['guest_name'],
                    'pub_date': c['pub_date'],
                    'ts_start': c['ts_start'],
                    'source_url': c['source_url'],
                    'diarized': c['diarized'],
                    'segment_type': c.get('segment_type', 'unknown'),
                    'attributable': c.get('attributable', False),
                    'text': c['text'],
                },
            }
            for c, emb in zip(batch, embeddings)
        ]
        try:
            upsert_batch(vectors)
        except requests.exceptions.HTTPError as exc:
            PROGRESS_PATH.write_text(str(i))
            if exc.response is not None and exc.response.status_code == 403 and 'daily write limit' in exc.response.text.lower():
                print(f'\nHit Upstash daily write limit at {i}/{len(chunks)}. '
                      f'Checkpoint saved — re-run this script after the quota resets (resets daily).')
                sys.exit(0)
            raise
        print(f'  upserted {min(i + BATCH_SIZE, len(chunks))}/{len(chunks)}')
        time.sleep(0.2)

    PROGRESS_PATH.unlink(missing_ok=True)
    print('Done.')

if __name__ == '__main__':
    main()
