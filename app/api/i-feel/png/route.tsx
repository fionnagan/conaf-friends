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

/* ── Fetch photo sequentially (avoids Wikimedia 429 rate-limit) ──────────────── */
async function fetchBase64(url: string): Promise<string | null> {
  const UA = "FriendRegistry/1.0 (https://conaf.vercel.app)";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": UA },
      });
      clearTimeout(id);
      if (res.status === 429) {
        // Rate limited — wait and retry once
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
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

/* ── Fetch 3 guest photos sequentially to avoid rate-limiting ────────────────── */
async function fetchGuestPhotos(guests: ReturnType<typeof findTopGuests>) {
  const results = [];
  for (const g of guests) {
    const photoUrl = photos[g.guest_id];
    const b64 = photoUrl ? await fetchBase64(photoUrl) : null;
    results.push({ ...g, photoB64: b64 });
    // Small stagger between requests
    if (guests.indexOf(g) < guests.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return results;
}

/* ── Scale marker font to fit usable width ───────────────────────────────────── */
const MARKER_CW = 0.60;
const USABLE_W  = 900;

function scaledSize(text: string, maxPx: number, minPx = 56): number {
  const fit = Math.floor(USABLE_W / (text.length * MARKER_CW));
  return Math.min(maxPx, Math.max(minPx, fit));
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function shortQuote(text: string, max = 12): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── GET /api/i-feel/png ─────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = (searchParams.get("name")    ?? "Someone").toUpperCase();
  const country = searchParams.get("country")  ?? "";
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

  /* Guest matching + sequential photo fetch */
  const topGuests = findTopGuests(feeling, 3);
  const guestImgs = await fetchGuestPhotos(topGuests);

  /* ── Design tokens ── */
  const ORANGE = "#F26519";
  const BLACK  = "#111111";
  const RULE   = "#d0d0d0";
  const MUTED  = "#888888";
  const CARD   = "#F5F3F0";

  // Canvas: 1080×1350 — 4:5 portrait (native IG feed, works in stories too)
  // "MY NAME IS" label = 52px  →  guest names "just a tad smaller" = 44px
  const LABEL_SZ  = 52;   // "MY NAME IS" / "I'M FROM…AND I FEEL"
  const ABOUT_SZ  = 46;   // "ABOUT BEING CONAN O'BRIEN'S FRIEND"
  const GSECT_SZ  = 34;   // "GUESTS WHO FELT THE SAME WAY"
  const GNAME_SZ  = 44;   // guest first name — just a tad smaller than LABEL_SZ
  const GQUOTE_SZ = 27;   // guest feeling quote
  const PHOTO_PX  = 112;  // guest circle diameter
  const LOGO_PX   = 110;  // podcast logo
  const ATTR_SZ   = 15;   // attribution footer

  const nameSz  = scaledSize(name,    150, 64);
  const feelSz  = scaledSize(feeling, 150, 64);

  /* Style helpers */
  const barlow = (sz: number, color = BLACK, extra: React.CSSProperties = {}): React.CSSProperties => ({
    fontFamily: "Barlow",
    fontSize: `${sz}px`,
    fontWeight: 800,
    color,
    letterSpacing: "2.5px",
    lineHeight: 1,
    display: "flex",
    ...extra,
  });
  const marker = (sz: number, color = ORANGE): React.CSSProperties => ({
    fontFamily: "Marker",
    fontSize: `${sz}px`,
    color,
    lineHeight: 1.05,
    display: "flex",
  });
  const ruleDiv = (
    <div style={{ width: "940px", height: "2px", background: RULE, display: "flex", marginTop: "18px" }} />
  );

  return new ImageResponse(
    (
      <div style={{
        width:  "1080px",
        height: "1350px",
        background: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "68px 70px 58px",
      }}>

        {/* ── A: Name ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
          <span style={barlow(LABEL_SZ)}>MY NAME IS</span>
          <span style={marker(nameSz)}>{name}</span>
          {ruleDiv}
        </div>

        {/* ── B: Country + Feeling ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span style={barlow(LABEL_SZ)}>{`I'M FROM`}</span>
            <span style={{ fontFamily: "Barlow", fontSize: `${LABEL_SZ + 12}px`, display: "flex", lineHeight: 1 }}>{flag}</span>
            <span style={barlow(LABEL_SZ)}>AND I FEEL</span>
          </div>
          <span style={{ ...marker(feelSz), maxWidth: "940px", textAlign: "center", justifyContent: "center" }}>
            {feeling}
          </span>
          {ruleDiv}
        </div>

        {/* ── C: About ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
          <span style={barlow(ABOUT_SZ)}>ABOUT BEING</span>
          <span style={barlow(ABOUT_SZ)}>CONAN O&apos;BRIEN&apos;S FRIEND</span>
        </div>

        {/* ── D: Guest affinity strip ── */}
        {guestImgs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "940px", gap: "14px" }}>
            <span style={barlow(GSECT_SZ, MUTED, { letterSpacing: "2px" })}>GUESTS WHO FELT THE SAME WAY</span>
            <div style={{ display: "flex", gap: "10px", width: "940px" }}>
              {guestImgs.map((g) => (
                <div
                  key={g.guest_id}
                  style={{
                    display: "flex",
                    flex: 1,
                    alignItems: "center",
                    gap: "14px",
                    background: CARD,
                    borderRadius: "20px",
                    padding: "16px",
                  }}
                >
                  {/* Circular photo */}
                  <div style={{
                    display: "flex",
                    width: `${PHOTO_PX}px`,
                    height: `${PHOTO_PX}px`,
                    borderRadius: "50%",
                    overflow: "hidden",
                    background: "#EDE8E2",
                    flexShrink: 0,
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    {g.photoB64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.photoB64}
                        width={PHOTO_PX}
                        height={PHOTO_PX}
                        style={{ objectFit: "cover", width: `${PHOTO_PX}px`, height: `${PHOTO_PX}px` }}
                        alt=""
                      />
                    ) : (
                      <span style={marker(Math.round(PHOTO_PX * 0.3))}>{initials(g.guest_name)}</span>
                    )}
                  </div>

                  {/* Name + quote */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "7px", flex: 1 }}>
                    <span style={{
                      fontFamily: "Barlow", fontSize: `${GNAME_SZ}px`, fontWeight: 800,
                      color: BLACK, display: "flex", letterSpacing: "1px", lineHeight: 1,
                    }}>
                      {g.guest_name.split(" ")[0].toUpperCase()}
                    </span>
                    <span style={{
                      fontFamily: "Barlow", fontSize: `${GQUOTE_SZ}px`,
                      color: MUTED, fontStyle: "italic", display: "flex", lineHeight: 1.1,
                    }}>
                      &quot;{shortQuote(g.cold_open_text)}&quot;
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── E: Logo + attribution ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={podcastB64} width={LOGO_PX} height={LOGO_PX}
            style={{ borderRadius: "12px", objectFit: "cover" }} alt="" />
          <span style={{
            fontFamily: "Barlow", fontSize: `${ATTR_SZ}px`, fontWeight: 800,
            color: "#aaaaaa", letterSpacing: "2.5px", display: "flex",
          }}>
            CONAF.VERCEL.APP · A FAN PROJECT
          </span>
        </div>

      </div>
    ),
    {
      width:  1080,
      height: 1350,
      fonts: [
        { name: "Marker", data: markerData, style: "normal", weight: 400 },
        { name: "Barlow", data: barlowData, style: "normal", weight: 800 },
      ],
      emoji: "twemoji",
    }
  );
}
