"use client";

import { useMemo, useState } from "react";
import type { Guest, Era, GuestCrossing, NeverBookedCandidate } from "@/lib/types";
import {
  ERA_LABELS,
  getEraTextColor,
  getGeneration,
  formatTimeAgo,
  type Generation,
} from "@/lib/data";
import GuestAvatar from "./GuestAvatar";
import GuestModal from "./GuestModal";

const HOST_NAME = "Conan O'Brien";
const ERAS: Era[] = ["late-night-nbc", "tonight-show", "tbs-conan", "podcast", "conan-must-go"];
const GENERATIONS: Generation[] = ["Gen Z", "Millennial", "Gen X", "Boomer+"];
const PAGE_SIZE = 60;

interface Props {
  guests: Guest[];
  guestCrossings: Record<string, GuestCrossing[]>;
  neverBookedCandidates: NeverBookedCandidate[];
}

function lastSeen(guest: Guest): { timeAgo: string; show: string } | null {
  if (guest.appearances.length === 0) return null;
  const latest = guest.appearances.reduce((a, b) => (a.date > b.date ? a : b));
  return { timeAgo: formatTimeAgo(latest.date), show: ERA_LABELS[latest.era] };
}

function crossingLine(crossings: GuestCrossing[] | undefined): string | null {
  if (!crossings || crossings.length === 0) return null;
  const c = crossings[0];
  if (c.source === "film-music") return `Crossed paths on ${c.activityTitle}'s soundtrack (${c.activityYear})`;
  if (c.source === "film-cast") return `Crossed paths at ${c.activityTitle} (${c.activityYear}) — ${c.detail}`;
  return `Crossed paths via ${c.activityTitle}`;
}

function candidateLine(c: NeverBookedCandidate): string {
  if (c.source === "film-music") return `Soundtrack contributor on ${c.activityTitle}${c.activityYear ? ` (${c.activityYear})` : ""}`;
  if (c.source === "film-cast") return `${c.detail} in ${c.activityTitle}${c.activityYear ? ` (${c.activityYear})` : ""}`;
  return c.detail || `Crossed paths via ${c.activityTitle}`;
}

export default function ExplorerClient({ guests, guestCrossings, neverBookedCandidates }: Props) {
  const [nameQuery, setNameQuery] = useState("");
  const [selectedEras, setSelectedEras] = useState<Set<Era>>(new Set());
  const [selectedGenerations, setSelectedGenerations] = useState<Set<Generation>>(new Set());
  const [selectedOccupations, setSelectedOccupations] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [modalGuest, setModalGuest] = useState<Guest | null>(null);

  const eligibleGuests = useMemo(() => guests.filter((g) => g.name !== HOST_NAME), [guests]);

  const topOccupations = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of eligibleGuests) {
      for (const p of g.bio?.profession ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([occ]) => occ);
  }, [eligibleGuests]);

  const generationCounts = useMemo(() => {
    const counts: Record<Generation, number> = { "Gen Z": 0, Millennial: 0, "Gen X": 0, "Boomer+": 0 };
    for (const g of eligibleGuests) {
      const year = g.bio?.birth_year ? parseInt(g.bio.birth_year, 10) : NaN;
      const gen = getGeneration(year);
      if (gen) counts[gen]++;
    }
    return counts;
  }, [eligibleGuests]);

  const totalWithGeneration = generationCounts["Gen Z"] + generationCounts.Millennial + generationCounts["Gen X"] + generationCounts["Boomer+"];

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
    setVisibleCount(PAGE_SIZE);
  }

  const filtered = useMemo(() => {
    let result = eligibleGuests;

    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase();
      result = result.filter((g) => g.name.toLowerCase().includes(q));
    }
    if (selectedEras.size > 0) {
      result = result.filter((g) => g.appearances.some((a) => selectedEras.has(a.era)));
    }
    if (selectedGenerations.size > 0) {
      result = result.filter((g) => {
        const year = g.bio?.birth_year ? parseInt(g.bio.birth_year, 10) : NaN;
        const gen = getGeneration(year);
        return gen !== null && selectedGenerations.has(gen);
      });
    }
    if (selectedOccupations.size > 0) {
      result = result.filter((g) => {
        const profs = g.bio?.profession ?? [];
        return profs.some((p) => selectedOccupations.has(p));
      });
    }
    return result;
  }, [eligibleGuests, nameQuery, selectedEras, selectedGenerations, selectedOccupations]);

  const visible = filtered.slice(0, visibleCount);
  const hasFilters = !!nameQuery || selectedEras.size > 0 || selectedGenerations.size > 0 || selectedOccupations.size > 0;

  function clearAll() {
    setNameQuery("");
    setSelectedEras(new Set());
    setSelectedGenerations(new Set());
    setSelectedOccupations(new Set());
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div>
      {/* ── Filters ─────────────────────────────────────────────── */}
      <div className="mb-8 space-y-3">
        <input
          type="search"
          placeholder="Search by name…"
          value={nameQuery}
          onChange={(e) => { setNameQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
          className="w-full px-4 py-2.5 bg-[var(--bg2)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--orange)] placeholder:text-[var(--text-muted)]"
        />

        {/* Era chips */}
        <div className="flex flex-wrap gap-2">
          {ERAS.map((era) => {
            const active = selectedEras.has(era);
            const color = getEraTextColor(era);
            return (
              <button
                key={era}
                onClick={() => toggle(selectedEras, era, setSelectedEras)}
                aria-pressed={active}
                className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                style={
                  active
                    ? { background: `${color}22`, borderColor: color, color }
                    : { borderColor: "var(--border)", color: "var(--text-muted)" }
                }
              >
                {ERA_LABELS[era]}
              </button>
            );
          })}
        </div>

        {/* Generation chips — computed from birth_year, never stored */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-[var(--text-muted)] mr-1">Generation</span>
          {GENERATIONS.map((gen) => {
            const active = selectedGenerations.has(gen);
            const count = generationCounts[gen];
            return (
              <button
                key={gen}
                onClick={() => toggle(selectedGenerations, gen, setSelectedGenerations)}
                aria-pressed={active}
                disabled={count === 0}
                className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                style={
                  active
                    ? { background: "rgba(127,119,221,0.15)", borderColor: "rgba(127,119,221,0.4)", color: "var(--purple)" }
                    : { borderColor: "var(--border)", color: "var(--text-muted)" }
                }
              >
                {gen} <span className="opacity-70 tabular-nums">· {count}</span>
              </button>
            );
          })}
          <span className="text-xs text-[var(--text-muted)]">
            ({totalWithGeneration}/{eligibleGuests.length} have a birth year so far)
          </span>
        </div>

        {/* Profession chips */}
        <div className="flex flex-wrap gap-2">
          {topOccupations.map((occ) => {
            const active = selectedOccupations.has(occ);
            return (
              <button
                key={occ}
                onClick={() => toggle(selectedOccupations, occ, setSelectedOccupations)}
                aria-pressed={active}
                className="px-2.5 py-0.5 rounded-full border text-xs capitalize transition-colors"
                style={
                  active
                    ? { background: "rgba(242,101,34,0.15)", borderColor: "rgba(242,101,34,0.4)", color: "var(--orange)" }
                    : { borderColor: "var(--border)", color: "var(--text-muted)" }
                }
              >
                {occ}
              </button>
            );
          })}
        </div>

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

      {/* ── Card grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((g) => {
          const seen = lastSeen(g);
          const crossing = crossingLine(guestCrossings[g.id]);
          const year = g.bio?.birth_year ? parseInt(g.bio.birth_year, 10) : NaN;
          const generation = getGeneration(year);

          return (
            <button
              key={g.id}
              onClick={() => setModalGuest(g)}
              className="text-left bg-[var(--bg2)] rounded-2xl border border-[var(--border)] p-4 hover:border-[var(--orange)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--orange)]"
            >
              <div className="flex items-center gap-3 mb-2">
                <GuestAvatar name={g.name} photoUrl={g.photoUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{g.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    {generation && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]">
                        {generation}
                      </span>
                    )}
                    {g.bio?.profession?.[0] && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] capitalize">
                        {g.bio.profession[0]}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {seen && (
                <p className="text-xs text-[var(--text-muted)] mb-1">
                  Last seen {seen.timeAgo} — {seen.show}
                </p>
              )}

              {crossing && (
                <p className="text-xs text-[var(--purple)] mt-1.5">{crossing}</p>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-[var(--text-muted)] py-16">
          No guests match. Try adjusting your filters.
        </p>
      )}

      {visibleCount < filtered.length && (
        <div className="flex justify-center mt-8">
          <button
            onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--orange)] transition-colors"
          >
            Show more ({filtered.length - visibleCount} remaining)
          </button>
        </div>
      )}

      {/* ── Similar, Never Booked ───────────────────────────────── */}
      <section className="mt-14">
        <h2 className="font-serif text-2xl font-semibold mb-1">Similar, Never Booked</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          People who&apos;ve crossed paths with Conan himself — through his own film, soundtrack, or
          personal connections — but have never actually appeared on his shows. Only this tier
          exists so far; a weaker second tier (connected via an existing guest&apos;s own credits,
          not Conan&apos;s) isn&apos;t built yet.
        </p>

        {neverBookedCandidates.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            None found yet — the Crossed Paths pipeline hasn&apos;t generated real data for this
            site build. It runs weekly; check back after it does.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {neverBookedCandidates.map((c, i) => (
              <div key={`${c.name}-${i}`} className="bg-[var(--bg2)] rounded-xl border border-[var(--border)] p-4">
                <p className="font-semibold mb-1">{c.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{candidateLine(c)}</p>
                {c.sourceUrl && (
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--orange)] underline underline-offset-2 mt-1.5 inline-block"
                  >
                    Source
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {modalGuest && <GuestModal guest={modalGuest} onClose={() => setModalGuest(null)} />}
    </div>
  );
}
