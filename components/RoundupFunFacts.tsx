"use client";

import type { ReactNode } from "react";
import { ERA_LABELS } from "@/lib/data";
import type { Era } from "@/lib/types";

export interface GuestFact {
  name: string;
  /** Every ROUNDUP_ERA this guest appeared in — not just the selected ones. */
  eras: Era[];
  totalAppearances: number;
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

function recordFact(guests: GuestFact[], sel: Era[]): Fact | null {
  const pool = subsetGuests(guests, sel);
  if (pool.length === 0) return null;
  const top = pool.reduce((best, r) => (r.totalAppearances > best.totalAppearances ? r : best), pool[0]);
  if (top.totalAppearances < 3) return null;
  const name = <span key="name" className="font-semibold text-[var(--purple)]">{top.name}</span>;
  if (sel.length === 4) {
    return {
      icon: "🔁",
      parts: [name, ` holds the all time record with ${top.totalAppearances} appearances across the show's whole history.`],
    };
  }
  const scope = sel.length === 1 ? ERA_LABELS[sel[0]] : "the eras you picked";
  return {
    icon: "🔁",
    parts: [name, ` is the most frequent guest of ${scope} alone, with ${top.totalAppearances} appearances.`],
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
  const a = sel[0];
  const b = sel[sel.length - 1];
  const pa = femalePctFor([a]);
  const pb = femalePctFor([b]);
  const dir = pb > pa ? "up" : "down";
  return {
    icon: "⚖️",
    parts: [
      "The share of women guests is ",
      <strong key="dir" className="text-[var(--orange)]">{dir}</strong>,
      `, from ${fmtPct(pa)} on ${ERA_LABELS[a]} to ${fmtPct(pb)} on ${ERA_LABELS[b]}. Not the steady climb you might expect.`,
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
    reunionFact(guests, sel),
    returnRateFact(guests, sel, allEras),
    clubFact(guests, sel),
    recordFact(guests, sel),
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
