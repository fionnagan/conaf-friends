/**
 * patch-photos-into-guests.ts
 * Folds scripts/cache/photos.json's resolved URLs into data/guests.json's
 * photoUrl field — deliberately NOT a full run-merge.ts run, same reasoning
 * as patch-bios-into-guests.ts: merge.ts rebuilds guests.json from ALL raw
 * ingest caches (podcast-episodes.json, late-night-history.json,
 * origins.json, bios.json, photos.json), none of which exist together on a
 * bare checkout outside the weekly-ingest job. Running it here would
 * silently zero out appearances/origin/bio for every guest. This only ever
 * touches photoUrl, so it's safe standalone.
 *
 * Only sets photoUrl when the cache has a real (auto-approved) url — a
 * guest the enrichment pipeline rejected or queued for review has
 * `{ url: null, ... }` in the cache, which is left alone rather than
 * clearing any photoUrl a guest might already have from an earlier run.
 *
 * Usage:
 *   npx tsx scripts/ingest/patch-photos-into-guests.ts
 * Reads scripts/cache/photos.json, data/guests.json
 * Writes data/guests.json
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PhotoCache, GuestsData } from '../../lib/types';

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'cache');
const PHOTOS_FILE = path.join(CACHE_DIR, 'photos.json');
const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function main() {
  const data = readJson<GuestsData>(DATA_FILE, { generatedAt: '', totalGuests: 0, totalAppearances: 0, guests: [] });
  const photos = readJson<PhotoCache>(PHOTOS_FILE, {});

  let updated = 0;
  for (const guest of data.guests) {
    const entry = photos[guest.name];
    if (entry?.url) {
      guest.photoUrl = entry.url;
      updated++;
    }
  }

  data.generatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`Patched photoUrl for ${updated}/${data.guests.length} guests in data/guests.json.`);
}

if (require.main === module) {
  main();
}
