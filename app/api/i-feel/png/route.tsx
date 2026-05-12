import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import coldOpensData from "@/data/cold-opens.json";
import guestPhotos from "@/data/guest-photos.json";
import { countryFlag } from "@/lib/country-flags";
import React from "react";

export const runtime = "nodejs";

/* ── Types ──────────────────────────────────────────────────────────────────── */
interface ColdOpenRecord {
  guest_id: string;
  guest_name: string;
  profile_url: string;
  cold_open_text: string;
  feeling_phrase_normalized: string;
  embedding_vector: number[];
}

/* ── Data ───────────────────────────────────────────────────────────────────── */
const { vocab, records } = coldOpensData as {
  vocab: string[];
  records: ColdOpenRecord[];
};
const photos = guestPhotos as Record<string, string | null>;

/* ── TF-IDF matching ─────────────────────────────────────────────────────────── */
function normalize(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z ]/g, "").trim();
}
function vectorize(phrase: string): number[] {
  const words = normalize(phrase).split(/\s+/).filter(Boolean);
  const tf: Record<string, number> = {};
  for (const w of words) tf[w] = (tf[w] ?? 0) + 1;
  const total = Math.max(words.length, 1);
  const N = records.length;
  const df: Record<string, number> = {};
  for (const r of records) {
    const seen = new Set(r.feeling_phrase_normalized.split(/\s+/));
    for (const w of seen) df[w] = (df[w] ?? 0) + 1;
  }
  const vec = new Array(vocab.length).fill(0);
  for (const [w, count] of Object.entries(tf)) {
    const idx = vocab.indexOf(w);
    if (idx === -1) continue;
    const idf = Math.log((N + 1) / ((df[w] ?? 0) + 1));
    vec[idx] = (count / total) * idf;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Character trigram similarity between two strings.
 * Returns 0–1: 1 = identical trigram sets.
 * Used as a fallback when TF-IDF produces zero scores (query word not in vocab).
 */
function trigramSim(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const setA = new Set<string>();
  for (let i = 0; i <= a.length - 3; i++) setA.add(a.slice(i, i + 3));
  const setB = new Set<string>();
  for (let i = 0; i <= b.length - 3; i++) setB.add(b.slice(i, i + 3));
  let inter = 0;
  setA.forEach(t => { if (setB.has(t)) inter++; });
  return inter / Math.max(setA.size, setB.size);
}

/**
 * String-level relevance score between the user's feeling and a phrase.
 * Checks: exact substring → word overlap → trigram similarity (in that priority).
 */
function strRelevance(userWords: string[], phrase: string): number {
  const pNorm = normalize(phrase);
  const pWords = pNorm.split(/\s+/).filter(Boolean);
  let best = 0;
  for (const uw of userWords) {
    if (!uw) continue;
    // Exact substring in full phrase
    if (pNorm.includes(uw)) { best = Math.max(best, 1.0); continue; }
    // Trigram sim against each phrase word
    for (const pw of pWords) {
      best = Math.max(best, trigramSim(uw, pw) * 0.8);
    }
  }
  return best;
}

function findTopGuests(feeling: string, n = 3) {
  const userWords = normalize(feeling).split(/\s+/).filter(Boolean);
  const queryVec  = vectorize(feeling);
  // Detect vocab miss: if all weights are 0 the word is not in the dataset vocab
  const queryIsZero = queryVec.every(v => v === 0);

  const scored = records
    .filter((r) => r.embedding_vector.length > 0)
    .map((r) => {
      const cosScore = cosineSimilarity(queryVec, r.embedding_vector);
      const strScore = strRelevance(userWords, r.feeling_phrase_normalized);
      // When query hits vocab: TF-IDF leads, string similarity breaks ties.
      // When query misses vocab entirely: fall back to string similarity alone.
      const score = queryIsZero ? strScore : cosScore + strScore * 0.35;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const top: typeof scored = [];
  for (const r of scored) {
    if (seen.has(r.guest_id)) continue;
    seen.add(r.guest_id);
    top.push(r);
    if (top.length === n) break;
  }
  return top;
}

/* ── Fetch photo with retry on 429 ───────────────────────────────────────────── */
async function fetchBase64(url: string): Promise<string | null> {
  const UA = "FriendRegistry/1.0 (https://conaf.vercel.app)";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
      clearTimeout(id);
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 600)); continue; }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      let mime = "image/jpeg";
      if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
      else if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
      else return null;
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      if (attempt === 1) return null;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

async function fetchGuestPhotos(guests: ReturnType<typeof findTopGuests>) {
  const results = [];
  for (const g of guests) {
    const photoUrl = photos[g.guest_id];
    const b64 = photoUrl ? await fetchBase64(photoUrl) : null;
    results.push({ ...g, photoB64: b64 });
    if (guests.indexOf(g) < guests.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return results;
}

/* ── Dynamic font sizing ─────────────────────────────────────────────────────── */
const MARKER_CW = 0.50;
const BARLOW_CW = 0.62;
const USABLE_W  = 880;  // 1080px canvas − 2×100px margin
// Guest text area: (880-20)/3 cards − 2×16px padding − 100px avatar − 12px gap = 146px
const GUEST_TW  = 146;

function scaledBarlowSize(text: string, maxPx: number, minPx: number, availW = GUEST_TW): number {
  const fit = Math.floor(availW / (text.length * BARLOW_CW));
  return Math.min(maxPx, Math.max(minPx, fit));
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
/** Show up to maxWords words; truncate longer phrases with ellipsis. */
function trimToWords(text: string, maxWords = 5): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}
/**
 * Split a full guest name into two display lines.
 * Breaks at the midpoint word boundary so each line fits the 167px text column.
 * Single-word names: [name, ""].
 * Two words: [word1, word2].
 * Three+ words: first ⌈n/2⌉ words on line 1, remainder on line 2.
 */
function splitGuestName(fullName: string): [string, string] {
  const words = fullName.trim().split(/\s+/);
  if (words.length === 1) return [fullName, ""];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}
/**
 * Strip venue/event noise from guest_name and return just the person's name.
 * Handles patterns found in the data:
 *   "JB Smoove Live from the SiriusXM Garage"  → "JB Smoove"
 *   "Live with Will Arnett at the Wiltern"      → "Will Arnett"
 *   "Tom Holland and Dominic Sandbrook of The Rest Is History Podcast" → "Tom Holland"
 *   "Dave Grohl, Krist Novoselic, and Steve Albini" → "Dave Grohl"
 */
function cleanGuestName(raw: string): string {
  let name = raw.trim();

  // "Live with X at/from Y" → extract X
  const liveWith = name.match(/^live\s+with\s+(.+?)(?:\s+(?:at|from|in)\s+|\s*$)/i);
  if (liveWith) return liveWith[1].trim();

  // Strip " Live from/at/in/at..." and everything after
  name = name.replace(/\s+live\s+(from|at|in|at)\s+.*/i, "");

  // Strip " of The [Podcast / Show]..."
  name = name.replace(/\s+of\s+the?\s+.*/i, "");

  // Multiple guests separated by comma → keep first person only
  const first = name.split(/,\s+/)[0];
  // Only split on " and " when the part before it is a full name (≥2 words),
  // i.e. "Tom Holland and Dominic Sandbrook" → "Tom Holland"
  // but NOT "Kurt and Wyatt Russell" (lone first name before "and" = same family)
  const andParts = first.split(/\s+and\s+/);
  name = (andParts.length > 1 && andParts[0].trim().split(/\s+/).length >= 2)
    ? andParts[0].trim()
    : first.trim();

  return name;
}
function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── Design tokens ───────────────────────────────────────────────────────────── */
const BG      = "white";
const ORANGE  = "#FF7300";
const BLACK   = "#000000";
const MUTED   = "#8E8E8E";
const DIVIDER = "#D8D8D8";
const TILE_BG = "#F4F3F0";

/* ── Variant subtitles ───────────────────────────────────────────────────────── */
const SUBTITLES: Record<number, string> = {
  1: "I'M IN GOOD COMPANY WITH...",
  2: "PEOPLE WHO GET ME...",
  3: "MY CONAN FRIENDSHIP TWIN IS...",
  4: "MY COCO ENERGY MATCHES...",
};

/* ── GET /api/i-feel/png ─────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = (searchParams.get("name")    ?? "Someone").toUpperCase();
  const country =  searchParams.get("country")  ?? "";
  const feeling = (searchParams.get("feeling") ?? "").toUpperCase();
  const variant = Math.max(1, Math.min(4, parseInt(searchParams.get("variant") ?? "1")));
  const flag    = country ? countryFlag(country) : "🌐";

  /* Load fonts + assets */
  const fontDir = path.join(process.cwd(), "public", "fonts");
  const pubDir  = path.join(process.cwd(), "public");
  const logoDir = path.join(process.cwd(), "public", "logos");

  const [rushinkData, gothamData, permanentMarkerData, conanBuf, podcastImgBuf, conanHiBuf] = await Promise.all([
    readFile(path.join(fontDir, "Rushink.ttf")),
    readFile(path.join(fontDir, "GothamBlack_ExtraBold.otf")),
    readFile(path.join(fontDir, "PermanentMarker.ttf")),
    readFile(path.join(pubDir,  "conan_outline.png")),
    readFile(path.join(logoDir, "era-podcast.jpg")),
    readFile(path.join(pubDir,  "conan_hi.png")),
  ]);
  const conanB64   = `data:image/png;base64,${conanBuf.toString("base64")}`;
  const podcastB64 = `data:image/jpeg;base64,${podcastImgBuf.toString("base64")}`;
  const conanHiB64 = `data:image/png;base64,${conanHiBuf.toString("base64")}`;

  /* Guest matching + photos */
  const guestIdParam = searchParams.get("g") ?? "";
  const guestIds = guestIdParam ? guestIdParam.split(",").filter(Boolean) : [];

  const topGuests = guestIds.length > 0
    ? guestIds
        .map(id => records.find(r => r.guest_id === id))
        .filter((r): r is ColdOpenRecord => r !== undefined)
        .map(r => ({ ...r, score: 1 as number, embedding_vector: r.embedding_vector }))
    : findTopGuests(feeling, 3);
  const guestImgs = await fetchGuestPhotos(topGuests);

  /* ── Layout constants ── */
  const LABEL_SZ   = 62;   // "MY NAME IS" / "AND I FEEL" / "ABOUT BEING" / "CONAN O'BRIEN'S FRIEND"
  const GSECT_SZ   = 30;   // guest section subtitle — 30px per design system spec
  const GNAME_MAX  = 24;   // max per line — 24px per design system spec
  const GNAME_MIN  = 14;   // min per line — allows long names like "TRACEE ELLIS"
  // feeling phrase: max 18px / min 12px — sized for 2-line wrap (hardcoded in gquoteSz formula)
  const PHOTO_PX   = 100;
  const LOGO_PX    = 170;
  const ATTR_SZ    = 20;   // footer — 20px locked per design system spec
  const CONAN_PX   = 160;

  // No minimum on either — scales down as needed, capped at 140px per design system spec
  const nameSz = Math.min(140, Math.floor(USABLE_W / (Math.max(name.length, 1) * MARKER_CW)));
  const feelSz = Math.min(140, Math.floor(USABLE_W / (Math.max(feeling.length, 1) * MARKER_CW)));

  /* ── Style helpers ── */
  const barlow = (sz: number, color = BLACK, extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: "Gotham", fontSize: `${sz}px`, fontWeight: 800,
    color, letterSpacing: "2px", lineHeight: 1, display: "flex", ...extra,
  });
  const marker = (sz: number, color = ORANGE): React.CSSProperties => ({
    fontFamily: "Rushink", fontSize: `${sz}px`, color, lineHeight: 1.05, display: "flex",
  });

  /* ── Shared elements ── */
  const dotsRow = (
    <div style={{ display: "flex", gap: "10px" }}>
      {[0,1,2,3,4].map((i) => (
        <div key={i} style={{ width: "10px", height: "10px", borderRadius: "50%", background: ORANGE, display: "flex" }} />
      ))}
    </div>
  );

  const footerText = (
    <span style={{ fontFamily: "Gotham", fontSize: `${ATTR_SZ}px`, fontWeight: 800, color: MUTED, letterSpacing: "2.5px", display: "flex" }}>
      CONAF.VERCEL.APP · A FAN PROJECT
    </span>
  );

  /* ── Guest cards ── */
  const guestCardsEl = (
    <div style={{ display: "flex", gap: "10px", width: `${USABLE_W}px` }}>
      {guestImgs.map((g) => {
        const fullName    = cleanGuestName(g.guest_name).toUpperCase();
        const [nameLine1, nameLine2] = splitGuestName(fullName);
        const longestLine = nameLine1.length >= (nameLine2?.length ?? 0) ? nameLine1 : nameLine2;
        const feelPhrase  = trimToWords(g.feeling_phrase_normalized, 8);
        const gnameSz     = scaledBarlowSize(longestLine,    GNAME_MAX,  GNAME_MIN, GUEST_TW - 12);
        // Size for wrapping text: fit across 2 lines (GUEST_TW × 2), cap 18px, min 12px
        const gquoteSz    = scaledBarlowSize(feelPhrase, 18, 12, GUEST_TW * 2);
        return (
          <div key={g.guest_id} style={{
            display: "flex", flex: 1, alignItems: "flex-start", gap: "12px",
            background: TILE_BG, borderRadius: "16px", padding: "16px",
          }}>
            <div style={{
              display: "flex", width: `${PHOTO_PX}px`, height: `${PHOTO_PX}px`,
              borderRadius: "50%", overflow: "hidden", background: "#CCC8C2",
              flexShrink: 0, alignItems: "center", justifyContent: "center",
            }}>
              {g.photoB64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.photoB64} width={PHOTO_PX} height={PHOTO_PX}
                  style={{ objectFit: "cover", width: `${PHOTO_PX}px`, height: `${PHOTO_PX}px` }} alt="" />
              ) : (
                <span style={{ fontFamily: "Gotham", fontSize: `${Math.round(PHOTO_PX * 0.28)}px`, fontWeight: 800, color: ORANGE, display: "flex" }}>{initials(cleanGuestName(g.guest_name))}</span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: `${GUEST_TW}px`, overflow: "hidden" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontFamily: "Gotham", fontSize: `${gnameSz}px`, fontWeight: 800, color: BLACK, display: "flex", letterSpacing: "1px", lineHeight: 1.2 }}>
                  {nameLine1}
                </span>
                {nameLine2 && (
                  <span style={{ fontFamily: "Gotham", fontSize: `${gnameSz}px`, fontWeight: 800, color: BLACK, display: "flex", letterSpacing: "1px", lineHeight: 1.2 }}>
                    {nameLine2}
                  </span>
                )}
              </div>
              {/* wordBreak breaks long run-on strings; overflow hidden is the hard stop */}
              <span style={{ fontFamily: "Gotham", fontSize: `${gquoteSz}px`, color: MUTED, fontStyle: "italic", lineHeight: 1.3, wordBreak: "break-word" }}>
                &quot;{feelPhrase}&quot;
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const subtitle = SUBTITLES[variant];

  /* ═══════════════════════════════════════════════════════════════════════════
     VARIANT 1 — Left-aligned, quote mark integrated above name, explicit gaps
     ═══════════════════════════════════════════════════════════════════════════ */
  if (variant === 1) {
    /* V1-specific layout constants */
    const V1_W          = 880;   // content width: 1080 − 2×100 margin
    const V1_LABEL      = 62;    // all three labels match: MY NAME IS / AND I FEEL / ABOUT BEING
    const V1_GSECT      = 30;    // subtitle font size
    const V1_BRUSH_MAX  = 140;   // cap: 853px fixed + (140*1.05-6)*2 variable = 1135px < 1150px budget
    const V1_GNAME_MAX  = 24;    // celebrity name max — 24px per spec
    const V1_CARD_W     = (V1_W - 20) / 3;                              // ≈ 286.67px per card
    const V1_GUEST_TW   = Math.floor(V1_CARD_W - 28 - PHOTO_PX - 12);  // ≈ 147px raw text area
    // Subtract letter-spacing overhead (1px × max chars) so names never overflow tile
    const V1_NAME_TW    = V1_GUEST_TW - 12;                             // ≈ 135px for name scaling

    // Name + Feeling: no minimum — scales down as needed to fit one line, capped at V1_BRUSH_MAX
    const v1NameSz = Math.min(V1_BRUSH_MAX,
      Math.floor(V1_W / (Math.max(name.length, 1) * MARKER_CW))
    );
    const v1FeelSz = Math.min(V1_BRUSH_MAX,
      Math.floor(V1_W / (Math.max(feeling.length, 1) * MARKER_CW))
    );

    /* V1 label style helper */
    const lbl = (sz: number, color = BLACK): React.CSSProperties => ({
      fontFamily: "Gotham", fontSize: `${sz}px`, fontWeight: 800,
      color, letterSpacing: "2px", lineHeight: 1, display: "flex",
    });

    /* V1 guest cards recalculated for 880px container */
    const v1GuestCards = (
      <div style={{ display: "flex", gap: "10px", width: `${V1_W}px` }}>
        {guestImgs.map((g) => {
          const fullName  = cleanGuestName(g.guest_name).toUpperCase();
          const [nl1, nl2] = splitGuestName(fullName);
          const longest   = nl1.length >= (nl2?.length ?? 0) ? nl1 : nl2;
          const feelPhrase = trimToWords(g.feeling_phrase_normalized, 8);
          const gnsz      = scaledBarlowSize(longest,    V1_GNAME_MAX, GNAME_MIN, V1_NAME_TW);
          // Size for wrapping text: fit across 2 lines (V1_GUEST_TW × 2), cap 18px, min 12px
          const gqsz      = scaledBarlowSize(feelPhrase, 18, 12, V1_GUEST_TW * 2);
          return (
            <div key={g.guest_id} style={{
              display: "flex", flex: 1, alignItems: "flex-start", gap: "12px",
              background: TILE_BG, borderRadius: "16px", padding: "16px",
            }}>
              <div style={{
                display: "flex", width: `${PHOTO_PX}px`, height: `${PHOTO_PX}px`,
                borderRadius: "50%", overflow: "hidden", background: "#CCC8C2",
                flexShrink: 0, alignItems: "center", justifyContent: "center",
              }}>
                {g.photoB64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.photoB64} width={PHOTO_PX} height={PHOTO_PX}
                    style={{ objectFit: "cover", width: `${PHOTO_PX}px`, height: `${PHOTO_PX}px` }} alt="" />
                ) : (
                  <span style={{ fontFamily: "Gotham", fontSize: `${Math.round(PHOTO_PX * 0.28)}px`, fontWeight: 800, color: ORANGE, display: "flex" }}>
                    {initials(g.guest_name)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, maxWidth: `${V1_GUEST_TW}px`, overflow: "hidden" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "Gotham", fontSize: `${gnsz}px`, fontWeight: 800, color: BLACK, display: "flex", letterSpacing: "1px", lineHeight: 1.2 }}>
                    {nl1}
                  </span>
                  {nl2 && (
                    <span style={{ fontFamily: "Gotham", fontSize: `${gnsz}px`, fontWeight: 800, color: BLACK, display: "flex", letterSpacing: "1px", lineHeight: 1.2 }}>
                      {nl2}
                    </span>
                  )}
                </div>
                {/* wordBreak + overflow hidden contain long run-on phrases */}
                <span style={{ fontFamily: "Gotham", fontSize: `${gqsz}px`, color: MUTED, fontStyle: "italic", lineHeight: 1.3, wordBreak: "break-word" }}>
                  &quot;{feelPhrase}&quot;
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );

    const quoteFont = "PermanentMarker"; // local TTF — public/fonts/PermanentMarker.ttf

    return new ImageResponse(
      (
        <div style={{
          width: "1080px", height: "1350px", background: "white",
          display: "flex", flexDirection: "column",
          padding: "100px",  /* hard 100px margin enforced on all four sides */
        }}>

          {/* ①+② Quote mark — Permanent Marker (falls back to Rushink) */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {/* -40px marginBottom: MY NAME IS is pulled well up into quote glyph space */}
            <span style={{ fontFamily: quoteFont, fontSize: "350px", color: ORANGE, lineHeight: 0.70, display: "flex", marginTop: "-100px", marginBottom: "-55px", marginLeft: "-60px" }}>
              &ldquo;
            </span>
            <span style={lbl(V1_LABEL)}>MY NAME IS</span>
            {/* borderBottom = rule; span's own border always paints behind its text — no z-index needed */}
            <span style={{ fontFamily: "Rushink", fontSize: `${v1NameSz}px`, color: ORANGE, lineHeight: 1.05, display: "flex", borderBottom: `1px solid ${DIVIDER}` }}>
              {name}
            </span>
          </div>

          {/* #14 — 40px from name rule to "AND I FEEL" label */}
          <div style={{ height: "40px", display: "flex" }} />

          {/* ③ AND I FEEL + FEELING + rule */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={lbl(V1_LABEL)}>AND I FEEL</span>
            {/* borderBottom = rule; span's own border always paints behind its text — no z-index needed */}
            <span style={{ fontFamily: "Rushink", fontSize: `${v1FeelSz}px`, color: ORANGE, lineHeight: 1.05, display: "flex", whiteSpace: "nowrap", borderBottom: `1px solid ${DIVIDER}` }}>
              {feeling}
            </span>
          </div>

          {/* #15 — 50px from feeling rule to "ABOUT BEING" */}
          <div style={{ height: "50px", display: "flex" }} />

          {/* ④ ABOUT BEING / CONAN O'BRIEN'S FRIEND — same weight as labels */}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={lbl(V1_LABEL)}>ABOUT BEING</span>
            <span style={lbl(V1_LABEL)}>CONAN O&apos;BRIEN&apos;S FRIEND</span>
          </div>

          {/* #16 — 30px from "FRIEND" to country row */}
          {/* Country right-aligned to match end of "FRIEND" */}
          <div style={{ display: "flex", width: `${V1_W}px`, justifyContent: "flex-end", alignItems: "center", gap: "10px", marginTop: "30px" }}>
            <span style={{ fontFamily: "Gotham", fontSize: "30px", fontWeight: 800, color: MUTED, letterSpacing: "1.5px", display: "flex" }}>– FROM</span>
            <span style={{ fontSize: "36px", display: "flex", lineHeight: 1 }}>{flag}</span>
            <span style={{ fontFamily: "Gotham", fontSize: "30px", fontWeight: 800, color: MUTED, letterSpacing: "1.5px", display: "flex" }}>{country.toUpperCase()}</span>
          </div>

          {/* Fixed spacer 45px — country to guest section */}
          <div style={{ height: "45px", display: "flex" }} />

          {/* ⑥ Guest section */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontFamily: "Gotham", fontSize: `${V1_GSECT}px`, fontWeight: 800, color: ORANGE, letterSpacing: "2px", display: "flex" }}>
              {subtitle}
            </span>
            {v1GuestCards}
          </div>

          {/* Gap before footer */}
          <div style={{ height: "20px", display: "flex" }} />

          {/* ⑦ Footer — 20px per spec */}
          <span style={{ fontFamily: "Gotham", fontSize: "20px", fontWeight: 800, color: MUTED, letterSpacing: "2.5px", display: "flex" }}>
            CONAF.VERCEL.APP · A FAN PROJECT
          </span>
        </div>
      ),
      {
        width: 1080, height: 1350,
        fonts: [
          { name: "Rushink",        data: rushinkData,         style: "normal", weight: 400 },
          { name: "Gotham",         data: gothamData,          style: "normal", weight: 800 },
          { name: "PermanentMarker",data: permanentMarkerData, style: "normal", weight: 400 },
        ],
        emoji: "twemoji",
      }
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     VARIANTS 2, 3, 4 — Centered layout
     V2: Conan outline top-right corner
     V3: Conan + "hi!" speech bubble centered at top
     V4: No Conan, podcast logo in footer
     ═══════════════════════════════════════════════════════════════════════════ */

  return new ImageResponse(
    (
      <div style={{
        width: "1080px", height: "1350px", background: BG,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "space-between", padding: "100px",
        position: "relative",
      }}>

        {/* V2: Conan illustration — absolute top-right */}
        {variant === 2 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={conanB64} width={CONAN_PX} height={CONAN_PX}
            style={{ position: "absolute", top: "58px", right: "56px", objectFit: "contain" }}
            alt="" />
        )}

        {/* V3: combined hi! + Conan illustration as single image */}
        {variant === 3 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={conanHiB64} width={240} height={240}
            style={{ objectFit: "contain", marginTop: "-50px" }} alt="" />
        ) : (
          /* V2 & V4: empty top spacer (V2 uses absolute-positioned Conan) */
          <div style={{ display: "flex", height: "40px" }} />
        )}

        {/* ── Identity block: MY NAME IS → CONAN O'BRIEN'S FRIEND + country row ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: variant === 2 ? "flex-start" : "center", ...(variant === 2 ? { marginTop: "-90px" } : variant === 3 ? { marginTop: "-50px" } : variant === 4 ? { marginTop: "-70px" } : {}) }}>
          <span style={barlow(LABEL_SZ)}>MY NAME IS</span>
          {/* borderBottom rule — 880px width on all V2/3/4 so underline spans margin-to-margin */}
          <span style={{ ...marker(nameSz), whiteSpace: "nowrap", borderBottom: `1px solid ${DIVIDER}`, width: `${USABLE_W}px`, ...(variant !== 2 && { justifyContent: "center" }) }}>{name}</span>

          {/* 40px gap: name rule → label row → AND I FEEL */}
          <div style={{ height: "40px", display: "flex" }} />

          {/* V2/V3/V4: "I'M FROM [FLAG] AND I FEEL" — flag only (no country name), all at LABEL_SZ = 62px */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span style={barlow(LABEL_SZ)}>I&apos;M FROM</span>
            {/* flag at same size as labels so the row height = 62px, matching MY NAME IS */}
            <span style={{ fontSize: `${LABEL_SZ}px`, display: "flex", lineHeight: 1 }}>{flag}</span>
            <span style={barlow(LABEL_SZ)}>AND I FEEL</span>
          </div>
          {/* borderBottom rule — 880px width on all V2/3/4 so underline spans margin-to-margin */}
          <span style={{ ...marker(feelSz), whiteSpace: "nowrap", ...(variant !== 2 && { textAlign: "center", justifyContent: "center" }), borderBottom: `1px solid ${DIVIDER}`, width: `${USABLE_W}px` }}>
            {feeling}
          </span>

          {/* 50px gap: feeling rule → ABOUT BEING */}
          <div style={{ height: "50px", display: "flex" }} />

          <div style={{ display: "flex", flexDirection: "column", alignItems: variant === 2 ? "flex-start" : "center", gap: "4px" }}>
            <span style={barlow(LABEL_SZ)}>ABOUT BEING</span>
            <span style={barlow(LABEL_SZ)}>CONAN O&apos;BRIEN&apos;S FRIEND</span>
          </div>

          {/* Country row removed — flag now lives in the "I'M FROM [FLAG] AND I FEEL" label row for all variants */}
        </div>

        {/* ── Guest section — V2: left-aligned, pulled 20px closer to identity block ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: variant === 2 ? "flex-start" : "center", gap: "10px", marginTop: variant === 2 ? "-20px" : "0px" }}>
          {dotsRow}
          {/* V2/V3/V4: 20px extra gap after dots, MUTED subtitle; V1: ORANGE subtitle */}
          <span style={{ fontFamily: "Gotham", fontSize: `${GSECT_SZ}px`, fontWeight: 800, color: variant !== 1 ? MUTED : ORANGE, letterSpacing: "2px", display: "flex", ...(variant !== 1 && { marginTop: "20px" }) }}>
            {subtitle}
          </span>
          {guestCardsEl}
        </div>

        {/* ── Footer — V3 gets extra top margin to push it away from guest cards ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", ...(variant === 3 ? { marginTop: "30px" } : variant === 4 ? { marginTop: "10px" } : {}) }}>
          {variant === 4 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={podcastB64} width={LOGO_PX} height={LOGO_PX}
              style={{ borderRadius: "14px", objectFit: "cover" }} alt="" />
          )}
          {footerText}
        </div>

      </div>
    ),
    {
      width: 1080, height: 1350,
      fonts: [
        { name: "Rushink", data: rushinkData, style: "normal", weight: 400 },
        { name: "Gotham",  data: gothamData,  style: "normal", weight: 800 },
      ],
      emoji: "twemoji",
    }
  );
}
