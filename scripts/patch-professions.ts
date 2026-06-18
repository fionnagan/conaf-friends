/**
 * One-time fix: extract professions from bio.description for guests who
 * have a description but an empty profession array.
 *
 * Run: npx tsx scripts/patch-professions.ts
 */

import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');

const PROF_KEYWORDS: [string, string[]][] = [
  ['comedian',   ['comedian', 'stand-up', 'comic', 'comedic']],
  ['actor',      ['actor', 'actress']],
  ['writer',     ['writer', 'author', 'screenwriter', 'playwright', 'novelist']],
  ['director',   ['director', 'filmmaker', 'film-maker']],
  ['musician',   ['musician', 'singer', 'rapper', 'songwriter', 'guitarist', 'drummer', 'bassist', 'vocalist']],
  ['producer',   ['producer']],
  ['athlete',    ['athlete', 'basketball player', 'football player', 'baseball player', 'quarterback', 'pitcher', 'golfer', 'boxer', 'wrestler', 'tennis player', 'nfl', 'nba', 'mlb']],
  ['politician', ['politician', 'senator', 'governor', 'president', 'representative', 'congress', 'mayor']],
  ['journalist', ['journalist', 'reporter', 'anchor', 'correspondent', 'broadcaster', 'newscaster']],
  ['host',       ['television host', 'talk show host', 'radio host', 'game show host']],
];

function extractProfessions(description: string): string[] {
  const lower = description.toLowerCase();
  const found: string[] = [];
  for (const [prof, keywords] of PROF_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) found.push(prof);
  }
  return found;
}

const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const guests: any[] = raw.guests;

let patched = 0;
for (const g of guests) {
  if (g.bio?.description && (!g.bio.profession || g.bio.profession.length === 0)) {
    const extracted = extractProfessions(g.bio.description);
    if (extracted.length > 0) {
      g.bio.profession = extracted;
      console.log(`  ${g.name}: [${extracted.join(', ')}]`);
      patched++;
    } else {
      console.log(`  ${g.name}: could not extract (check manually)`);
    }
  }
}

fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2));
console.log(`\nPatched ${patched} guests.`);
