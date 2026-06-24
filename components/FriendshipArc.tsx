"use client";

import { useRef, useState } from "react";
import type { Guest, Era } from "@/lib/types";
import {
  ERA_LABELS,
  ERA_LOGOS,
  ERA_YEARS,
  getEraColor,
  getEraTextColor,
  formatDate,
} from "@/lib/data";
import { usePlayer } from "@/lib/PlayerContext";

const ERAS: Era[] = [
  "late-night-nbc",
  "tonight-show",
  "tbs-conan",
  "podcast",
  "conan-must-go",
];

// Eras overlap in real time (the podcast has run alongside TBS and Must Go), so a single
// linear time axis makes a dot's era ambiguous. Instead we give each era its own
// non-overlapping segment and place each appearance within its OWN era's segment by date —
// so a TBS dot is always under the TBS section, a podcast dot under Needs a Friend, etc.
const ERA_BOUNDS: Record<Era, [number, number]> = {
  "late-night-nbc": [1993.7, 2009.15],
  "tonight-show": [2009.4, 2010.06],
  "tbs-conan": [2010.85, 2021.48],
  podcast: [2018.75, 2026.5],
  "conan-must-go": [2024.3, 2026.5],
};
// Segment width weights (≈ era length in years, floored so short eras stay visible).
const ERA_WEIGHT: Record<Era, number> = {
  "late-night-nbc": 16,
  "tonight-show": 3,
  "tbs-conan": 11,
  podcast: 8,
  "conan-must-go": 3,
};

const GAP = 1; // % gap between segments
const totalWeight = ERAS.reduce((s, e) => s + ERA_WEIGHT[e], 0);
const totalGap = GAP * (ERAS.length - 1);

// Precompute each era's segment [startPct, widthPct].
const SEGMENTS: Record<Era, { start: number; width: number }> = (() => {
  const out = {} as Record<Era, { start: number; width: number }>;
  let cursor = 0;
  for (const era of ERAS) {
    const width = (ERA_WEIGHT[era] / totalWeight) * (100 - totalGap);
    out[era] = { start: cursor, width };
    cursor += width + GAP;
  }
  return out;
})();

// Read in UTC: dates are calendar dates parsed as UTC midnight, so local getters
// would shift a Jan-1 appearance into the previous year on the arc.
const yearOf = (d: string) =>
  new Date(d).getUTCFullYear() + new Date(d).getUTCMonth() / 12;

// Map an appearance to a horizontal % within its own era's segment (inset from the edges).
function appearanceToPercent(era: Era, date: string): number {
  const seg = SEGMENTS[era];
  const [lo, hi] = ERA_BOUNDS[era];
  const frac = hi > lo ? Math.min(1, Math.max(0, (yearOf(date) - lo) / (hi - lo))) : 0.5;
  const inset = seg.width * 0.1;
  return seg.start + inset + frac * (seg.width - inset * 2);
}

interface Props {
  guest: Guest;
  compact?: boolean;
}

interface TooltipState {
  visible: boolean;
  x: number;
  content: string;
}

export default function FriendshipArc({ guest, compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, content: "" });
  const { play } = usePlayer();

  const height = compact ? 80 : 116;
  const baselineTop = compact ? 52 : 72; // px from top to the timeline baseline
  const dotSize = compact ? 5 : 6;

  return (
    <div
      ref={containerRef}
      className="relative select-none w-full"
      style={{ height }}
    >
      {/* Era segment bands */}
      {ERAS.map((era) => {
        const seg = SEGMENTS[era];
        return (
          <div
            key={`band-${era}`}
            className="absolute top-0 bottom-0 rounded-sm"
            style={{
              left: `${seg.start}%`,
              width: `${seg.width}%`,
              backgroundColor: getEraColor(era),
              opacity: 0.5,
            }}
          />
        );
      })}

      {/* Era labels (logo + name + years) */}
      {!compact &&
        ERAS.map((era) => {
          const seg = SEGMENTS[era];
          const logo = ERA_LOGOS[era];
          return (
            <div
              key={`label-${era}`}
              className="absolute flex flex-col items-center gap-0.5 text-center leading-none"
              style={{ left: `${seg.start + seg.width / 2}%`, top: 4, transform: "translateX(-50%)", width: `${seg.width}%` }}
            >
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" width={14} height={14} style={{ borderRadius: 2, objectFit: "contain" }} />
              )}
              <span style={{ fontSize: 8, fontWeight: 600, color: getEraTextColor(era) }}>
                {ERA_LABELS[era]}
              </span>
              <span style={{ fontSize: 7, color: "#9A9590" }}>{ERA_YEARS[era]}</span>
            </div>
          );
        })}

      {/* Timeline baseline */}
      <div className="absolute" style={{ top: baselineTop, left: 0, right: 0, height: 2, backgroundColor: "#E8E4DC", opacity: 0.25 }} />

      {/* Appearance dots */}
      {guest.appearances.map((app, i) => {
        const x = appearanceToPercent(app.era, app.date);
        const color = getEraTextColor(app.era);
        const playable = app.audioUrl || app.youtubeVideoId || app.episodeUrl;
        return (
          <div key={i}>
            {app.era === "podcast" && app.coldOpenWord && !compact && (
              <div
                className="absolute italic whitespace-nowrap"
                style={{
                  left: `${x}%`,
                  top: baselineTop - 20,
                  transform: "translateX(-50%)",
                  fontSize: 8,
                  fontFamily: "Fraunces, Georgia, serif",
                  color,
                }}
              >
                {app.coldOpenWord.length > 12 ? app.coldOpenWord.slice(0, 12) + "…" : app.coldOpenWord}
              </div>
            )}
            <button
              type="button"
              aria-label={`${formatDate(app.date)} · ${ERA_LABELS[app.era]}`}
              className="absolute rounded-full"
              style={{
                left: `${x}%`,
                top: baselineTop,
                width: dotSize,
                height: dotSize,
                transform: "translate(-50%, -50%)",
                backgroundColor: color,
                cursor: playable ? "pointer" : "default",
                border: "none",
                padding: 0,
              }}
              onMouseEnter={() =>
                setTooltip({
                  visible: true,
                  x,
                  content: `${formatDate(app.date)} · ${ERA_LABELS[app.era]}${app.episodeTitle ? ` · "${app.episodeTitle}"` : ""}${app.coldOpenWord ? ` · "${app.coldOpenWord}"` : ""}`,
                })
              }
              onMouseLeave={() => setTooltip((t) => ({ ...t, visible: false }))}
              onClick={() => {
                if (app.audioUrl || app.youtubeVideoId) play(app, guest.name);
                else if (app.episodeUrl) window.open(app.episodeUrl, "_blank");
              }}
            />
          </div>
        );
      })}

      {/* Tooltip */}
      {tooltip.visible && (
        <div className="tooltip" style={{ left: `${Math.min(tooltip.x, 70)}%`, top: baselineTop - 44 }}>
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
