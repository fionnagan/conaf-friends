"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { countryFlag } from "@/lib/country-flags";
import fansData from "@/data/fans.json";
import coldOpensData from "@/data/cold-opens.json";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface FanRecord {
  fan_id: string;
  fan_name: string;
  country_full_name: string;
  episode_url: string;
}

interface ColdOpenRecord {
  guest_id: string;
  guest_name: string;
  profile_url: string;
  cold_open_text: string;
  feeling_phrase_normalized: string;
  embedding_vector: number[];
}

const fans       = fansData as FanRecord[];
const coldOpens  = (coldOpensData as { vocab: string[]; records: ColdOpenRecord[] }).records;

// Pre-build country → fans map
const fansByCountry: Record<string, FanRecord[]> = {};
for (const f of fans) {
  (fansByCountry[f.country_full_name] ??= []).push(f);
}

// Top 3 guests by cold-open text uniqueness (sorted by guest name for determinism)
function topGuests(n = 3) {
  const seen = new Set<string>();
  return coldOpens
    .filter((r) => r.embedding_vector.some((v) => v !== 0))
    .sort((a, b) => a.guest_name.localeCompare(b.guest_name))
    .filter((r) => { if (seen.has(r.guest_id)) return false; seen.add(r.guest_id); return true; })
    .slice(0, n);
}
const SAMPLE_GUESTS = topGuests(3);

interface CountryPanel {
  name: string;
  submissionCount: number;
  fans: FanRecord[];
  guests: typeof SAMPLE_GUESTS;
}

interface Props {
  countryCounts: Record<string, number>;
}

function colorForCount(count: number, max: number): string {
  if (count === 0) return "rgba(255,255,255,0.04)";
  const t = Math.min(count / max, 1);
  const alpha = 0.15 + t * 0.65;
  return `rgba(242,101,25,${alpha.toFixed(2)})`;
}

export default function WorldMap({ countryCounts }: Props) {
  const [tooltip, setTooltip]       = useState<{ name: string; count: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [panel, setPanel]           = useState<CountryPanel | null>(null);
  const containerRef                = useRef<HTMLDivElement>(null);

  const maxCount = useMemo(() => Math.max(...Object.values(countryCounts), 1), [countryCounts]);

  const handleEnter = useCallback((name: string, e: React.MouseEvent) => {
    const count = countryCounts[name] ?? 0;
    const rect  = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTooltip({ name, count });
  }, [countryCounts]);

  const handleMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleLeave = useCallback(() => setTooltip(null), []);

  const handleClick = useCallback((name: string) => {
    setPanel({
      name,
      submissionCount: countryCounts[name] ?? 0,
      fans: (fansByCountry[name] ?? []).slice(0, 5),
      guests: SAMPLE_GUESTS,
    });
  }, [countryCounts]);

  return (
    <div className="relative" ref={containerRef}>
      <div
        className="rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--bg2)]"
        style={{ height: 380 }}
      >
        <ComposableMap
          projection="geoNaturalEarth1"
          style={{ width: "100%", height: "100%" }}
          projectionConfig={{ scale: 140, center: [0, 10] }}
        >
          <ZoomableGroup>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const name  = geo.properties.name as string;
                  const count = countryCounts[name] ?? 0;
                  const hasFans = (fansByCountry[name]?.length ?? 0) > 0;
                  const fill  = colorForCount(count, maxCount);
                  const clickable = count > 0 || hasFans;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth={0.5}
                      style={{
                        default: { outline: "none", cursor: clickable ? "pointer" : "default" },
                        hover:   { outline: "none", fill: clickable ? "rgba(242,101,25,0.85)" : "rgba(255,255,255,0.08)" },
                        pressed: { outline: "none" },
                      }}
                      onMouseEnter={(e) => handleEnter(name, e as unknown as React.MouseEvent)}
                      onMouseMove={(e)  => handleMove(e  as unknown as React.MouseEvent)}
                      onMouseLeave={handleLeave}
                      onClick={() => handleClick(name)}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {/* Hover tooltip */}
        <AnimatePresence>
          {tooltip && (
            <motion.div
              key="tooltip"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              style={{
                left: tooltipPos.x + 12,
                top: Math.max(tooltipPos.y - 36, 8),
                pointerEvents: "none",
              }}
              className="absolute z-10 px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs shadow-xl whitespace-nowrap"
            >
              <span className="font-semibold">{countryFlag(tooltip.name)} {tooltip.name}</span>
              {tooltip.count > 0 && (
                <span className="ml-2 text-[var(--orange)]">
                  {tooltip.count} feeling{tooltip.count !== 1 ? "s" : ""}
                </span>
              )}
              {(fansByCountry[tooltip.name]?.length ?? 0) > 0 && tooltip.count === 0 && (
                <span className="ml-2 text-[var(--text-muted)]">
                  {fansByCountry[tooltip.name].length} fan{fansByCountry[tooltip.name].length !== 1 ? "s" : ""}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Country panel */}
      <AnimatePresence>
        {panel && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mt-3 p-5 bg-[var(--bg2)] rounded-2xl border border-[var(--orange)]/40 space-y-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">{countryFlag(panel.name)}</span>
                <div>
                  <p className="font-semibold text-base">{panel.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {panel.submissionCount > 0
                      ? `${panel.submissionCount} feeling${panel.submissionCount !== 1 ? "s" : ""} shared`
                      : "No submissions yet"}
                    {panel.fans.length > 0 && ` · ${panel.fans.length}${fansByCountry[panel.name]?.length > 5 ? "+" : ""} fan${panel.fans.length !== 1 ? "s" : ""} on the show`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPanel(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none px-1 flex-shrink-0"
              >
                ×
              </button>
            </div>

            {/* Fan episodes */}
            {panel.fans.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                  Fans from {panel.name} on the show
                </p>
                <div className="space-y-1.5">
                  {panel.fans.map((f) => (
                    <a
                      key={f.fan_id}
                      href={f.episode_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-3 py-2 bg-[var(--bg)] rounded-lg border border-[var(--border)] hover:border-[var(--orange)]/60 transition-colors group text-sm"
                    >
                      <span className="font-medium group-hover:text-[var(--orange)] transition-colors">{f.fan_name}</span>
                      <span className="text-xs text-[var(--text-muted)]">Listen ↗</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Sample guest matches */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                Top guest matches
              </p>
              <div className="flex flex-wrap gap-2">
                {panel.guests.map((g) => (
                  <a
                    key={g.guest_id}
                    href={g.profile_url}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg)] rounded-full border border-[var(--border)] hover:border-[var(--orange)]/60 transition-colors text-xs font-medium hover:text-[var(--orange)]"
                  >
                    {g.guest_name}
                    <span className="text-[var(--text-muted)] italic normal-case font-normal">— &quot;{g.cold_open_text}&quot;</span>
                  </a>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>Few</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: "linear-gradient(90deg, rgba(242,101,25,0.15), rgba(242,101,25,0.8))" }}
        />
        <span>Many</span>
        <span className="ml-2 opacity-60">· Click any country to explore</span>
      </div>
    </div>
  );
}
