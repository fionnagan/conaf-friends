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

  const professionCounts: Record<Era, Record<string, number>> = {
    "late-night-nbc": {},
    "tonight-show": {},
    "tbs-conan": {},
    podcast: {},
    "conan-must-go": {},
  };
  const professionEnrichedTotal: Record<Era, number> = {
    "late-night-nbc": 0,
    "tonight-show": 0,
    "tbs-conan": 0,
    podcast: 0,
    "conan-must-go": 0,
  };

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
    const guestEras = new Set(guest.appearances.map((a) => a.era));
    for (const era of ROUNDUP_ERAS) {
      if (!guestEras.has(era)) continue;
      professionCounts[era][bucket] = (professionCounts[era][bucket] ?? 0) + 1;
      professionEnrichedTotal[era] += 1;
    }
  }

  return (
    <RoundupClient
      eras={ROUNDUP_ERAS}
      eraTotals={Object.fromEntries(
        ROUNDUP_ERAS.map((e) => [e, eraGuestIds[e].size])
      ) as Record<Era, number>}
      crossover={crossover}
      professionCounts={professionCounts}
      professionEnrichedTotal={professionEnrichedTotal}
    />
  );
}
