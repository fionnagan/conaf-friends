import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name    = searchParams.get("name")    ?? "Someone";
  const country = searchParams.get("country") ?? "";
  const feeling = searchParams.get("feeling") ?? "";

  const totalLen = name.length + country.length + feeling.length;
  const fontSize = totalLen > 50 ? 34 : totalLen > 35 ? 40 : 46;

  // Build the sentence as a single string — simplest Satori-compatible approach
  const sentence = `My name is ${name}${country ? `, I'm from ${country}` : ""}, and I feel ${feeling} about being Conan O'Brien's friend.`;

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "#0a0a0a", fontFamily: "Georgia, serif" }}>

        {/* Top orange stripe */}
        <div style={{ width: "1200px", height: "8px", background: "#F26522", display: "flex" }} />

        {/* Header */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "20px", padding: "28px 60px 20px 60px" }}>
          {/* Logo placeholder circle */}
          <div style={{ width: "64px", height: "64px", borderRadius: "10px", background: "#F26522", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "white", fontSize: "30px", fontWeight: "900", display: "flex" }}>C</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ color: "#F26522", fontSize: "13px", fontWeight: "700", letterSpacing: "2px", display: "flex" }}>
              CONAN O&apos;BRIEN NEEDS A FRIEND
            </span>
            <span style={{ color: "#555", fontSize: "11px", letterSpacing: "2px", display: "flex" }}>
              THE FRIEND REGISTRY
            </span>
          </div>
        </div>

        {/* Main sentence — single block */}
        <div style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 80px" }}>
          <span style={{
            color: "#ffffff",
            fontSize: `${fontSize}px`,
            lineHeight: "1.35",
            fontWeight: "700",
            textAlign: "center",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: "1000px",
          }}>
            {sentence}
          </span>
        </div>

        {/* Bottom bar */}
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: "18px 60px", borderTop: "1px solid #1f1f1f" }}>
          <span style={{ color: "#444", fontSize: "13px", display: "flex" }}>conaf.vercel.app</span>
          <span style={{ color: "#F26522", fontSize: "13px", fontWeight: "600", display: "flex" }}>#ConanFriend</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
