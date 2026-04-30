#!/usr/bin/env python3
"""
Conan O'Brien typographic word cloud.

All words horizontal. Min font: 14 px in 2048 output.
Dark navy background matching the app's dark module bg.
Words are the only visual — they paint the head like brush strokes.

Phase 0b: Hair strands — one word per strand, repeated along flow-field path.
Phase 1:  Spiral        — most frequent phrases as large anchors.
Phase 2:  Body fill     — phrases + tokens, each word used ≤ 3×.

Output: public/conan-wordcloud.png  (2048×2048 RGB, dark navy bg)
"""

import json, sys, os, re, math
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent
DATA_FILE   = BASE_DIR / "data" / "guests.json"
MASK_FILE   = BASE_DIR / "public" / "conan-head.png"
OUTPUT_FILE = BASE_DIR / "public" / "conan-wordcloud.png"

# ── Canvas ─────────────────────────────────────────────────────────────────
SCALE = 8
W = H = 256 * SCALE   # 2048 × 2048

MIN_FONT = 14          # absolute floor for every word

BG_COLOR = (14, 17, 23)   # #0e1117 — matches app dark bg

# ── Font ───────────────────────────────────────────────────────────────────
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
    "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    str(BASE_DIR / "node_modules/next/dist/compiled/@vercel/og/"
        "noto-sans-v27-latin-regular.ttf"),
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
FONT_PATH = next((f for f in FONT_CANDIDATES if os.path.exists(f)), None)
if not FONT_PATH:
    print("ERROR: no font found"); sys.exit(1)
print(f"Font : {FONT_PATH}")

_fc: dict = {}
def font(size: int) -> ImageFont.FreeTypeFont:
    if size not in _fc:
        _fc[size] = ImageFont.truetype(FONT_PATH, max(MIN_FONT, size))
    return _fc[size]

_mc: dict = {}
def measure(word: str, fs: int):
    k = (word, fs)
    if k not in _mc:
        bb = font(fs).getbbox(word)
        _mc[k] = (bb[2]-bb[0], bb[3]-bb[1], bb[0], bb[1])
    return _mc[k]

# ── Load mask ──────────────────────────────────────────────────────────────
raw  = Image.open(MASK_FILE).convert("RGBA").resize((W, H), Image.LANCZOS)
rgba = np.array(raw)
R = rgba[..., 0].astype(np.int32)
G = rgba[..., 1].astype(np.int32)
B = rgba[..., 2].astype(np.int32)
A = rgba[..., 3]

mask    = (A >= 30) & ~((R > 230) & (G > 230) & (B > 230))
is_hair = mask & (R > 160) & (G < 160) & (B < 90) & (R - B > 100)
is_dark = mask & (R < 100) & (G < 80)  & (B < 70)

print(f"Mask : {W}×{H}  {mask.sum():,} px  ({is_hair.sum():,} hair)")

# ── Canvases ───────────────────────────────────────────────────────────────
used   = np.zeros((H, W), dtype=bool)
canvas = Image.new("RGB", (W, H), BG_COLOR)
draw   = ImageDraw.Draw(canvas)

# ── Colors ─────────────────────────────────────────────────────────────────
ORANGE      = (242, 101,  34)
WARM_WHITE  = (238, 228, 212)   # warm off-white for face/body on dark bg
LIGHT_CREAM = (210, 198, 178)   # slightly dimmer for fill variation

def word_color(cx: int, cy: int) -> tuple:
    px, py = max(0, min(W-1, cx)), max(0, min(H-1, cy))
    if is_hair[py, px]: return ORANGE
    if (cx // 50 + cy // 50) % 3 == 0:
        return LIGHT_CREAM
    return WARM_WHITE

# ── Placement helpers ──────────────────────────────────────────────────────
def can_bbox(x1, y1, x2, y2):
    if x1 < 0 or y1 < 0 or x2 > W or y2 > H: return False
    for sy in range(y1, y2, 2):
        if not mask[sy, x1:x2:2].all() or used[sy, x1:x2:2].any(): return False
    return True

def can_line(x1, iy, x2):
    if x1 < 0 or x2 > W or iy < 0 or iy >= H or x2 <= x1: return False
    return bool(mask[iy, x1:x2].all()) and not bool(used[iy, x1:x2].any())

def mark(x1, y1, x2, y2, pad=0):
    used[max(0,y1-pad):min(H,y2+pad), max(0,x1-pad):min(W,x2+pad)] = True

def render(x, y, word, fs, color):
    tw, th, lo, to = measure(word, fs)
    draw.text((x - lo, y - to), word, font=font(fs), fill=color)

# ── Load words ─────────────────────────────────────────────────────────────
with open(DATA_FILE) as f:
    data = json.load(f)

STOP = {
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "by","from","is","it","as","be","this","that","i","my","me","we","he",
    "she","they","his","her","its","our","just","very","so","not","no",
    "him","them","was","are","been","have","had","has","do","did","does",
}

phrases = []
for guest in data.get("guests", []):
    for appr in guest.get("appearances", []):
        w = appr.get("coldOpenWord", "").strip()
        if w: phrases.append(w.lower())

freq: dict[str, int] = {}
for p in phrases:
    freq[p] = freq.get(p, 0) + 1

split_tokens: list[str] = []
for p in freq:
    for tok in re.split(r"[\s\-]+", p):
        tok = re.sub(r"[^a-z']+", "", tok)
        if len(tok) > 2 and tok not in STOP and tok not in freq:
            split_tokens.append(tok)
split_tokens = list(dict.fromkeys(split_tokens))
split_tokens.sort(key=len)

all_tokens     = list(freq.keys()) + split_tokens
sorted_phrases = sorted(freq.items(), key=lambda x: -x[1])
max_freq       = sorted_phrases[0][1]
CX, CY         = W // 2, int(H * 0.48)

print(f"Words: {len(phrases)} cold opens → {len(freq)} phrases, "
      f"{len(split_tokens)} split tokens")

# ── Hair flow field ────────────────────────────────────────────────────────
hair_r   = np.where(is_hair, R.astype(np.float32), 0.0)
blur_img = Image.fromarray(np.clip(hair_r, 0, 255).astype(np.uint8))
for _ in range(4): blur_img = blur_img.filter(ImageFilter.BLUR)
blur_arr = np.array(blur_img).astype(np.float32)

gy_raw   = np.gradient(blur_arr, axis=0)
gx_raw   = np.gradient(blur_arr, axis=1)
flow_mag = np.sqrt(gy_raw**2 + gx_raw**2) + 1e-8
flow_x_n = np.where(is_hair,  gy_raw / flow_mag, 0.0)
flow_y_n = np.where(is_hair, -gx_raw / flow_mag, 0.0)

_PATH_STEP = 2.5

def trace_strand(sx, sy, fwd=True, n_steps=800):
    path, x, y = [], float(sx), float(sy)
    pdx = pdy = None
    sign = 1.0 if fwd else -1.0
    for _ in range(n_steps):
        ix, iy = int(x), int(y)
        if not (1 <= ix < W-1 and 1 <= iy < H-1): break
        if not is_hair[iy, ix]: break
        path.append((ix, iy))
        vx = flow_x_n[iy, ix] * sign
        vy = flow_y_n[iy, ix] * sign
        if pdx is not None and vx*pdx + vy*pdy < 0: vx, vy = -vx, -vy
        pdx, pdy = vx, vy
        x += _PATH_STEP * vx; y += _PATH_STEP * vy
    return path

face_region = mask & ~is_hair
face_exp    = (np.roll(face_region,-1,0)|np.roll(face_region,1,0)|
               np.roll(face_region,-1,1)|np.roll(face_region,1,1))
outer_exp   = (np.roll(~mask,-1,0)|np.roll(~mask,1,0)|
               np.roll(~mask,-1,1)|np.roll(~mask,1,1))
all_seeds   = np.vstack([np.argwhere(is_hair & face_exp),
                         np.argwhere(is_hair & outer_exp)])
s_angs      = np.arctan2(all_seeds[:,0].astype(float)-CY,
                         all_seeds[:,1].astype(float)-CX)
all_seeds   = all_seeds[np.argsort(s_angs)]

# ── Phase 0b: Hair strands ─────────────────────────────────────────────────
print("Phase 0b: hair strands …")

N_STRANDS  = 14           # fewer = thicker, more distinct brush strokes like the cartoon
STRAND_FS  = max(MIN_FONT, 28)  # 28px — large enough to read as bold brush stroke

strand_words = sorted(freq.keys(), key=lambda w: (len(w), -freq[w]))[:N_STRANDS]
strand_set   = set(strand_words)

s_step  = max(1, len(all_seeds) // N_STRANDS)
seeds   = all_seeds[::s_step][:N_STRANDS]
s_total = 0

for idx, (sy_, sx_) in enumerate(seeds):
    if idx >= len(strand_words): break
    sword      = strand_words[idx]
    scolor     = ORANGE
    sx, sy     = int(sx_), int(sy_)
    fwd_path   = trace_strand(sx, sy, fwd=True)
    bwd_path   = trace_strand(sx, sy, fwd=False)
    bwd_path.reverse()
    path = bwd_path + fwd_path[1:]
    if len(path) < 8: continue

    tw, th, lo, to = measure(sword, STRAND_FS)
    i = 0
    while i < len(path):
        px, py = path[i]
        row_y  = py - th // 2
        if row_y < 0 or row_y + th >= H or px < 0 or px + tw >= W:
            i += 1; continue
        if can_line(px, py, px + tw):
            render(px, row_y, sword, STRAND_FS, scolor)
            mark(px, row_y, px + tw, row_y + th, pad=2)
            s_total += 1
            i += max(2, int((tw + 2) / _PATH_STEP))
        else:
            i += 1

print(f"         placed {s_total} strand words  labels={strand_words}")

# ── Phase 1: Archimedean spiral ────────────────────────────────────────────
print("Phase 1: spiral anchors …")

MIN_SPIRAL = max(MIN_FONT, SCALE * 3)   # 24 px
MAX_SPIRAL = SCALE * 6                   # 48 px — no monster words dwarfing the rest

p1_placed = 0
for word, wfreq in sorted_phrases:
    if word in strand_set: continue
    t       = (wfreq / max_freq) ** 0.55
    base_fs = int(MIN_SPIRAL + t * (MAX_SPIRAL - MIN_SPIRAL))
    placed  = False
    for size_step in range(8):
        fs = max(MIN_SPIRAL, int(base_fs * (0.80 ** size_step)))
        tw, th, _, _ = measure(word, fs)
        for step in range(20000):
            ang = step * 0.11
            rad = step * 0.38
            wcx = int(CX + rad * math.cos(ang))
            wcy = int(CY + rad * math.sin(ang) * 0.90)
            x1, y1 = wcx - tw//2, wcy - th//2
            if not can_bbox(x1, y1, x1+tw, y1+th): continue
            render(x1, y1, word, fs, word_color(wcx, wcy))
            mark(x1, y1, x1+tw, y1+th, pad=SCALE//4)
            placed = True; p1_placed += 1; break
        if placed: break

print(f"         placed {p1_placed}/{len(sorted_phrases)} phrases")

snap = np.array(canvas)
# Mark as used any pixel that differs from the bg color
is_bg = ((snap[...,0]==BG_COLOR[0]) & (snap[...,1]==BG_COLOR[1]) &
         (snap[...,2]==BG_COLOR[2]))
used |= ~is_bg

# ── Phase 2: Body fill — each word ≤ 3× ───────────────────────────────────
print("Phase 2: body fill …")

MAX_REPS  = 3
fill_pool = []
for r in range(MAX_REPS):
    fill_pool.extend(all_tokens)

# Graduated fill sizes — smooth cascade to fill gaps at every scale
FILL_SIZES = [36, 28, 22, 18, 16, 14]

tIdx       = 0
fill_total = 0

for fs in FILL_SIZES:
    fs     = max(MIN_FONT, fs)
    f_obj  = font(fs)
    th_ref = f_obj.getbbox("Mg")[3] - f_obj.getbbox("Mg")[1]
    stride = th_ref + 1
    pass_n = 0

    for row_y in range(0, H - th_ref, stride):
        iy = min(H-1, row_y + th_ref // 2)
        x  = 0
        while x < W:
            if not mask[iy, x]:  x += 1; continue
            if used[iy, x]:      x += 1; continue
            placed = False
            for attempt in range(12):
                word = fill_pool[(tIdx + attempt) % len(fill_pool)]
                tw, th, _, _ = measure(word, fs)
                x2 = x + tw
                if can_line(x, iy, x2):
                    render(x, row_y, word, fs, word_color(x + tw//2, iy))
                    mark(x, row_y, x2, row_y + th)
                    x     = x2 + 1
                    tIdx += attempt + 1
                    placed = True; pass_n += 1; break
            if not placed:
                tIdx += 1; x += 1

    fill_total += pass_n
    print(f"         {fs}px → {pass_n} placements")

print(f"         fill total: {fill_total}")

# ── Post-process ───────────────────────────────────────────────────────────
print("Post-processing …")
out_arr = np.array(canvas)
# Only enforce bg color outside the head mask — inside gaps stay dark (bg shows through)
out_arr[~mask] = list(BG_COLOR)

Image.fromarray(out_arr.astype(np.uint8), "RGB").save(
    str(OUTPUT_FILE), "PNG", optimize=True)
print(f"✓  {OUTPUT_FILE}  ({W}×{H} px)")
