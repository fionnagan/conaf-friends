"use client";

import type { ReactNode } from "react";
import { ERA_LABELS, PROFESSION_CATEGORY_ORDER } from "@/lib/data";
import type { Era } from "@/lib/types";

export interface GuestFact {
  name: string;
  /** Every ROUNDUP_ERA this guest appeared in — not just the selected ones. */
  eras: Era[];
  totalAppearances: number;
  /** Appearance count within each era this guest appeared in. */
  appearancesByEra: Partial<Record<Era, number>>;
  profession: string | null;
  generation: "Z" | "M" | "X" | "B" | null;
  gender: string | null;
}

function pct(n: number, total: number): number {
  return total ? (n / total) * 100 : 0;
}
function fmtPct(p: number): string {
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}
function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function joinNames(names: string[], max: number): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const joined =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} (and ${rest} more)` : joined;
}

// A guest counts if they appeared in ANY of the given eras — used for every
// composition-style fact (who showed up, how many came back).
function unionGuests(guests: GuestFact[], sel: Era[]): GuestFact[] {
  return guests.filter((g) => g.eras.some((e) => sel.includes(e)));
}
// A guest counts only if their ENTIRE appearance history sits inside the
// given eras — used for any "how often do they come back" stat, so a guest
// who also appeared somewhere outside the selection doesn't inflate it.
function subsetGuests(guests: GuestFact[], sel: Era[]): GuestFact[] {
  return guests.filter((g) => g.eras.every((e) => sel.includes(e)));
}

interface Fact {
  icon: string;
  parts: ReactNode[];
}

function reunionFact(guests: GuestFact[], sel: Era[]): Fact | null {
  if (!sel.includes("tonight-show")) return null;
  const g = unionGuests(guests, ["tonight-show"]);
  if (g.length === 0) return null;
  const overlap = g.filter((r) => r.eras.includes("late-night-nbc")).length;
  const p = fmtPct(pct(overlap, g.length));
  return {
    icon: "🎤",
    parts: [
      `The Tonight Show only lasted about a year, but ${p} of its guests had already been on the original NBC show. It was less a new show, more a reunion with a new couch.`,
    ],
  };
}

// Names the actual Gen Z guests when there are few enough to list — the
// original ask behind this whole section ("only 3 Gen Z guests, and they
// are Billie Eilish, FINNEAS...is Conan too old for Gen Z?"). Flags the
// twist when Conan (TBS) is contributing most of the count: that era's Gen
// Z guests are mostly kid actors and young athletes who were guests as
// literal children, not the pop stars "Gen Z guest" might suggest.
function genZFact(guests: GuestFact[], sel: Era[]): Fact | null {
  const zGuests = unionGuests(guests, sel).filter((r) => r.generation === "Z");
  if (zGuests.length === 0) {
    if (sel.length === 1 && sel[0] === "tonight-show") {
      return { icon: "👶", parts: ["Zero Gen Z guests showed up here. In fairness, this era only lasted about a year, barely enough time to book anyone."] };
    }
    return { icon: "👶", parts: ["No Gen Z guests here at all. Conan might want to update his contacts."] };
  }

  const fromTbs = zGuests.filter((r) => r.eras.includes("tbs-conan")).length;
  const kidNote =
    sel.includes("tbs-conan") && fromTbs >= 3
      ? " Heads up though: most of the Conan (TBS) names on that list were kid actors and young athletes who were guests as literal children, not pop stars."
      : "";

  if (zGuests.length <= 6) {
    const names = joinNames(zGuests.map((g) => g.name), 6);
    return {
      icon: "👶",
      parts: [
        `Only `,
        <strong key="n" className="text-[var(--orange)]">{zGuests.length}</strong>,
        ` Gen Z guest${zGuests.length === 1 ? "" : "s"} so far: `,
        <span key="names" className="font-semibold text-[var(--purple)]">{names}</span>,
        `.${kidNote} Is Conan too old for Gen Z, or are they just busy? You be the judge.`,
      ],
    };
  }

  return {
    icon: "👶",
    parts: [
      `Gen Z is barely here: `,
      <strong key="n" className="text-[var(--orange)]">{zGuests.length}</strong>,
      ` guests total across the eras you picked.${kidNote} Conan's couch is still mostly a grown-up's couch.`,
    ],
  };
}

// Leads with the share who came back, not the share who didn't.
function returnRateFact(guests: GuestFact[], sel: Era[], allEras: Era[]): Fact | null {
  const returnPctFor = (eras: Era[]) => {
    const g = unionGuests(guests, eras);
    const returners = g.filter((r) => r.totalAppearances > 1).length;
    return pct(returners, g.length);
  };
  const current = returnPctFor(sel);
  if (Number.isNaN(current)) return null;

  if (sel.length === 1) {
    const all = allEras.map((e) => returnPctFor([e]));
    const isMax = current === Math.max(...all);
    const isMin = current === Math.min(...all);
    if (isMax) {
      return {
        icon: "🔁",
        parts: [`Guests here are the most likely to come back of any era: ${fmtPct(current)} have returned for at least one more visit.`],
      };
    }
    if (isMin) {
      return {
        icon: "🔁",
        parts: [`Only ${fmtPct(current)} of guests here have come back for another visit, the lowest of any era.`],
      };
    }
    return { icon: "🔁", parts: [`${fmtPct(current)} of guests here have come back for at least one more visit.`] };
  }
  return {
    icon: "🔁",
    parts: [`Of everyone across the eras you picked, ${fmtPct(current)} have come back for at least one more visit.`],
  };
}

// The single profession bucket that moved the most, in either direction —
// granular movement (a specific category, not just "actors vs comedians")
// instead of a single fixed pair, and it'll surface real swings you
// wouldn't guess at, like Musician cratering on TV-only eras and rebounding
// on the podcast, or Athlete nearly disappearing there entirely.
function professionSwingFact(guests: GuestFact[], sel: Era[], allEras: Era[]): Fact | null {
  const shareFor = (eras: Era[], bucket: string) => {
    const g = unionGuests(guests, eras).filter((r) => r.profession);
    const inBucket = g.filter((r) => r.profession === bucket).length;
    return pct(inBucket, g.length);
  };

  if (sel.length === 1) {
    const era = sel[0];
    const others = allEras.filter((e) => e !== era);
    let bestBucket = PROFESSION_CATEGORY_ORDER[0];
    let bestDelta = -1;
    let bestHere = 0;
    let bestElsewhere = 0;
    for (const bucket of PROFESSION_CATEGORY_ORDER) {
      const here = shareFor([era], bucket);
      const elsewhere = shareFor(others, bucket);
      const delta = Math.abs(here - elsewhere);
      if (delta > bestDelta) {
        bestDelta = delta;
        bestBucket = bucket;
        bestHere = here;
        bestElsewhere = elsewhere;
      }
    }
    if (bestDelta < 3) return null;
    const dir = bestHere > bestElsewhere ? "more" : "fewer";
    return {
      icon: "📊",
      parts: [
        <strong key="b" className="text-[var(--orange)]">{bestBucket}s</strong>,
        ` make up ${fmtPct(bestHere)} of guests here, ${dir} than the ${fmtPct(bestElsewhere)} they make up everywhere else.`,
      ],
    };
  }

  const a = sel[0];
  const b = sel[sel.length - 1];
  let bestBucket = PROFESSION_CATEGORY_ORDER[0];
  let bestDelta = -1;
  let pA = 0;
  let pB = 0;
  for (const bucket of PROFESSION_CATEGORY_ORDER) {
    const shareA = shareFor([a], bucket);
    const shareB = shareFor([b], bucket);
    const delta = Math.abs(shareB - shareA);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestBucket = bucket;
      pA = shareA;
      pB = shareB;
    }
  }
  if (bestDelta < 3) return null;
  const verb = pB > pA ? "grew" : "shrank";
  return {
    icon: "📊",
    parts: [
      <strong key="b" className="text-[var(--orange)]">{bestBucket}s</strong>,
      ` ${verb} the most between these eras: from ${fmtPct(pA)} on ${ERA_LABELS[a]} to ${fmtPct(pB)} on ${ERA_LABELS[b]}.`,
    ],
  };
}

// A real, verified cross-tab: writing skews dramatically toward older
// generations on this show (11% of Boomer+ guests vs ~1% of Millennial and
// Gen Z guests combined, checked against the full dataset) — the kind of
// pattern a single profession or generation breakdown alone won't surface.
function generationProfessionFact(guests: GuestFact[], sel: Era[]): Fact | null {
  const pool = unionGuests(guests, sel).filter((r) => r.profession && r.generation);
  const boomer = pool.filter((r) => r.generation === "B");
  const younger = pool.filter((r) => r.generation === "M" || r.generation === "Z");
  if (boomer.length < 15 || younger.length < 15) return null;
  const boomerWriterPct = pct(boomer.filter((r) => r.profession === "Writer").length, boomer.length);
  const youngerWriterPct = pct(younger.filter((r) => r.profession === "Writer").length, younger.length);
  if (boomerWriterPct - youngerWriterPct < 3) return null;
  return {
    icon: "✍️",
    parts: [
      `Writers skew a lot older here: ${fmtPct(boomerWriterPct)} of Boomer+ guests are writers, compared to just ${fmtPct(youngerWriterPct)} of Millennial and Gen Z guests combined.`,
    ],
  };
}

function clubFact(guests: GuestFact[], sel: Era[]): Fact | null {
  if (sel.length < 2) return null;
  const club = guests.filter((g) => sel.every((e) => g.eras.includes(e)));
  if (club.length === 0) return null;
  const names = joinNames(club.map((g) => g.name), 5);
  const scope =
    sel.length === 4 ? "every single era, all the way from 1993 to today" : `all ${sel.length} eras you picked`;
  return {
    icon: "🏅",
    parts: [
      <strong key="n" className="text-[var(--orange)]">{club.length}</strong>,
      ` guests have appeared in ${scope}: `,
      <span key="names" className="font-semibold text-[var(--purple)]">{names}</span>,
      ".",
    ],
  };
}

// "Most frequent guest of this era" has to count appearances made WITHIN the
// selected era(s), not a guest's career-wide total, and has to consider every
// guest who showed up in the selection at all — not just guests whose entire
// career happened to sit inside it. Getting either of those wrong is exactly
// how this broke: filtering the pool down to subsetGuests (career confined to
// the selection) excluded Bill Burr (19 total, 14 on Conan + 5 on the
// podcast) from the podcast-only record entirely, leaving Matthew Rhys
// (podcast-only, 3 appearances) to win by default even though Burr alone had
// 5 podcast appearances.
function recordFact(guests: GuestFact[], sel: Era[], allEras: Era[]): Fact | null {
  const name = (n: string) => <span key="name" className="font-semibold text-[var(--purple)]">{n}</span>;

  if (sel.length === allEras.length) {
    // Whole-history record: a guest's career total, including any appearances
    // outside these four eras (e.g. Conan Must Go specials).
    const pool = unionGuests(guests, sel);
    if (pool.length === 0) return null;
    const top = pool.reduce((best, r) => (r.totalAppearances > best.totalAppearances ? r : best), pool[0]);
    if (top.totalAppearances < 3) return null;
    return {
      icon: "🔁",
      parts: [name(top.name), ` holds the all time record with ${top.totalAppearances} appearances across the show's whole history.`],
    };
  }

  const scoreFor = (g: GuestFact) => sel.reduce((sum, e) => sum + (g.appearancesByEra[e] || 0), 0);
  const pool = unionGuests(guests, sel);
  if (pool.length === 0) return null;
  const top = pool.reduce((best, r) => (scoreFor(r) > scoreFor(best) ? r : best), pool[0]);
  const topScore = scoreFor(top);
  if (topScore < 3) return null;
  const scope = sel.length === 1 ? ERA_LABELS[sel[0]] : "the eras you picked";
  return {
    icon: "🔁",
    parts: [name(top.name), ` is the most frequent guest of ${scope} alone, with ${topScore} appearances.`],
  };
}

function professionLoyaltyFact(guests: GuestFact[], sel: Era[]): Fact | null {
  const pool = subsetGuests(guests, sel);
  const comedians = pool.filter((r) => r.profession === "Comedian");
  const actors = pool.filter((r) => r.profession === "Actor");
  if (comedians.length < 8 || actors.length < 8) return null;
  const avgC = avg(comedians.map((r) => r.totalAppearances));
  const avgA = avg(actors.map((r) => r.totalAppearances));
  if (Math.abs(avgC - avgA) < 0.3) return null;
  const bigger = avgC > avgA ? "comedians" : "actors";
  const smaller = avgC > avgA ? "actors" : "comedians";
  const big = Math.max(avgC, avgA);
  const small = Math.min(avgC, avgA);
  return {
    icon: "🎭",
    parts: [
      "Actors are usually the biggest group of guests, but ",
      <strong key="b" className="text-[var(--orange)]">{bigger}</strong>,
      ` keep coming back more: about ${big.toFixed(1)} visits each on average here, compared to ${small.toFixed(1)} for ${smaller}.`,
    ],
  };
}

function generationLoyaltyFact(guests: GuestFact[], sel: Era[]): Fact | null {
  const pool = subsetGuests(guests, sel);
  const genX = pool.filter((r) => r.generation === "X");
  const millennial = pool.filter((r) => r.generation === "M");
  if (genX.length < 8 || millennial.length < 8) return null;
  const avgX = avg(genX.map((r) => r.totalAppearances));
  const avgM = avg(millennial.map((r) => r.totalAppearances));
  if (avgX <= avgM * 1.15) return null;
  return {
    icon: "🎂",
    parts: [
      `Gen X guests come back a lot more than Millennials here: about ${avgX.toFixed(1)} visits each on average, compared to ${avgM.toFixed(1)} for Millennials.`,
    ],
  };
}

function genderFact(guests: GuestFact[], sel: Era[], allEras: Era[]): Fact | null {
  const femalePctFor = (eras: Era[]) => {
    const g = unionGuests(guests, eras).filter((r) => r.gender);
    const f = g.filter((r) => r.gender === "female").length;
    return pct(f, g.length);
  };
  const current = femalePctFor(sel);
  if (Number.isNaN(current)) return null;

  if (sel.length === 1) {
    const all = allEras.map((e) => femalePctFor([e]));
    const isMax = current === Math.max(...all);
    const isMin = current === Math.min(...all);
    if (isMax) {
      return { icon: "⚖️", parts: [`This era has the most women guests of any era, still only ${fmtPct(current)} of the total.`] };
    }
    if (isMin) {
      return { icon: "⚖️", parts: [`This era has the fewest women guests of any era: just ${fmtPct(current)}.`] };
    }
    return { icon: "⚖️", parts: [`About ${fmtPct(current)} of guests here are women.`] };
  }
  // Whether it's actually a straight line across every selected era (not
  // just its two endpoints) decides which sentence is honest to say —
  // comparing only the first and last era wrongly called a near-flat
  // 34%->35% move "not the steady climb you might expect" when it was
  // barely a climb at all, and wasn't a letdown either.
  const perEra = sel.map((e) => ({ era: e, pct: femalePctFor([e]) }));
  const isMonotonic = perEra.every(
    (p, i) => i === 0 || (perEra[1].pct >= perEra[0].pct ? p.pct >= perEra[i - 1].pct : p.pct <= perEra[i - 1].pct)
  );
  if (isMonotonic) {
    const first = perEra[0];
    const last = perEra[perEra.length - 1];
    const dir = last.pct > first.pct ? "climbed" : "fallen";
    return {
      icon: "⚖️",
      parts: [
        `The share of women guests has ${dir} steadily across the eras you picked, from ${fmtPct(first.pct)} on ${ERA_LABELS[first.era]} to ${fmtPct(last.pct)} on ${ERA_LABELS[last.era]}.`,
      ],
    };
  }
  const highest = perEra.reduce((best, p) => (p.pct > best.pct ? p : best), perEra[0]);
  const lowest = perEra.reduce((best, p) => (p.pct < best.pct ? p : best), perEra[0]);
  return {
    icon: "⚖️",
    parts: [
      `The share of women guests doesn't move in a straight line across the eras you picked: as low as ${fmtPct(lowest.pct)} on ${ERA_LABELS[lowest.era]}, as high as ${fmtPct(highest.pct)} on ${ERA_LABELS[highest.era]}.`,
    ],
  };
}

export default function RoundupFunFacts({
  guests,
  selected,
  allEras,
}: {
  guests: GuestFact[];
  selected: Set<Era>;
  allEras: Era[];
}) {
  // Chronological order matters for the "earliest vs. latest" comparisons
  // inside several fact generators, so sort the selection the same way
  // allEras is already ordered rather than trusting Set iteration order.
  const sel = allEras.filter((e) => selected.has(e));

  const facts = [
    genZFact(guests, sel),
    reunionFact(guests, sel),
    returnRateFact(guests, sel, allEras),
    professionSwingFact(guests, sel, allEras),
    generationProfessionFact(guests, sel),
    clubFact(guests, sel),
    recordFact(guests, sel, allEras),
    professionLoyaltyFact(guests, sel),
    generationLoyaltyFact(guests, sel),
    genderFact(guests, sel, allEras),
  ].filter((f): f is Fact => f !== null);

  return (
    <div className="mt-12 bg-gradient-to-br from-[rgba(242,101,34,0.10)] to-[rgba(127,119,221,0.05)] border border-[rgba(242,101,34,0.35)] rounded-2xl p-6">
      <p className="flex items-center gap-2.5 mb-4 text-lg font-semibold">
        <span className="text-xl">🎉</span> Fun Facts
      </p>
      {facts.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Pick at least one era to see facts.</p>
      ) : (
        <div className="space-y-4">
          {facts.map((f, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-lg leading-relaxed flex-shrink-0">{f.icon}</span>
              <p className="text-sm leading-relaxed">{f.parts}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
