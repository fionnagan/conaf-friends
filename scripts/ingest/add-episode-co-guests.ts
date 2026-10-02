/**
 * One-time repair: add the co-guests listed in episode-co-guests.json to the
 * already-committed data/guests.json. Run once — future weekly-ingest runs
 * pick these up directly via merge.ts reading episode-co-guests.json.
 *
 * Unlike split-combined-guests.ts, this never touches the primary guest's
 * own appearance (their extracted name was correct, just incomplete) — it
 * only adds a new appearance, referencing the same existing episodeId, to
 * the co-guest (creating that guest if they're new).
 *
 * Usage: npx tsx scripts/ingest/add-episode-co-guests.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Guest, GuestsData, Appearance } from '../../lib/types';
import { slugify, normalizeGuestName } from './utils';
import { computeScore } from './compute-scores';

const DATA_PATH = path.join(process.cwd(), 'data/guests.json');
const CO_GUESTS_PATH = path.join(__dirname, 'episode-co-guests.json');

function main(): void {
  const data: GuestsData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const coGuestsConfig: Record<string, string[]> = JSON.parse(
    fs.readFileSync(CO_GUESTS_PATH, 'utf-8')
  );

  const guestMap = new Map<string, Guest>(data.guests.map((g) => [g.id, g]));
  const touched = new Set<string>();

  for (const [key, coGuestNames] of Object.entries(coGuestsConfig)) {
    const sep = key.lastIndexOf('::');
    const primaryName = key.substring(0, sep);
    const date = key.substring(sep + 2);
    const primaryId = slugify(normalizeGuestName(primaryName));
    const primary = guestMap.get(primaryId);
    if (!primary) {
      console.warn(`Skipping "${key}": no matching primary guest record found.`);
      continue;
    }
    const sourceAppearance = primary.appearances.find((a) => a.date === date);
    if (!sourceAppearance) {
      console.warn(`Skipping "${key}": primary guest has no appearance on ${date}.`);
      continue;
    }

    for (const rawCoGuestName of coGuestNames) {
      const name = normalizeGuestName(rawCoGuestName);
      const id = slugify(name);

      const appearance: Appearance = {
        era: sourceAppearance.era,
        date: sourceAppearance.date,
        episodeId: sourceAppearance.episodeId,
        coldOpenWord: sourceAppearance.coldOpenWord,
        coldOpenSentiment: sourceAppearance.coldOpenSentiment,
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
      const alreadyHasIt = guest.appearances.some((a) => a.episodeId === appearance.episodeId);
      if (alreadyHasIt) {
        console.warn(`Skipping "${name}" for ${key}: already has this episode.`);
        continue;
      }
      guest.appearances.push(appearance);
      guest.appearances.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      touched.add(id);
    }
  }

  for (const id of touched) {
    const guest = guestMap.get(id)!;
    const { friendshipScore, friendshipLabel, scoreBreakdown } = computeScore(guest);
    guest.friendshipScore = friendshipScore;
    guest.friendshipLabel = friendshipLabel;
    guest.scoreBreakdown = scoreBreakdown;
  }

  const allGuests = [...guestMap.values()];

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
    episodes: data.episodes,
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2) + '\n');
  console.log(`Done. ${touched.size} guest(s) created/updated. Total guests: ${allGuests.length}.`);
}

main();
