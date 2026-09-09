/**
 * One-time repair: split the 9 combined-name guest records (e.g. "Billie
 * Eilish and FINNEAS") into per-person guests, matching guest-splits.json.
 *
 * Runs directly against the committed data/guests.json instead of the full
 * merge pipeline, because run-merge.ts needs several gitignored raw ingest
 * caches that don't exist outside the weekly-ingest.yml CI job — running it
 * locally would wipe/corrupt every other guest's appearances/origins/photos.
 *
 * mentionedGuests is deliberately NOT recomputed for the new per-person
 * appearances: that requires the raw episode description text, which isn't
 * stored in the committed Appearance object, and fabricating it would
 * violate the project's anti-fabrication discipline.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Guest, GuestsData, Appearance } from '../../lib/types';
import { slugify, normalizeGuestName } from './utils';
import { computeScore } from './compute-scores';

interface GuestSplitEntry {
  normalizeAs?: string;
  split?: Array<{ name: string; coldOpenWord?: string; coldOpenSentiment?: string }>;
}

const DATA_PATH = path.join(process.cwd(), 'data/guests.json');
const SPLITS_PATH = path.join(__dirname, 'guest-splits.json');

const COMBINED_NAMES = [
  'Dave Grohl, Krist Novoselic, and Steve Albini',
  'Billie Eilish and FINNEAS',
  'Angela Kinsey and Jenna Fischer',
  "Eugene Levy and Catherine O'Hara",
  'Thomas Middleditch and Ben Schwartz',
  'Ted Danson and Woody Harrelson',
  'Mike Sweeney and Jessie Gaskell',
  'Nick Offerman and Megan Mullally',
  'Albert Brooks and Rob Reiner',
];

function main(): void {
  const data: GuestsData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const splits: Record<string, GuestSplitEntry> = JSON.parse(
    fs.readFileSync(SPLITS_PATH, 'utf-8')
  );

  const guestMap = new Map<string, Guest>(data.guests.map((g) => [g.id, g]));
  const touched = new Set<string>();

  for (const combinedName of COMBINED_NAMES) {
    const combinedId = slugify(combinedName);
    const combined = guestMap.get(combinedId);
    if (!combined) {
      console.warn(`Skipping "${combinedName}": no matching guest record found.`);
      continue;
    }
    const splitConfig = splits[combinedName];
    if (!splitConfig?.split) {
      console.warn(`Skipping "${combinedName}": no split config in guest-splits.json.`);
      continue;
    }

    for (const splitGuest of splitConfig.split) {
      const name = normalizeGuestName(splitGuest.name);
      const id = slugify(name);

      const appearance: Appearance = {
        ...combined.appearances[0],
        coldOpenWord: splitGuest.coldOpenWord ?? combined.appearances[0].coldOpenWord,
        coldOpenSentiment:
          (splitGuest.coldOpenSentiment as Appearance['coldOpenSentiment']) ??
          combined.appearances[0].coldOpenSentiment,
      };

      let guest = guestMap.get(id);
      if (!guest) {
        guest = {
          id,
          name,
          photoUrl: null,
          bio: null,
          origin: {
            type: 'cold-booking',
            label: 'Booked as a guest',
            confidence: 'inferred',
          },
          appearances: [],
          friendshipScore: 0,
          friendshipLabel: 'Honored Guest',
          scoreBreakdown: { appearances: 0, coldOpenSentiment: 0, originDepth: 0, gapResilience: 0 },
        };
        guestMap.set(id, guest);
      }
      guest.appearances.push(appearance);
      guest.appearances.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      touched.add(id);
    }

    guestMap.delete(combinedId);
  }

  // Recompute scores for every touched guest.
  for (const id of touched) {
    const guest = guestMap.get(id)!;
    const { friendshipScore, friendshipLabel, scoreBreakdown } = computeScore(guest);
    guest.friendshipScore = friendshipScore;
    guest.friendshipLabel = friendshipLabel;
    guest.scoreBreakdown = scoreBreakdown;
  }

  const allGuests = [...guestMap.values()];

  // Recompute relatedGuests for touched guests only, matching merge.ts's logic.
  for (const id of touched) {
    const guest = guestMap.get(id)!;
    guest.relatedGuests = allGuests
      .filter((g) => g.id !== guest.id && g.origin.type === guest.origin.type)
      .sort((a, b) => b.friendshipScore - a.friendshipScore)
      .slice(0, 5)
      .map((g) => g.id);
  }

  const totalAppearances = allGuests.reduce((sum, g) => sum + g.appearances.length, 0);

  const newData: GuestsData = {
    generatedAt: new Date().toISOString(),
    totalGuests: allGuests.length,
    totalAppearances,
    guests: allGuests,
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2) + '\n');
  console.log(`Done. ${touched.size} guests created/updated. Total guests: ${allGuests.length}.`);
}

main();
