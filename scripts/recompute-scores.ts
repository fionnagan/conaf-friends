/**
 * Recompute friendshipScore/friendshipLabel/scoreBreakdown for every guest
 * using the current compute-scores.ts formula, without running the full
 * merge pipeline (which pulls from raw caches and may include unrelated
 * in-progress changes).
 *
 * Run: npx tsx scripts/recompute-scores.ts
 */

import fs from 'fs';
import path from 'path';
import { computeScore } from './ingest/compute-scores';

const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');

const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const guests: any[] = raw.guests;

let changed = 0;
for (const g of guests) {
  const before = g.friendshipScore;
  const { friendshipScore, friendshipLabel, scoreBreakdown } = computeScore(g);
  g.friendshipScore = friendshipScore;
  g.friendshipLabel = friendshipLabel;
  g.scoreBreakdown = scoreBreakdown;
  if (before !== friendshipScore) changed++;
}

fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2));
console.log(`Recomputed scores for ${guests.length} guests (${changed} changed value).`);
