/**
 * One-time repair: the combined-name splits for these 3 episodes were
 * already applied (each person is its own guest record), but the cold-open
 * text was copied verbatim from the raw combined phrase onto BOTH people
 * instead of being divided between them. Each of these phrases contains an
 * explicit "respectively" marker tying two individual answers to two named
 * people in order, so this patches each person's existing appearance to
 * hold only their own half, matching guest-splits.json's per-person
 * coldOpenWord/coldOpenSentiment overrides added for the same episodes.
 *
 * Usage: npx tsx scripts/ingest/fix-coldopen-splits.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import type { GuestsData, ColdOpenSentiment } from '../../lib/types';
import { slugify, normalizeGuestName } from './utils';

const DATA_PATH = path.join(process.cwd(), 'data/guests.json');

const FIXES: Array<{ name: string; date: string; coldOpenWord: string; coldOpenSentiment: ColdOpenSentiment }> = [
  { name: 'Billie Eilish', date: '2023-03-27', coldOpenWord: 'really excited', coldOpenSentiment: 'neutral' },
  { name: 'FINNEAS', date: '2023-03-27', coldOpenWord: 'dubious', coldOpenSentiment: 'neutral' },
  { name: 'Angela Kinsey', date: '2021-03-08', coldOpenWord: 'zippy', coldOpenSentiment: 'neutral' },
  { name: 'Jenna Fischer', date: '2021-03-08', coldOpenWord: 'super-duper excited', coldOpenSentiment: 'neutral' },
  { name: 'Matthew McConaughey', date: '2026-09-28', coldOpenWord: 'very Irish', coldOpenSentiment: 'neutral' },
  { name: 'Woody Harrelson', date: '2026-09-28', coldOpenWord: 'like a True American', coldOpenSentiment: 'affectionate-absurd' },
];

function main(): void {
  const data: GuestsData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const guestMap = new Map(data.guests.map((g) => [g.id, g]));

  let fixed = 0;
  for (const fix of FIXES) {
    const id = slugify(normalizeGuestName(fix.name));
    const guest = guestMap.get(id);
    if (!guest) {
      console.warn(`Skipping "${fix.name}" (${fix.date}): no matching guest record found.`);
      continue;
    }
    const appearance = guest.appearances.find((a) => a.date === fix.date);
    if (!appearance) {
      console.warn(`Skipping "${fix.name}": no appearance on ${fix.date}.`);
      continue;
    }
    appearance.coldOpenWord = fix.coldOpenWord;
    appearance.coldOpenSentiment = fix.coldOpenSentiment;
    fixed++;
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Done. ${fixed} appearance(s) fixed.`);
}

main();
