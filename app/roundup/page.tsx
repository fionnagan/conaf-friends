import type { Metadata } from "next";
import { getGuestsData } from "@/lib/data";
import RoundupClient from "@/components/RoundupClient";
import type { Era } from "@/lib/types";

export const metadata: Metadata = {
  title: "The Roundup | The Friend Registry",
  description:
    "A roster overview of every Conan guest — era crossover, generation and profession breakdowns.",
};

// The four broadcast/podcast eras this overview covers. "Conan Must Go"
// (the travel specials) is excluded — too new and too thin a guest list
// to carry a crossover row of its own yet.
const ROUNDUP_ERAS: Era[] = ["late-night-nbc", "tonight-show", "tbs-conan", "podcast"];

export default function RoundupPage() {
  const data = getGuestsData();

  const eraGuestIds: Record<Era, Set<string>> = {
    "late-night-nbc": new Set(),
    "tonight-show": new Set(),
    "tbs-conan": new Set(),
    podcast: new Set(),
    "conan-must-go": new Set(),
  };

  for (const guest of data.guests) {
    const guestEras = new Set(guest.appearances.map((a) => a.era));
    for (const era of ROUNDUP_ERAS) {
      if (guestEras.has(era)) eraGuestIds[era].add(guest.id);
    }
  }

  const crossover = ROUNDUP_ERAS.map((rowEra) =>
    ROUNDUP_ERAS.map((colEra) => {
      let count = 0;
      for (const id of eraGuestIds[rowEra]) {
        if (eraGuestIds[colEra].has(id)) count++;
      }
      return count;
    })
  );

  // Profession is a real, if sparse, signal (~8% of guests have an enriched
  // bio so far). Bucket the raw Wikipedia profession text into readable
  // categories, first match wins. Matched as substrings of the guest's
  // joined profession text rather than exact array entries — some bios came
  // through a regex fallback pipeline that captured prose fragments (e.g.
  // "actor best known for portraying...") instead of clean single words, and
  // substring matching still buckets those correctly instead of dumping them
  // in "Other".
  const PROFESSION_BUCKETS: [string, string[]][] = [
    ["Comedian", ["comedian", "stand-up"]],
    ["Actor", ["actor", "actress"]],
    ["Musician", ["musician", "singer", "songwriter", "rapper", "composer"]],
    ["Filmmaker", ["filmmaker", "director", "producer", "animator", "cartoonist"]],
    ["Writer", ["writer", "screenwriter", "author"]],
    [
      "Media / TV host",
      [
        "television host", "television presenter", "television personality",
        "radio host", "podcaster", "journalist", "media personality",
        "political commentator", "broadcast",
      ],
    ],
    ["Athlete", ["athlete", "basketball", "football", "wrestler", "boxer"]],
  ];

  // One entry per enriched guest, carrying every ROUNDUP_ERA they appeared
  // in — NOT one entry per era. Summing era-level counts double- and
  // triple-counted any guest who crossed multiple eras (confirmed: with all
  // four eras selected, that inflated the profession badge by ~27% and
  // skewed the percentage split toward guests who happened to cross more
  // eras). RoundupClient dedupes against the currently-selected eras itself
  // by checking each guest's era set once, not by re-summing per-era totals.
  const professionByGuest: { eras: Era[]; bucket: string }[] = [];

  for (const guest of data.guests) {
    const professions = guest.bio?.profession;
    if (!professions || professions.length === 0) continue;
    const joined = professions.join(" ").toLowerCase();
    let bucket = "Other";
    for (const [label, keys] of PROFESSION_BUCKETS) {
      if (keys.some((k) => joined.includes(k))) {
        bucket = label;
        break;
      }
    }
    const guestEras = ROUNDUP_ERAS.filter((era) =>
      guest.appearances.some((a) => a.era === era)
    );
    if (guestEras.length === 0) continue;
    professionByGuest.push({ eras: guestEras, bucket });
  }

  // Generation: real once a guest has a backfilled birth_year, same
  // birth-year ranges as the illustrative placeholder buckets so the chart
  // doesn't jump when it switches from placeholder to real data. Right now
  // this will be empty for almost everyone — birth_year backfill is still
  // rolling out — so RoundupClient falls back to the illustrative split
  // whenever enrichedTotal is 0 for the selected eras.
  const GENERATION_BUCKETS: [string, (year: number) => boolean][] = [
    ["Boomer & earlier (born before 1965)", (y) => y < 1965],
    ["Gen X (1965–1980)", (y) => y >= 1965 && y <= 1980],
    ["Millennial (1981–1996)", (y) => y >= 1981 && y <= 1996],
    ["Gen Z (1997 & later)", (y) => y >= 1997],
  ];

  // Same one-entry-per-guest fix as professionByGuest above.
  const generationByGuest: { eras: Era[]; bucket: string }[] = [];

  for (const guest of data.guests) {
    const birthYear = guest.bio?.birth_year ? parseInt(guest.bio.birth_year, 10) : NaN;
    if (!Number.isFinite(birthYear)) continue;
    const bucket = GENERATION_BUCKETS.find(([, test]) => test(birthYear))?.[0];
    if (!bucket) continue;
    const guestEras = ROUNDUP_ERAS.filter((era) =>
      guest.appearances.some((a) => a.era === era)
    );
    if (guestEras.length === 0) continue;
    generationByGuest.push({ eras: guestEras, bucket });
  }

  // Fixed label order for both charts, passed down so a category's color is
  // tied to the category itself, not to its rank in a given filter view —
  // confirmed as a real issue: Profession's segments were colored by
  // sorted-by-count order, so deselecting an era could reshuffle which
  // category was "biggest" and swap two categories' colors out from under
  // the legend. "Other" is appended since it's PROFESSION_BUCKETS' implicit
  // fallback bucket, not one of its own entries.
  const professionCategoryOrder = [...PROFESSION_BUCKETS.map(([label]) => label), "Other"];
  const generationCategoryOrder = GENERATION_BUCKETS.map(([label]) => label);

  return (
    <RoundupClient
      eras={ROUNDUP_ERAS}
      eraTotals={Object.fromEntries(
        ROUNDUP_ERAS.map((e) => [e, eraGuestIds[e].size])
      ) as Record<Era, number>}
      crossover={crossover}
      professionByGuest={professionByGuest}
      professionCategoryOrder={professionCategoryOrder}
      generationByGuest={generationByGuest}
      generationCategoryOrder={generationCategoryOrder}
    />
  );
}
