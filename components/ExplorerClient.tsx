"use client";

import { useMemo, useState } from "react";
import type { Guest, Era, GuestCrossing, NeverBookedCandidate } from "@/lib/types";
import {
  ERA_LABELS,
  getEraTextColor,
  getGeneration,
  formatTimeAgo,
  bucketProfession,
  PROFESSION_CATEGORY_ORDER,
  getRecency,
  RECENCY_BUCKETS,
  type Generation,
  type Recency,
} from "@/lib/data";
import GuestAvatar from "./GuestAvatar";
import GuestModal from "./GuestModal";

const HOST_NAME = "Conan O'Brien";
// "Conan Must Go" (the travel specials) is excluded — too new and too thin
// a guest list to be a meaningful filter dimension yet, same call the
// Roundup page makes for its own era breakdowns.
const ERAS: Era[] = ["late-night-nbc", "tonight-show", "tbs-conan", "podcast"];
const GENERATIONS: Generation[] = ["Gen Z", "Millennial", "Gen X", "Boomer+"];
const PAGE_SIZE = 60;

interface Props {
  guests: Guest[];
  guestCrossings: Record<string, GuestCrossing[]>;
  neverBookedCandidates: NeverBookedCandidate[];
}

function latestAppearance(guest: Guest) {
  if (guest.appearances.length === 0) return null;
  return guest.appearances.reduce((a, b) => (a.date > b.date ? a : b));
}

function lastSeen(guest: Guest): { timeAgo: string; show: string } | null {
  const latest = latestAppearance(guest);
  if (!latest) return null;
  return { timeAgo: formatTimeAgo(latest.date), show: ERA_LABELS[latest.era] };
}

function guestRecency(guest: Guest): Recency | null {
  const latest = latestAppearance(guest);
  return latest ? getRecency(latest.date) : null;
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
  const [selectedRecency, setSelectedRecency] = useState<Set<Recency>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [modalGuest, setModalGuest] = useState<Guest | null>(null);

  const eligibleGuests = useMemo(() => guests.filter((g) => g.name !== HOST_NAME), [guests]);

  // Same curated categories the Roundup page charts by — a guest's
  // profession reads identically wherever it shows up on the site, instead
  // of the raw (sometimes garbled) Wikipedia profession text.
  const professionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of eligibleGuests) {
      const bucket = bucketProfession(g.bio?.profession);
      if (bucket) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return counts;
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

  const recencyCounts = useMemo(() => {
    const counts: Record<Recency, number> = { "This year": 0, "1–3 years ago": 0, "3–10 years ago": 0, "10+ years ago": 0 };
    for (const g of eligibleGuests) {
      const r = guestRecency(g);
      if (r) counts[r]++;
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
        const bucket = bucketProfession(g.bio?.profession);
        return bucket !== null && selectedOccupations.has(bucket);
      });
    }
    if (selectedRecency.size > 0) {
      result = result.filter((g) => {
        const r = guestRecency(g);
        return r !== null && selectedRecency.has(r);
      });
    }
    return result;
  }, [eligibleGuests, nameQuery, selectedEras, selectedGenerations, selectedOccupations, selectedRecency]);

  const visible = filtered.slice(0, visibleCount);
  const activeFilterCount = selectedEras.size + selectedGenerations.size + selectedOccupations.size + selectedRecency.size;
  const hasFilters = !!nameQuery || activeFilterCount > 0;

  function clearAll() {
    setNameQuery("");
    setSelectedEras(new Set());
    setSelectedGenerations(new Set());
    setSelectedOccupations(new Set());
    setSelectedRecency(new Set());
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

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors"
            style={
              filtersOpen || activeFilterCount > 0
                ? { background: "rgba(242,101,34,0.12)", borderColor: "var(--orange)", color: "var(--orange)" }
                : { borderColor: "var(--border)", color: "var(--text-muted)" }
            }
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="min-w-[1.25rem] px-1 h-5 rounded-full bg-[var(--orange)] text-[var(--bg)] text-xs font-semibold flex items-center justify-center tabular-nums">
                {activeFilterCount}
              </span>
            )}
            <span className="text-xs transition-transform" style={{ transform: filtersOpen ? "rotate(180deg)" : undefined }}>
              ▾
            </span>
          </button>

          <div className="flex items-center gap-3">
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

        {filtersOpen && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg2)] p-4 space-y-4">
            {/* Era */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Era</p>
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
            </div>

            {/* Generation — computed from birth_year, never stored */}
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Generation</p>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {totalWithGeneration}/{eligibleGuests.length} have a birth year so far
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
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
              </div>
            </div>

            {/* Profession — same curated categories as the Roundup page */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Profession</p>
              <div className="flex flex-wrap gap-2">
                {PROFESSION_CATEGORY_ORDER.map((occ) => {
                  const active = selectedOccupations.has(occ);
                  const count = professionCounts.get(occ) ?? 0;
                  return (
                    <button
                      key={occ}
                      onClick={() => toggle(selectedOccupations, occ, setSelectedOccupations)}
                      aria-pressed={active}
                      disabled={count === 0}
                      className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      style={
                        active
                          ? { background: "rgba(242,101,34,0.15)", borderColor: "rgba(242,101,34,0.4)", color: "var(--orange)" }
                          : { borderColor: "var(--border)", color: "var(--text-muted)" }
                      }
                    >
                      {occ} <span className="opacity-70 tabular-nums">· {count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Last seen — recency of the guest's most recent appearance */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Last seen</p>
              <div className="flex flex-wrap gap-2">
                {RECENCY_BUCKETS.map((r) => {
                  const active = selectedRecency.has(r);
                  const count = recencyCounts[r];
                  return (
                    <button
                      key={r}
                      onClick={() => toggle(selectedRecency, r, setSelectedRecency)}
                      aria-pressed={active}
                      disabled={count === 0}
                      className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      style={
                        active
                          ? { background: "rgba(57,135,229,0.15)", borderColor: "rgba(57,135,229,0.4)", color: "#3987e5" }
                          : { borderColor: "var(--border)", color: "var(--text-muted)" }
                      }
                    >
                      {r} <span className="opacity-70 tabular-nums">· {count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Card grid ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((g) => {
          const seen = lastSeen(g);
          const crossing = crossingLine(guestCrossings[g.id]);
          const year = g.bio?.birth_year ? parseInt(g.bio.birth_year, 10) : NaN;
          const generation = getGeneration(year);
          const profession = bucketProfession(g.bio?.profession);

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
                    {profession && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]">
                        {profession}
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
