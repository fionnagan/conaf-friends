import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

// Approximate character widths for single-line scaling
const MARKER_CW = 0.62;  // Permanent Marker
const MAX_W     = 900;   // usable px inside 1080px canvas

/** Only shrinks below maxPx if text would overflow MAX_W — never expands. */
function scaledSize(text: string, maxPx: number): number {
  const fit = MAX_W / (text.length * MARKER_CW);
  return Math.min(maxPx, Math.floor(fit));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = (searchParams.get("name")    ?? "Someone").toUpperCase();
  const country = (searchParams.get("country") ?? "").toUpperCase();
  const feeling = (searchParams.get("feeling") ?? "").toUpperCase();
  // Feeling can be up to 5 words per updated spec


  const fontDir = path.join(process.cwd(), "public", "fonts");
  const imgDir  = path.join(process.cwd(), "public", "logos");

  const [markerData, barlowData, podcastImgBuf] = await Promise.all([
    readFile(path.join(fontDir, "PermanentMarker.ttf")),
    readFile(path.join(fontDir, "Barlow800.ttf")),
    readFile(path.join(imgDir,  "era-podcast.jpg")),
  ]);

  const podcastB64 = `data:image/jpeg;base64,${podcastImgBuf.toString("base64")}`;

  // Typography rules per spec: all three share same default size (96px);
  // name + country are fixed (never shrink); feeling shrinks ONLY if it overflows.
  const DEFAULT_SZ  = 96;
  const nameSz      = DEFAULT_SZ;
  const countrySz   = DEFAULT_SZ;
  const feelSz      = scaledSize(feeling, DEFAULT_SZ);

  const ORANGE = "#F26519";
  const BLACK  = "#111111";
  const RULE   = "#d0d0d0";

  // Shared style builders
  const barlow = (size: number, color = BLACK): React.CSSProperties => ({
    fontFamily: "Barlow",
    fontSize: `${size}px`,
    fontWeight: 800,
    color,
    letterSpacing: "3px",
    lineHeight: 1,
    display: "flex",
  });

  const marker = (size: number): React.CSSProperties => ({
    fontFamily: "Marker",
    fontSize: `${size}px`,
    color: ORANGE,
    lineHeight: 1,
    display: "flex",
  });

  const rule: React.CSSProperties = {
    width: "940px",
    height: "2px",
    background: RULE,
    display: "flex",
  };

  // Field block: label (Barlow) + value (Marker) — identical gap above/below for all 3
  const FIELD_GAP = "6px";   // between label and value
  const RULE_GAP  = "22px";  // symmetrical margin on both sides of each rule

  return new ImageResponse(
    (
      <div style={{
        width: "1080px",
        height: "1080px",
        background: "white",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "58px 70px 40px",
      }}>

        {/* ── FIELD 1 — Name ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: FIELD_GAP }}>
          <span style={barlow(42)}>MY NAME IS</span>
          <span style={marker(nameSz)}>{name}</span>
        </div>

        <div style={{ ...rule, margin: `${RULE_GAP} 0` }} />

        {/* ── FIELD 2 — Country ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: FIELD_GAP }}>
          <span style={barlow(42)}>{"I'M FROM"}</span>
          <span style={marker(countrySz)}>{country}</span>
        </div>

        <div style={{ ...rule, margin: `${RULE_GAP} 0` }} />

        {/* ── FIELD 3 — Feeling ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: FIELD_GAP }}>
          <span style={barlow(42)}>AND I FEEL</span>
          <span style={marker(feelSz)}>{feeling}</span>
        </div>

        <div style={{ ...rule, margin: `${RULE_GAP} 0` }} />

        {/* ── FOOTER — About being + logo ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", flex: 1, justifyContent: "center" }}>
          <span style={barlow(38)}>ABOUT BEING</span>
          <span style={barlow(38)}>{"CONAN O'BRIEN'S FRIEND"}</span>
        </div>

        {/* Podcast cover image — larger gap from text above */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={podcastB64}
          width={160}
          height={160}
          style={{ borderRadius: "14px", objectFit: "cover" }}
          alt=""
        />

        {/* Attribution */}
        <span style={{
          fontFamily: "Barlow",
          fontSize: "13px",
          fontWeight: 800,
          color: "#aaaaaa",
          letterSpacing: "2px",
          display: "flex",
          marginTop: "16px",
        }}>
          CONAF.VERCEL.APP · A FAN PROJECT
        </span>

      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: [
        { name: "Marker", data: markerData, style: "normal", weight: 400 },
        { name: "Barlow", data: barlowData, style: "normal", weight: 800 },
      ],
    }
  );
}
