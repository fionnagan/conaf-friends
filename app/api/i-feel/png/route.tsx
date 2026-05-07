import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import coldOpensData from "@/data/cold-opens.json";
import guestPhotos from "@/data/guest-photos.json";
import { countryFlag } from "@/lib/country-flags";

export const runtime = "nodejs";

/* ── Types ──────────────────────────────────────────────────────────────────── */
interface ColdOpenRecord {
  guest_id: string;
  guest_name: string;
  episode_url: string;
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

function findTopGuests(feeling: string, n = 3) {
  const queryVec = vectorize(feeling);
  const scored = records
    .filter((r) => r.embedding_vector.length > 0)
    .map((r) => ({ ...r, score: cosineSimilarity(queryVec, r.embedding_vector) }))
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

/* ── Fetch remote image as base64 (with mime detection) ─────────────────────── */
async function fetchBase64(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FriendRegistry/1.0)" },
    });
    clearTimeout(id);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    let mime = "image/jpeg";
    if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
    else if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
    else if (contentType.includes("png")) mime = "image/png";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) mime = "image/jpeg";
    else if (contentType.includes("webp")) mime = "image/webp";
    else return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/* ── Scale feeling font size to single line ──────────────────────────────────── */
const MARKER_CW = 0.60;
const MAX_W     = 900;

function scaledSize(text: string, maxPx: number): number {
  const fit = Math.floor(MAX_W / (text.length * MARKER_CW));
  return Math.min(maxPx, Math.max(40, fit));
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function shortQuote(text: string, max = 20): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── GET /api/i-feel/png ─────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = (searchParams.get("name")    ?? "Someone").toUpperCase();
  const country = searchParams.get("country") ?? "";
  const feeling = (searchParams.get("feeling") ?? "").toUpperCase();
  const flag    = country ? countryFlag(country) : "🌐";

  /* Load fonts + podcast image */
  const fontDir = path.join(process.cwd(), "public", "fonts");
  const imgDir  = path.join(process.cwd(), "public", "logos");
  const [markerData, barlowData, podcastImgBuf] = await Promise.all([
    readFile(path.join(fontDir, "PermanentMarker.ttf")),
    readFile(path.join(fontDir, "Barlow800.ttf")),
    readFile(path.join(imgDir,  "era-podcast.jpg")),
  ]);
  const podcastB64 = `data:image/jpeg;base64,${podcastImgBuf.toString("base64")}`;

  /* Find top 3 matching guests + photos */
  const topGuests = findTopGuests(feeling, 3);
  const guestImgs = await Promise.all(
    topGuests.map(async (g) => {
      const photoUrl = photos[g.guest_id];
      const b64 = photoUrl ? await fetchBase64(photoUrl) : null;
      return { ...g, photoB64: b64 };
    })
  );

  /* Colors + typography constants */
  const ORANGE = "#F26519";
  const BLACK  = "#111111";
  const RULE   = "#d0d0d0";
  const MUTED  = "#999999";
  const CARD   = "#F7F5F2";

  const DEFAULT_SZ = 96;
  const nameSz     = scaledSize(name,    DEFAULT_SZ);
  const feelSz     = scaledSize(feeling, DEFAULT_SZ);

  const FIELD_GAP = "4px";

  const barlow = (size: number, color = BLACK, extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: "Barlow",
    fontSize: `${size}px`,
    fontWeight: 800,
    color,
    letterSpacing: "3px",
    lineHeight: 1,
    display: "flex",
    ...extra,
  });

  const marker = (size: number, color = ORANGE): React.CSSProperties => ({
    fontFamily: "Marker",
    fontSize: `${size}px`,
    color,
    lineHeight: 1,
    display: "flex",
  });

  const rule: React.CSSProperties = {
    width: "940px",
    height: "2px",
    background: RULE,
    display: "flex",
  };

  return new ImageResponse(
    (
      <div style={{
        width: "1080px",
        height: "1080px",
        background: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "52px 70px 40px",
      }}>

        {/* ── FIELD 1 — Name ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: FIELD_GAP }}>
          <span style={barlow(42)}>MY NAME IS</span>
          <span style={marker(nameSz)}>{name}</span>
        </div>

        <div style={rule} />

        {/* ── FIELD 2 — Country (emoji inline, no rule after) ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span style={barlow(42)}>{`I'M FROM`}</span>
          <span style={{ fontFamily: "Barlow", fontSize: "52px", display: "flex", lineHeight: 1 }}>{flag}</span>
        </div>

        {/* ── FIELD 3 — Feeling (no rule before, flows directly after I'M FROM) ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: FIELD_GAP }}>
          <span style={barlow(42)}>AND I FEEL</span>
          <span style={marker(feelSz)}>{feeling}</span>
        </div>

        <div style={rule} />

        {/* ── GUEST AFFINITY STRIP ── */}
        {guestImgs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "940px", gap: "10px" }}>
            <span style={barlow(13, MUTED, { letterSpacing: "2px" })}>GUESTS WHO FELT THE SAME WAY</span>
            <div style={{ display: "flex", gap: "10px", width: "940px" }}>
              {guestImgs.map((g) => (
                <div
                  key={g.guest_id}
                  style={{
                    display: "flex",
                    flex: 1,
                    alignItems: "center",
                    gap: "10px",
                    background: CARD,
                    borderRadius: "14px",
                    padding: "12px",
                  }}
                >
                  {/* Circular photo */}
                  <div style={{
                    display: "flex",
                    width: "56px",
                    height: "56px",
                    borderRadius: "50%",
                    overflow: "hidden",
                    background: "#F0E8DF",
                    flexShrink: 0,
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    {g.photoB64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.photoB64} width={56} height={56} style={{ objectFit: "cover", width: "56px", height: "56px" }} alt="" />
                    ) : (
                      <span style={marker(20)}>{initials(g.guest_name)}</span>
                    )}
                  </div>
                  {/* Name + quote */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1 }}>
                    <span style={{ fontFamily: "Barlow", fontSize: "15px", fontWeight: 800, color: BLACK, display: "flex", letterSpacing: "1px" }}>
                      {g.guest_name.split(" ")[0].toUpperCase()}
                    </span>
                    <span style={{ fontFamily: "Barlow", fontSize: "12px", color: MUTED, fontStyle: "italic", display: "flex" }}>
                      &quot;{shortQuote(g.cold_open_text)}&quot;
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={rule} />

        {/* ── FOOTER — About + logo + attribution ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
            <span style={barlow(34)}>ABOUT BEING</span>
            <span style={barlow(34)}>CONAN O&apos;BRIEN&apos;S FRIEND</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={podcastB64} width={100} height={100} style={{ borderRadius: "10px", objectFit: "cover", marginTop: "6px" }} alt="" />
          <span style={{
            fontFamily: "Barlow",
            fontSize: "13px",
            fontWeight: 800,
            color: "#aaaaaa",
            letterSpacing: "2px",
            display: "flex",
          }}>
            CONAF.VERCEL.APP · A FAN PROJECT
          </span>
        </div>

      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: [
        { name: "Marker", data: markerData, style: "normal", weight: 400 },
        { name: "Barlow", data: barlowData, style: "normal", weight: 800 },
      ],
      emoji: "twemoji",
    }
  );
}
