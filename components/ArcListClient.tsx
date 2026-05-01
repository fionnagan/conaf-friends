"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import type { Guest, Era } from "@/lib/types";
import Image from "next/image";
import { ERA_LABELS, ERA_LOGOS, getEraTextColor } from "@/lib/data";
import GuestAvatar from "./GuestAvatar";
import LazyArc from "./LazyArc";
import GuestModal from "./GuestModal";

const HOST_NAME = "Conan O'Brien";
const ERAS: Era[] = ["late-night-nbc", "tonight-show", "tbs-conan", "podcast", "conan-must-go"];
const MIN_APP_OPTIONS = [0, 2, 4, 8] as const;

interface AiChip {
  label: string;
  key: string;
}

interface ParsedFilters {
  eras?: Era[];
  minAppearances?: number | null;
  dateRange?: [string, string] | null;
  occupations?: string[];
  nameHint?: string | null;
  chips?: AiChip[];
}

function guestBadge(g: Guest): string | null {
  const eras = new Set(g.appearances.map((a) => a.era)).size;
  const n = g.appearances.length;
  if (eras >= 4) return "Cross-Era Legend";
  if (eras >= 3) return "Cross-Era Guest";
  if (n >= 15) return "Conan Institution";
  if (n >= 8) return "Series Regular";
  if (n >= 4) return "Frequent Guest";
  if (n >= 2) return "Recurring Guest";
  return null;
}

interface Props {
  guests: Guest[];
}

export default function ArcListClient({ guests }: Props) {
  const [nameQuery, setNameQuery] = useState("");
  const [aiChips, setAiChips] = useState<AiChip[]>([]);
  const [aiFilters, setAiFilters] = useState<ParsedFilters>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedEras, setSelectedEras] = useState<Era[]>([]);
  const [minAppearances, setMinAppearances] = useState<0 | 2 | 4 | 8>(0);
  const [selectedOccupations, setSelectedOccupations] = useState<string[]>([]);
  const [modalGuest, setModalGuest] = useState<Guest | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Top occupations by frequency (guests with bios)
  const topOccupations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of guests) {
      for (const p of g.bio?.profession ?? []) {
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([occ]) => occ);
  }, [guests]);

  const runAiSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.trim().length < 3) {
      setAiChips([]);
      setAiFilters({});
      return;
    }
    setAiLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data: ParsedFilters = await res.json();
      setAiChips(data.chips ?? []);
      setAiFilters(data);
    } catch {
      // silent fail — normal text search still works
    } finally {
      setAiLoading(false);
    }
  }, []);

  function handleSearchChange(value: string) {
    setNameQuery(value);
    clearTimeout(debounceRef.current);
    // Only fire AI for queries that look like sentences (contain space or digits)
    if (value.length >= 3 && (value.includes(" ") || /\d/.test(value))) {
      debounceRef.current = setTimeout(() => runAiSearch(value), 600);
    } else if (value.length === 0) {
      setAiChips([]);
      setAiFilters({});
    }
  }

  function removeAiChip(key: string) {
    setAiChips((prev) => prev.filter((c) => c.key !== key));
    setAiFilters((prev) => {
      const next = { ...prev };
      if (key === "era") delete next.eras;
      if (key === "date") delete next.dateRange;
      if (key === "min_appearances") delete next.minAppearances;
      if (key === "occupation") delete next.occupations;
      if (key === "name") delete next.nameHint;
      return next;
    });
  }

  function toggleEra(era: Era) {
    setSelectedEras((prev) =>
      prev.includes(era) ? prev.filter((e) => e !== era) : [...prev, era]
    );
  }

  function toggleOccupation(occ: string) {
    setSelectedOccupations((prev) =>
      prev.includes(occ) ? prev.filter((o) => o !== occ) : [...prev, occ]
    );
  }

  function clearAll() {
    setNameQuery("");
    setSelectedEras([]);
    setMinAppearances(0);
    setSelectedOccupations([]);
    setAiChips([]);
    setAiFilters({});
  }

  const filtered = useMemo(() => {
    let result = guests.filter((g) => g.name !== HOST_NAME);

    // Name / AI name hint
    const nameFilter = nameQuery || aiFilters.nameHint;
    if (nameFilter) {
      result = result.filter((g) =>
        g.name.toLowerCase().includes(nameFilter.toLowerCase())
      );
    }

    // Era filter — manual + AI combined
    const eras = [...selectedEras, ...(aiFilters.eras ?? [])];
    if (eras.length > 0) {
      result = result.filter((g) =>
        g.appearances.some((a) => eras.includes(a.era))
      );
    }

    // AI date range
    if (aiFilters.dateRange) {
      const [start, end] = aiFilters.dateRange;
      result = result.filter((g) =>
        g.appearances.some((a) => a.date >= start && a.date <= end)
      );
    }

    // Min appearances — take the stricter of manual vs AI
    const minApp = Math.max(minAppearances, aiFilters.minAppearances ?? 0);
    if (minApp > 0) {
      result = result.filter((g) => g.appearances.length >= minApp);
    }

    // Occupation filter — manual + AI combined
    const occs = [...selectedOccupations, ...(aiFilters.occupations ?? [])];
    if (occs.length > 0) {
      result = result.filter((g) => {
        const profs = g.bio?.profession ?? [];
        return occs.some((occ) =>
          profs.some((p) => p.toLowerCase().includes(occ.toLowerCase()))
        );
      });
    }

    return result;
  }, [guests, nameQuery, selectedEras, minAppearances, selectedOccupations, aiFilters]);

  const hasFilters =
    !!nameQuery ||
    selectedEras.length > 0 ||
    minAppearances > 0 ||
    selectedOccupations.length > 0 ||
    aiChips.length > 0;

  return (
    <div>
      {/* ── Search & filters ─────────────────────────────────────── */}
      <div className="mb-8 space-y-3">
        {/* Search bar */}
        <div className="relative">
          <input
            type="search"
            placeholder="Search by name, or describe a guest…"
            value={nameQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full px-4 py-2.5 bg-[var(--bg2)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--orange)] placeholder:text-[var(--text-muted)]"
          />
          {aiLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--orange)] border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* AI chips */}
        {aiChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {aiChips.map((chip, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                style={{
                  background: "rgba(242,101,34,0.12)",
                  border: "1px solid rgba(242,101,34,0.35)",
                  color: "var(--orange)",
                }}
              >
                {chip.label}
                <button
                  onClick={() => removeAiChip(chip.key)}
                  className="opacity-70 hover:opacity-100"
                  aria-label="Remove filter"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Era toggles */}
        <div className="flex flex-wrap gap-2">
          {ERAS.map((era) => {
            const active = selectedEras.includes(era);
            const color = getEraTextColor(era);
            const logo = ERA_LOGOS[era];
            return (
              <button
                key={era}
                onClick={() => toggleEra(era)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                style={
                  active
                    ? { background: color + "22", borderColor: color, color }
                    : { borderColor: "var(--border)", color: "var(--text-muted)" }
                }
              >
                {logo && (
                  <Image
                    src={logo}
                    alt={ERA_LABELS[era]}
                    width={16}
                    height={16}
                    className="rounded-sm object-cover flex-shrink-0"
                    style={{ opacity: active ? 1 : 0.5 }}
                  />
                )}
                {ERA_LABELS[era]}
              </button>
            );
          })}
        </div>

        {/* Appearances + Occupations */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span>Appeared</span>
            {MIN_APP_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setMinAppearances(n as 0 | 2 | 4 | 8)}
                className="px-2 py-0.5 rounded border text-xs transition-colors"
                style={
                  minAppearances === n
                    ? {
                        background: "rgba(242,101,34,0.15)",
                        borderColor: "rgba(242,101,34,0.4)",
                        color: "var(--orange)",
                      }
                    : { borderColor: "var(--border)", color: "var(--text-muted)" }
                }
              >
                {n === 0 ? "any" : `≥${n}×`}
              </button>
            ))}
          </div>

          {topOccupations.map((occ) => {
            const active = selectedOccupations.includes(occ);
            return (
              <button
                key={occ}
                onClick={() => toggleOccupation(occ)}
                className="px-2.5 py-0.5 rounded-full border text-xs capitalize transition-colors"
                style={
                  active
                    ? {
                        background: "rgba(127,119,221,0.15)",
                        borderColor: "rgba(127,119,221,0.4)",
                        color: "var(--purple)",
                      }
                    : { borderColor: "var(--border)", color: "var(--text-muted)" }
                }
              >
                {occ}
              </button>
            );
          })}
        </div>

        {/* Count + clear */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)]">
            {filtered.length} guest{filtered.length !== 1 ? "s" : ""}
          </span>
          {hasFilters && (
            <button
              onClick={clearAll}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Guest list ────────────────────────────────────────────── */}
      <div className="space-y-4">
        {filtered.map((g) => {
          const badge = guestBadge(g);
          const coldWords = [
            ...new Set(
              g.appearances
                .filter((a) => a.coldOpenWord)
                .map((a) => a.coldOpenWord!)
            ),
          ];

          return (
            <div
              key={g.id}
              className="bg-[var(--bg2)] rounded-2xl border border-[var(--border)] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-4 px-5 py-4">
                <button
                  onClick={() => setModalGuest(g)}
                  className="flex-shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--orange)] focus:ring-offset-2 focus:ring-offset-[var(--bg2)]"
                  aria-label={`Open ${g.name} profile`}
                >
                  <GuestAvatar name={g.name} photoUrl={g.photoUrl} size={44} />
                </button>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => setModalGuest(g)}
                    className="font-semibold text-left hover:text-[var(--orange)] transition-colors"
                  >
                    {g.name}
                  </button>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {badge && (
                      <span className="text-xs text-[var(--text-muted)] bg-[var(--bg)] border border-[var(--border)] px-2 py-0.5 rounded-full">
                        {badge}
                      </span>
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      {g.appearances.length}{" "}
                      appearance{g.appearances.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="px-5 pb-3">
                <LazyArc guest={g} />
              </div>

              {/* Cold open words */}
              {coldWords.length > 0 && (
                <div className="px-5 pb-4 flex flex-wrap gap-2">
                  {coldWords.map((word, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 bg-[var(--bg)] border border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] capitalize"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-[var(--text-muted)] py-16">
          No guests match — try adjusting your filters.
        </p>
      )}

      {/* Guest modal */}
      {modalGuest && (
        <GuestModal guest={modalGuest} onClose={() => setModalGuest(null)} />
      )}
    </div>
  );
}
