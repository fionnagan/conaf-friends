/**
 * patch-bios-into-guests.ts
 * Folds scripts/cache/bios.json's bio field into data/guests.json —
 * deliberately NOT a full run-merge.ts run. merge() rebuilds guests.json
 * from ALL raw ingest caches (podcast-episodes.json, late-night-history.json,
 * photos.json, origins.json), none of which exist on a bare checkout outside
 * the weekly-ingest job that generates them fresh each time. Running it here
 * would silently zero out appearances/origin/photos for every guest. This
 * only ever touches the `bio` field, matching merge.ts's own bio-merge rule
 * exactly (scripts/ingest/merge.ts: `bio && !bio.needs_review ? bio : null`),
 * so it's safe on a bare checkout with only guests.json + bios.json present.
 *
 * Usage:
 *   npx tsx scripts/ingest/patch-bios-into-guests.ts
 * Reads scripts/cache/bios.json, data/guests.json
 * Writes data/guests.json
 */
import * as fs from 'fs';
import * as path from 'path';
import type { GuestBio, Guest, GuestsData } from '../../lib/types';

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'cache');
const BIOS_FILE = path.join(CACHE_DIR, 'bios.json');
const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function main() {
  const data = readJson<GuestsData>(DATA_FILE, { generatedAt: '', totalGuests: 0, totalAppearances: 0, guests: [] });
  const bios = readJson<Record<string, GuestBio>>(BIOS_FILE, {});

  let updated = 0;
  for (const guest of data.guests) {
    const bio = bios[guest.name];
    if (bio && !bio.needs_review) {
      guest.bio = bio;
      updated++;
    }
  }

  data.generatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`Patched bio field for ${updated}/${data.guests.length} guests in data/guests.json.`);
}

if (require.main === module) {
  main();
}
