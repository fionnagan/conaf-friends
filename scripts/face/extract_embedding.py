#!/usr/bin/env python3
"""
Face detection and embedding extractor for the photo enrichment pipeline.

Tries backends in order of accuracy:
  1. face_recognition (dlib / ArcFace-class quality, 128-dim)
     pip3 install face_recognition
  2. deepface (multiple backends, auto-downloads weights)
     pip3 install deepface tf-keras
  3. None — returns faceDetected=False, embedding=null for all images

Input  (stdin or first arg): JSON  {"urls": ["https://..."], "guest_name": "..."}
Output (stdout):              JSON  {"backend": "...", "results": [...]}
"""

import sys
import json
import os
import tempfile
import urllib.request
import urllib.error
import hashlib
from pathlib import Path

# ── Determine available backend ───────────────────────────────────────────────
BACKEND = 'none'

try:
    import face_recognition  # type: ignore
    import numpy as np
    BACKEND = 'face_recognition'
except ImportError:
    try:
        from deepface import DeepFace  # type: ignore
        import numpy as np
        BACKEND = 'deepface'
    except ImportError:
        pass

# ── Image download with caching ───────────────────────────────────────────────
CACHE_DIR = Path(__file__).parent.parent / 'cache' / 'img-cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def download_image(url: str) -> Path | None:
    key = hashlib.md5(url.encode()).hexdigest()
    # Try common extensions
    for ext in ('.jpg', '.png', '.jpeg', '.webp'):
        cached = CACHE_DIR / (key + ext)
        if cached.exists():
            return cached
    ext = '.jpg'
    dest = CACHE_DIR / (key + ext)
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'FriendRegistry-Bot/1.0 (fan project)'},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read()
        dest.write_bytes(data)
        return dest
    except Exception:
        return None

# ── Cosine similarity ─────────────────────────────────────────────────────────
def cosine_sim(a, b) -> float:
    import numpy as np
    a, b = np.array(a), np.array(b)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)

# ── Per-backend extraction ────────────────────────────────────────────────────
def extract_face_recognition(path: Path) -> dict:
    img = face_recognition.load_image_file(str(path))
    locations = face_recognition.face_locations(img, model='hog')
    if not locations:
        return {'faceDetected': False, 'faceCount': 0, 'embedding': None}
    encodings = face_recognition.face_encodings(img, locations)
    if not encodings:
        return {'faceDetected': True, 'faceCount': len(locations), 'embedding': None}
    # Use the largest face (most prominent)
    largest_idx = max(
        range(len(locations)),
        key=lambda i: (locations[i][2] - locations[i][0]) * (locations[i][1] - locations[i][3])
    )
    return {
        'faceDetected': True,
        'faceCount': len(locations),
        'embedding': encodings[largest_idx].tolist(),
    }

def extract_deepface(path: Path) -> dict:
    try:
        result = DeepFace.represent(
            img_path=str(path),
            model_name='Facenet',
            enforce_detection=True,
            detector_backend='opencv',
        )
        if isinstance(result, list) and result:
            return {
                'faceDetected': True,
                'faceCount': len(result),
                'embedding': result[0]['embedding'],
            }
        return {'faceDetected': False, 'faceCount': 0, 'embedding': None}
    except Exception as e:
        if 'Face could not be detected' in str(e):
            return {'faceDetected': False, 'faceCount': 0, 'embedding': None}
        raise

def extract_none(_path: Path) -> dict:
    return {'faceDetected': False, 'faceCount': 0, 'embedding': None}

EXTRACTORS = {
    'face_recognition': extract_face_recognition,
    'deepface': extract_deepface,
    'none': extract_none,
}

# ── Main ──────────────────────────────────────────────────────────────────────
def process(urls: list[str]) -> list[dict]:
    extractor = EXTRACTORS[BACKEND]
    results = []
    for url in urls:
        entry: dict = {'url': url, 'faceDetected': False, 'faceCount': 0,
                       'embedding': None, 'error': None}
        path = download_image(url)
        if path is None:
            entry['error'] = 'download_failed'
            results.append(entry)
            continue
        try:
            data = extractor(path)
            entry.update(data)
        except Exception as e:
            entry['error'] = str(e)[:200]
        results.append(entry)
    return results

if __name__ == '__main__':
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    payload = json.loads(raw)
    urls = payload.get('urls', [])
    results = process(urls)
    print(json.dumps({'backend': BACKEND, 'results': results}))
