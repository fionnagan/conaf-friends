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

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

/**
 * world-atlas GeoJSON uses different country name strings than our COUNTRIES list.
 * Map GeoJSON names → our canonical names so countryCounts lookups match.
 */
const GEO_TO_CANONICAL: Record<string, string> = {
  "United States of America": "United States",
  "Russian Federation":        "Russia",
  "Republic of Korea":         "South Korea",
  "Dem. Rep. Korea":           "North Korea",
  "Dem. Rep. Congo":           "Congo",
  "Czech Republic":            "Czech Republic", // same, but just in case
  "Macedonia":                 "North Macedonia",
  "Ivory Coast":               "Ivory Coast",
  "Côte d'Ivoire":             "Ivory Coast",
  "Lao PDR":                   "Laos",
  "Viet Nam":                  "Vietnam",
  "Myanmar":                   "Myanmar",
  "Palestinian Territory":     "Palestine",
  "Bosnia and Herz.":          "Bosnia and Herzegovina",
  "Central African Rep.":      "Central African Republic",
  "Eq. Guinea":                "Equatorial Guinea",
  "W. Sahara":                 "Western Sahara",
  "S. Sudan":                  "South Sudan",
  "Dominican Rep.":            "Dominican Republic",
  "Trinidad and Tobago":       "Trinidad and Tobago",
  "United Republic of Tanzania": "Tanzania",
  "Swaziland":                 "Eswatini",
  "Fr. S. Antarctic Lands":    "Antarctica",
};

interface CountrySubmission {
  topFeelings: { feeling: string; count: number }[];
  fans: { name: string; feeling: string }[];
}

interface CountryPanel {
  name: string;
  submissionCount: number;
  data: CountrySubmission | null;
  loading: boolean;
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

  const handleClick = useCallback(async (name: string) => {
    const submissionCount = countryCounts[name] ?? 0;
    // Open panel immediately with loading state
    setPanel({ name, submissionCount, data: null, loading: true });

    try {
      const res = await fetch(`/api/i-feel/country?name=${encodeURIComponent(name)}`);
      const json: CountrySubmission = await res.json();
      setPanel((prev) =>
        prev?.name === name ? { ...prev, data: json, loading: false } : prev
      );
    } catch {
      setPanel((prev) =>
        prev?.name === name ? { ...prev, data: { topFeelings: [], fans: [] }, loading: false } : prev
      );
    }
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
                  const geoName   = geo.properties.name as string;
                  const canonical = GEO_TO_CANONICAL[geoName] ?? geoName;
                  const count     = countryCounts[canonical] ?? 0;
                  const fill      = colorForCount(count, maxCount);
                  const clickable = count > 0;
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
                      onMouseEnter={(e) => handleEnter(canonical, e as unknown as React.MouseEvent)}
                      onMouseMove={(e)  => handleMove(e  as unknown as React.MouseEvent)}
                      onMouseLeave={handleLeave}
                      onClick={() => clickable && handleClick(canonical)}
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

            {panel.loading && (
              <div className="space-y-2">
                <div className="h-3 bg-[var(--bg)] rounded animate-pulse w-32" />
                <div className="h-3 bg-[var(--bg)] rounded animate-pulse w-48" />
              </div>
            )}

            {!panel.loading && panel.data && (
              <>
                {/* Fan submitter names + their full feeling phrase */}
                {panel.data.fans.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                      Fans from {panel.name}
                    </p>
                    <div className="space-y-1.5">
                      {panel.data.fans.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3 py-2 bg-[var(--bg)] rounded-lg border border-[var(--border)] text-sm"
                        >
                          <span className="font-medium flex-shrink-0">{f.name}</span>
                          <span className="text-xs text-[var(--text-muted)] italic truncate max-w-[160px] ml-2">
                            {f.feeling}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Most-submitted full feeling phrases */}
                {panel.data.topFeelings.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                      Most common feelings here
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {panel.data.topFeelings.map(({ feeling, count }) => (
                        <span
                          key={feeling}
                          className="px-2.5 py-1 bg-[var(--bg)] rounded-full border border-[var(--border)] text-xs font-medium"
                        >
                          {feeling}
                          {count > 1 && (
                            <span className="ml-1 text-[var(--orange)] font-semibold">×{count}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {panel.data.topFeelings.length === 0 && panel.data.fans.length === 0 && (
                  <p className="text-sm text-[var(--text-muted)]">No submissions yet from this country.</p>
                )}
              </>
            )}
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
        <span className="ml-2 opacity-60">· Click any highlighted country to explore</span>
      </div>
    </div>
  );
}
