import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

// Node runtime so we can read font files from disk
export const runtime = "nodejs";

// Satori char-width approximations for single-line scaling
const MARKER_CHAR_W   = 0.62; // Permanent Marker
const BARLOW_CHAR_W   = 0.42; // Barlow Condensed 800
const MAX_TEXT_PX     = 940;  // usable width inside 1080px card

function scaledSize(text: string, maxPx: number, charW: number): number {
  // start at maxPx, shrink so text * charW * size <= MAX_TEXT_PX
  const fit = MAX_TEXT_PX / (text.length * charW);
  return Math.min(maxPx, Math.floor(fit));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = (searchParams.get("name")    ?? "Someone").toUpperCase();
  const country = (searchParams.get("country") ?? "").toUpperCase();
  const feeling = (searchParams.get("feeling") ?? "").toUpperCase();

  // Load fonts from public/fonts/
  const fontDir = path.join(process.cwd(), "public", "fonts");
  const [markerData, barlowData] = await Promise.all([
    readFile(path.join(fontDir, "PermanentMarker.ttf")),
    readFile(path.join(fontDir, "BarlowCondensed800.ttf")),
  ]);

  // Font sizes — scale down if text is long to keep single line
  const nameSz    = scaledSize(name, 110, MARKER_CHAR_W);
  const countrySz = scaledSize(`I'M FROM ${country}`, 72, MARKER_CHAR_W);
  const feelSz    = scaledSize(feeling, 90, MARKER_CHAR_W);

  // Brand colours
  const ORANGE = "#F26519";
  const BLACK  = "#111111";
  const RULE   = "#d0d0d0";

  // Shared style helpers
  const barlow = (size: number, color = BLACK): React.CSSProperties => ({
    fontFamily: "Barlow",
    fontSize: `${size}px`,
    fontWeight: 800,
    color,
    letterSpacing: "4px",
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
    width: "960px",
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
        padding: "70px 60px 40px",
      }}>

        {/* ── ZONE 1 — Name block ─────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
          <span style={barlow(44)}>MY NAME IS</span>
          <span style={marker(nameSz)}>{name}</span>
          {country && (
            <span style={marker(countrySz)}>{`I'M FROM ${country}`}</span>
          )}
          <div style={{ ...rule, marginTop: "10px" }} />
          <span style={{ ...barlow(44), marginTop: "10px" }}>AND I FEEL</span>
        </div>

        {/* ── ZONE 2 — Feeling ────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
          <span style={{ ...marker(feelSz), textAlign: "center" }}>{feeling}</span>
        </div>

        {/* ── ZONE 3 — Footer block ───────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0px" }}>
          <div style={{ ...rule, marginBottom: "18px" }} />
          <span style={barlow(44)}>ABOUT BEING</span>
          <span style={barlow(44)}>CONAN O'BRIEN'S FRIEND</span>

          {/* Podcast logo reproduction */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "28px", lineHeight: 1 }}>
            <span style={{ ...barlow(74, ORANGE), letterSpacing: "2px" }}>CONAN</span>
            <span style={{ ...barlow(74, ORANGE), letterSpacing: "2px" }}>O'BRIEN</span>
            <span style={{ ...barlow(30), letterSpacing: "6px", marginTop: "4px" }}>NEEDS A FRIEND</span>
          </div>

          {/* Attribution footnote */}
          <span style={{
            fontFamily: "Barlow",
            fontSize: "14px",
            fontWeight: 800,
            color: "#aaaaaa",
            letterSpacing: "2px",
            display: "flex",
            marginTop: "18px",
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
        { name: "Marker", data: markerData,  style: "normal", weight: 400 },
        { name: "Barlow", data: barlowData,  style: "normal", weight: 800 },
      ],
    }
  );
}
