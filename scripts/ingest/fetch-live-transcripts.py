#!/usr/bin/env python3
"""
fetch-live-transcripts.py
Downloads the first 4 minutes of live podcast episodes, transcribes with
OpenAI Whisper, finds the cold open exchange, and writes results to
manual-cold-opens.json (and optionally to a review file for unusual phrasings).

Usage:
  python3 scripts/ingest/fetch-live-transcripts.py
  python3 scripts/ingest/fetch-live-transcripts.py --all   # also transcribe non-live missing
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

import whisper

ROOT = Path(__file__).parent.parent.parent
PODCAST_CACHE   = ROOT / 'scripts/cache/podcast-episodes.json'
MANUAL_FILE     = ROOT / 'scripts/ingest/manual-cold-opens.json'
REVIEW_FILE     = ROOT / 'scripts/ingest/live-cold-opens-review.json'

AUDIO_DURATION  = 1500   # seconds — live shows have long intro banter before the guest appears
WHISPER_MODEL   = 'small'

# ── helpers ──────────────────────────────────────────────────────────────────

def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default if default is not None else {}

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f'  Saved → {path}')

def parse_date(pub_date: str) -> str:
    for fmt in ('%a, %d %b %Y %H:%M:%S %z', '%a, %d %b %Y %H:%M:%S +0000'):
        try:
            return datetime.strptime(pub_date[:31], fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    try:
        return datetime.strptime(pub_date[:16], '%a, %d %b %Y').strftime('%Y-%m-%d')
    except Exception:
        return '2000-01-01'

def download_audio_intro(audio_url: str, wav_path: str, duration: int) -> bool:
    """Download first `duration` seconds via ffmpeg, resampled to 16kHz mono WAV."""
    cmd = [
        'ffmpeg', '-y', '-loglevel', 'error',
        '-i', audio_url,
        '-t', str(duration),
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        wav_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        return False

# ── cold open extraction ──────────────────────────────────────────────────────

# The cold open exchange: Conan asks "How do you feel about being my friend?"
# or similar variants. The guest's answer is the cold open word.
CONAN_QUESTION_RE = re.compile(
    r"how do you feel (?:about (?:being|becoming)|to be) (?:my|conan['\s]?o?['\s]?brien['\s]?s?) friend",
    re.IGNORECASE,
)
FRIEND_RE = re.compile(r"being (?:your|my|conan['\s]?o?['\s]?brien['\s]?s?) friend", re.IGNORECASE)

# Common filler words to skip at the start of a response
FILLER_RE = re.compile(
    r'^(?:i mean|well|uh+|um+|oh+|ah+|you know|honestly|honestly|look|so|like)[,\s]+',
    re.IGNORECASE,
)

def extract_cold_open_from_transcript(transcript: str) -> Optional[str]:
    """
    Find the cold open in a Whisper transcript.
    Returns the guest's feeling word/phrase, or None.
    """
    # Split into sentences / chunks for easier search
    text = transcript.strip()

    # Try to find "how do you feel about being my friend"
    m = CONAN_QUESTION_RE.search(text)
    anchor = m or FRIEND_RE.search(text)
    if not anchor:
        return None

    # Everything after the question (up to ~300 chars — next few sentences)
    after = text[anchor.end():anchor.end() + 400].strip()

    # Remove leading punctuation / speaker labels
    after = re.sub(r'^[\s\-–—:,."\']+', '', after)

    # Strip filler
    after = FILLER_RE.sub('', after)
    after = re.sub(r'^[\s,]+', '', after)

    if not after:
        return None

    # Extract first meaningful phrase (up to first sentence boundary or 80 chars)
    m2 = re.match(r'([^.!?\n]{5,80})', after)
    if m2:
        phrase = m2.group(1).strip().rstrip('.,!?')
        # Basic sanity: must contain at least one word that isn't just Conan/friend noise
        noise = {'conan', 'friend', 'obrien', "o'brien", 'i', 'a', 'the', 'my', 'your'}
        tokens = {w.lower().strip("'") for w in phrase.split()}
        if tokens - noise:
            return phrase

    return None

# ── main ─────────────────────────────────────────────────────────────────────

def should_process(ep: dict, all_missing: bool) -> bool:
    if ep.get('coldOpenWord'):
        return False
    if ep.get('isFanSegment') or ep.get('isStaffEpisode'):
        return False
    if not ep.get('guestName'):
        return False
    guest_lc = ep['guestName'].lower()
    # Exclude musical acts / non-persons
    if any(b in guest_lc for b in ['spinal tap', 'the beatles']):
        return False
    is_live = 'live' in ep.get('title', '').lower()
    return is_live or all_missing

def main():
    all_missing = '--all' in sys.argv

    eps = load_json(PODCAST_CACHE, [])
    manual = load_json(MANUAL_FILE, {})
    review = load_json(REVIEW_FILE, {})

    queue = [e for e in eps if should_process(e, all_missing)]

    print(f'Loading Whisper {WHISPER_MODEL!r} model…')
    model = whisper.load_model(WHISPER_MODEL)
    print(f'Model loaded.\n')

    print(f'Episodes to transcribe: {len(queue)}')
    if not queue:
        print('Nothing to do.')
        return

    found = 0
    for idx, ep in enumerate(queue, 1):
        title  = ep.get('title', '')
        guest  = ep.get('guestName', '')
        audio_url = ep.get('enclosure', {}).get('url', '')
        date   = parse_date(ep.get('pubDate', ''))
        key    = f'{guest}::{date}'
        is_live = 'live' in title.lower()

        print(f'\n[{idx}/{len(queue)}] {"LIVE " if is_live else "     "}{title}')
        print(f'  Guest: {guest}  Date: {date}  Key: {key}')

        if key in manual:
            print(f'  Already in manual-cold-opens: "{manual[key]}"  (skipping)')
            continue

        if not audio_url:
            print('  No audio URL — skipping')
            continue

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            wav_path = tmp.name

        try:
            duration = AUDIO_DURATION if is_live else 600
            print(f'  Downloading first {duration}s of audio…')
            ok = download_audio_intro(audio_url, wav_path, duration)
            if not ok:
                print('  ffmpeg failed — skipping')
                continue

            size_kb = os.path.getsize(wav_path) / 1024
            print(f'  Downloaded {size_kb:.0f} KB — transcribing…')

            result = model.transcribe(wav_path, language='en', fp16=False)
            transcript = result['text'].strip()
            print(f'  Transcript ({len(transcript)} chars)')

            # Debug: show around "friend" mentions
            friend_idxs = [m.start() for m in re.finditer(r'friend', transcript, re.IGNORECASE)]
            if friend_idxs:
                for fi in friend_idxs[:3]:
                    snippet = transcript[max(0,fi-60):fi+120]
                    print(f'  [friend ctx] …{snippet}…')
            else:
                print(f'  Transcript preview: {transcript[:300]}')

            cold_open = extract_cold_open_from_transcript(transcript)

            # Never auto-write to manual-cold-opens.json — regex candidates are
            # too often sponsor reads or banter near the word "friend". Always
            # save the full transcript so a human/Claude can verify the real
            # cold-open exchange before it's added to the dataset.
            if cold_open:
                print(f'\n  ~  CANDIDATE (unverified): "{cold_open}" — saving transcript for manual confirmation')
            else:
                print(f'\n  ✗  Cold open not auto-detected — saving full transcript for review')
            review[key] = {
                'title': title,
                'transcript': transcript,
                'candidate': cold_open,
                'note': 'unverified — confirm against transcript before adding to manual-cold-opens.json',
            }
            found += 1 if cold_open else 0

        finally:
            try:
                os.unlink(wav_path)
            except OSError:
                pass

    # Persist results — manual-cold-opens.json is never auto-written here;
    # only a human/Claude reviewing the transcript adds confirmed entries.
    print(f'\n{"="*60}')
    print(f'{found}/{len(queue)} had an unverified regex candidate.')
    if review:
        save_json(REVIEW_FILE, review)
        print(f'  {len(review)} transcripts saved to review file — confirm manually before adding.')

if __name__ == '__main__':
    main()
