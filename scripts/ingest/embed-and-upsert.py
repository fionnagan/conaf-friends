#!/usr/bin/env python3
"""
embed-and-upsert.py
Embeds scripts/ingest/chunks.jsonl with Voyage voyage-3 and upserts into
Pinecone (serverless index, free tier — no daily write quota, unlike
Upstash Vector's free tier which caps at 10k writes/day and is what this
migrated away from).

Requires env vars: VOYAGE_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_HOST
(PINECONE_INDEX_HOST is the per-index host from `describe_index`, e.g.
"conan-episodes-xxxxx.svc.us-east-1-aws.pinecone.io" — NOT the control-plane
api.pinecone.io host.)

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

VOYAGE_API_KEY     = os.environ.get('VOYAGE_API_KEY')
PINECONE_API_KEY   = os.environ.get('PINECONE_API_KEY')
PINECONE_INDEX_HOST = os.environ.get('PINECONE_INDEX_HOST')

VOYAGE_MODEL = 'voyage-3'
BATCH_SIZE = 50  # Pinecone recommends batches <= 100 vectors / 2MB per upsert call


def embed_batch(texts):
    r = requests.post(
        'https://api.voyageai.com/v1/embeddings',
        headers={'Authorization': f'Bearer {VOYAGE_API_KEY}'},
        json={'input': texts, 'model': VOYAGE_MODEL, 'input_type': 'document'},
        timeout=60,
    )
    r.raise_for_status()
    return [d['embedding'] for d in r.json()['data']]


def to_pinecone_metadata(c):
    """Pinecone rejects null metadata values — omit any field that's None
    instead of sending it as null (Upstash tolerated null; Pinecone doesn't)."""
    md = {
        'episode_slug': c['episode_slug'],
        'episode_title': c['episode_title'],
        'guest_name': c.get('guest_name'),
        'guest_names': c.get('guest_names') or [],
        'pub_date': c.get('pub_date'),
        'ts_start': c['ts_start'],
        'source_url': c['source_url'],
        'diarized': c['diarized'],
        'segment_type': c.get('segment_type', 'unknown'),
        'attributable': c.get('attributable', False),
        'text': c['text'],
    }
    return {k: v for k, v in md.items() if v is not None}


def upsert_batch(vectors):
    r = requests.post(
        f'https://{PINECONE_INDEX_HOST}/vectors/upsert',
        headers={'Api-Key': PINECONE_API_KEY, 'Content-Type': 'application/json'},
        json={'vectors': vectors},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def main():
    missing = [n for n, v in [
        ('VOYAGE_API_KEY', VOYAGE_API_KEY),
        ('PINECONE_API_KEY', PINECONE_API_KEY),
        ('PINECONE_INDEX_HOST', PINECONE_INDEX_HOST),
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
            {'id': c['chunk_id'], 'values': emb, 'metadata': to_pinecone_metadata(c)}
            for c, emb in zip(batch, embeddings)
        ]
        try:
            upsert_batch(vectors)
        except requests.exceptions.HTTPError as exc:
            PROGRESS_PATH.write_text(str(i))
            print(f'\nUpsert failed at {i}/{len(chunks)}: {exc}. '
                  f'Checkpoint saved — fix the issue and re-run to resume.')
            raise
        print(f'  upserted {min(i + BATCH_SIZE, len(chunks))}/{len(chunks)}')
        time.sleep(0.1)

    PROGRESS_PATH.unlink(missing_ok=True)
    print('Done.')

if __name__ == '__main__':
    main()
