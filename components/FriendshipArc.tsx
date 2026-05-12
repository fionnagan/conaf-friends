"use client";

import { useRef, useState } from "react";
import type { Guest, Era } from "@/lib/types";
import {
  ERA_LABELS,
  ERA_LOGOS,
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

const ERA_DATE_RANGES: Record<Era, [number, number]> = {
  "late-night-nbc": [1993, 2009],
  "tonight-show": [2009, 2010],
  "tbs-conan": [2010, 2021],
  podcast: [2018, 2026],
  "conan-must-go": [2023, 2026],
};

// TOTAL_END = 2027 gives 2026 a right-margin so it renders inside the viewBox
const TOTAL_START = 1993;
const TOTAL_END = 2027;
const TOTAL_SPAN = TOTAL_END - TOTAL_START;

function yearToPercent(year: number): number {
  return ((year - TOTAL_START) / TOTAL_SPAN) * 100;
}

function dateToPercent(dateStr: string): number {
  const year = new Date(dateStr).getFullYear() + new Date(dateStr).getMonth() / 12;
  return yearToPercent(year);
}


interface Props {
  guest: Guest;
  compact?: boolean;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: string;
}

export default function FriendshipArc({ guest, compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: "",
  });
  const { play } = usePlayer();

  const height = compact ? 80 : 120;

  return (
    <div ref={containerRef} className="relative select-none">
      {/* Timeline SVG */}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 1000 ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Era background bands */}
        {ERAS.map((era) => {
          const [start, end] = ERA_DATE_RANGES[era];
          const x = yearToPercent(start) * 10;
          const w = (yearToPercent(end) - yearToPercent(start)) * 10;
          const color = getEraColor(era);
          return (
            <rect
              key={era}
              x={x}
              y={0}
              width={w}
              height={height}
              fill={color}
              opacity={0.35}
            />
          );
        })}

        {/* Era labels (top) — logo image + name */}
        {!compact &&
          ERAS.map((era) => {
            const [start, end] = ERA_DATE_RANGES[era];
            const midX = ((yearToPercent(start) + yearToPercent(end)) / 2) * 10;
            const textColor = getEraTextColor(era);
            const logo = ERA_LOGOS[era];
            const logoSize = 14;
            return (
              <g key={era}>
                {logo && (
                  <image
                    href={logo}
                    x={midX - logoSize / 2}
                    y={2}
                    width={logoSize}
                    height={logoSize}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ borderRadius: 2 }}
                  />
                )}
                <text
                  x={midX}
                  y={logo ? 28 : 14}
                  textAnchor="middle"
                  fontSize={8}
                  fill={textColor}
                  fontWeight="600"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {ERA_LABELS[era]}
                </text>
              </g>
            );
          })}

        {/* Timeline baseline */}
        <line
          x1={0}
          y1={height / 2 + 10}
          x2={1000}
          y2={height / 2 + 10}
          stroke="#E8E4DC"
          strokeWidth={2}
        />

        {/* Appearance dots */}
        {guest.appearances.map((app, i) => {
          const x = dateToPercent(app.date) * 10;
          const cy = height / 2 + 10;
          const dotColor = getEraTextColor(app.era);

          return (
            <g key={i}>
              {/* Cold open word label */}
              {app.era === "podcast" && app.coldOpenWord && !compact && (
                <text
                  x={x}
                  y={cy - 18}
                  textAnchor="middle"
                  fontSize={8}
                  fill={dotColor}
                  fontStyle="italic"
                  fontFamily="Fraunces, Georgia, serif"
                >
                  {app.coldOpenWord.length > 12
                    ? app.coldOpenWord.slice(0, 12) + "…"
                    : app.coldOpenWord}
                </text>
              )}

              {/* Dot */}
              <circle
                cx={x}
                cy={cy}
                r={compact ? 5 : 7}
                fill={dotColor}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  const svgRect = (e.target as SVGElement)
                    .closest("svg")
                    ?.getBoundingClientRect();
                  if (!svgRect || !rect) return;
                  const relX =
                    ((e.clientX - svgRect.left) / svgRect.width) * 100;
                  setTooltip({
                    visible: true,
                    x: relX,
                    y: 0,
                    content: `${formatDate(app.date)} · ${ERA_LABELS[app.era]}${app.episodeTitle ? ` · "${app.episodeTitle}"` : ""}${app.coldOpenWord ? ` · "${app.coldOpenWord}"` : ""}`,
                  });
                }}
                onMouseLeave={() =>
                  setTooltip((t) => ({ ...t, visible: false }))
                }
                onClick={() => {
                  if (app.audioUrl || app.youtubeVideoId) {
                    play(app, guest.name);
                  } else if (app.episodeUrl) {
                    window.open(app.episodeUrl, "_blank");
                  }
                }}
              />
            </g>
          );
        })}

        {/* Year markers */}
        {[1993, 2000, 2009, 2010, 2018, 2026].map((yr) => {
          const x = yearToPercent(yr) * 10;
          return (
            <g key={yr}>
              <line
                x1={x}
                y1={height / 2 + 7}
                x2={x}
                y2={height / 2 + 13}
                stroke="#C8C4BC"
                strokeWidth={1}
              />
              {!compact && (
                <text
                  x={x}
                  y={height - 4}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#9A9590"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {yr}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="tooltip"
          style={{
            left: `${Math.min(tooltip.x, 70)}%`,
            top: "-32px",
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
