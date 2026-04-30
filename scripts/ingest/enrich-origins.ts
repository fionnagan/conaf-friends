import axios from 'axios';
import { readCache, writeCache, sleep, USER_AGENT } from './utils';
import type { OriginType, OriginCache } from '../../lib/types';

const CACHE_FILE = 'origins.json';

interface OriginResult {
  type: OriginType;
  label: string;
  confidence: 'high' | 'medium' | 'inferred';
}

// Harvard Lampoon alums who worked with Conan
const HARVARD_LAMPOON_ALUMS = new Set([
  'conan o\'brien',
  'andy richter',
  'robert smigel',
  'greg daniels',
  'b.j. novak',
  'mindy kaling',
  'mike reiss',
  'al jean',
  'john vitti',
  'jeff martin',
  'george meyer',
  'david silverman',
  'jon vitti',
]);

// SNL writers room 1988–1991 and Simpsons 1991–1993 overlap — key names
const SNL_SIMPSONS_ALUMNI = new Set([
  'norm macdonald',
  'robert smigel',
  'jim downey',
  'bob odenkirk',
  'louis c.k.',
  'louis ck',
  'greg daniels',
  'frank rich',
  'al jean',
  'mike reiss',
  'dana carvey',
  'jan hooks',
  'phil hartman',
  'kevin nealon',
  'mike myers',
  'chris farley',
  'david spade',
  'adam sandler',
  'tim meadows',
  'julia sweeney',
  'conan o\'brien',
]);

// People known to be comedy peers of Conan
const COMEDY_PEERS = new Set([
  'louis c.k.',
  'bill burr',
  'patton oswalt',
  'jim jefferies',
  'nick kroll',
  'john mulaney',
  'mike birbiglia',
  'tig notaro',
  'maria bamford',
  'greg fitzsimmons',
  'andy kindler',
  'gary gulman',
]);

async function fetchWikipediaBio(guestName: string): Promise<string> {
  try {
    const res = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        prop: 'extracts',
        exintro: true,
        explaintext: true,
        titles: guestName,
        format: 'json',
        redirects: 1,
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });

    const pages = res.data.query?.pages || {};
    const page = Object.values(pages)[0] as any;
    return page?.extract || '';
  } catch {
    return '';
  }
}

function classifyFromBio(guestName: string, bio: string): OriginResult {
  const name = guestName.toLowerCase();
  const bioLower = bio.toLowerCase();

  // Check hardcoded high-confidence sets first
  if (HARVARD_LAMPOON_ALUMS.has(name)) {
    return {
      type: 'harvard-lampoon',
      label: 'Harvard Lampoon alumni',
      confidence: 'high',
    };
  }

  if (SNL_SIMPSONS_ALUMNI.has(name)) {
    return {
      type: 'snl-simpsons',
      label: 'SNL/Simpsons writers room, 1988–1993',
      confidence: 'high',
    };
  }

  // Check bio for SNL mentions during Conan's years
  if (
    /saturday night live/.test(bioLower) &&
    /198[89]|199[0-3]/.test(bio)
  ) {
    return {
      type: 'snl-simpsons',
      label: 'SNL writers room era, 1988–1991',
      confidence: 'medium',
    };
  }

  // Harvard Lampoon mention
  if (/harvard lampoon/.test(bioLower)) {
    return {
      type: 'harvard-lampoon',
      label: 'Harvard Lampoon alumni',
      confidence: 'high',
    };
  }

  // Simpsons during Conan's time
  if (
    /the simpsons/.test(bioLower) &&
    /199[0-4]/.test(bio)
  ) {
    return {
      type: 'snl-simpsons',
      label: 'The Simpsons era connection, 1991–1993',
      confidence: 'medium',
    };
  }

  // Comedy peer
  if (
    COMEDY_PEERS.has(name) ||
    /stand.?up comedy|stand-up comedian|comic|comedian/.test(bioLower)
  ) {
    return {
      type: 'comedy-peer',
      label: 'Comedy peer and fellow stand-up',
      confidence: 'medium',
    };
  }

  return {
    type: 'cold-booking',
    label: 'Booked as a guest',
    confidence: 'inferred',
  };
}

export async function enrichOrigins(
  guestNames: string[]
): Promise<OriginCache> {
  const cache = readCache<OriginCache>(CACHE_FILE) || {};
  let fetched = 0;

  console.log(`[Origins] Enriching ${guestNames.length} guests`);

  for (const name of guestNames) {
    if (cache[name]) continue;

    const bio = await fetchWikipediaBio(name);
    const result = classifyFromBio(name, bio);
    cache[name] = { ...result, fetchedAt: new Date().toISOString() };
    fetched++;

    if (fetched % 20 === 0) {
      writeCache(CACHE_FILE, cache);
      console.log(`[Origins] ${fetched} guests enriched...`);
    }

    await sleep(500); // 2 req/sec max
  }

  writeCache(CACHE_FILE, cache);
  console.log(`[Origins] Done: ${fetched} new, ${Object.keys(cache).length} total`);
  return cache;
}

// Late-night-regular upgrade: if a guest has 2+ late-night appearances, upgrade origin
export function upgradeToLateNightRegular(
  cache: OriginCache,
  guestName: string,
  lateNightAppearanceCount: number
): void {
  if (lateNightAppearanceCount >= 2) {
    const current = cache[guestName];
    if (
      !current ||
      current.type === 'cold-booking' ||
      current.type === 'comedy-peer'
    ) {
      cache[guestName] = {
        type: 'late-night-regular',
        label: 'Late Night regular, 1993–2009',
        confidence: 'high',
        fetchedAt: current?.fetchedAt || new Date().toISOString(),
      };
    }
  }
}

if (require.main === module) {
  const testGuests = [
    'Norm Macdonald',
    'Will Ferrell',
    'Timothy Olyphant',
    'Seth Rogen',
    'Mindy Kaling',
  ];
  enrichOrigins(testGuests).then((cache) => {
    for (const name of testGuests) {
      console.log(`${name}: ${JSON.stringify(cache[name])}`);
    }
  });
}
