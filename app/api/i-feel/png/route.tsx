import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

// Approximate character widths for single-line scaling
const MARKER_CW = 0.62;  // Permanent Marker
const BARLOW_CW = 0.55;  // Barlow 800 (non-condensed)
const MAX_W     = 900;   // usable px inside 1080px canvas

function scaledSize(text: string, maxPx: number, cw: number): number {
  const fit = MAX_W / (text.length * cw);
  return Math.min(maxPx, Math.floor(fit));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = (searchParams.get("name")    ?? "Someone").toUpperCase();
  const country = (searchParams.get("country") ?? "").toUpperCase();
  const feeling = (searchParams.get("feeling") ?? "").toUpperCase();

  const fontDir = path.join(process.cwd(), "public", "fonts");
  const imgDir  = path.join(process.cwd(), "public", "logos");

  const [markerData, barlowData, podcastImgBuf] = await Promise.all([
    readFile(path.join(fontDir, "PermanentMarker.ttf")),
    readFile(path.join(fontDir, "Barlow800.ttf")),
    readFile(path.join(imgDir,  "era-podcast.jpg")),
  ]);

  const podcastB64 = `data:image/jpeg;base64,${podcastImgBuf.toString("base64")}`;

  // Font sizes — shrink to single line if needed
  const nameSz    = scaledSize(name, 108, MARKER_CW);
  const countrySz = scaledSize(country, 90, MARKER_CW);
  const feelSz    = scaledSize(feeling, 96, MARKER_CW);

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
        padding: "60px 70px 36px",
      }}>

        {/* ── ZONE 1 — Name / country / "and i feel" ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>

          {/* MY NAME IS  →  {name} */}
          <span style={barlow(42)}>MY NAME IS</span>
          <span style={marker(nameSz)}>{name}</span>

          <div style={{ ...rule, margin: "10px 0 10px" }} />

          {/* I'M FROM  →  {country} */}
          <span style={barlow(42)}>I'M FROM</span>
          <span style={marker(countrySz)}>{country}</span>

          <div style={{ ...rule, margin: "10px 0 10px" }} />

          {/* AND I FEEL */}
          <span style={barlow(42)}>AND I FEEL</span>
        </div>

        {/* ── ZONE 2 — Feeling ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
          <span style={{ ...marker(feelSz), textAlign: "center" }}>{feeling}</span>
        </div>

        {/* ── ZONE 3 — Footer ── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0px" }}>
          <div style={{ ...rule, marginBottom: "16px" }} />
          <span style={barlow(38)}>ABOUT BEING</span>
          <span style={barlow(38)}>CONAN O'BRIEN'S FRIEND</span>

          {/* Podcast cover image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={podcastB64}
            width={160}
            height={160}
            style={{ borderRadius: "14px", marginTop: "20px", objectFit: "cover" }}
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
            marginTop: "14px",
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
    }
  );
}
