import * as dotenv from 'fs';
import * as path from 'path';

// Load .env.local manually since we're outside Next.js runtime
function loadEnv(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!dotenv.existsSync(envPath)) return;
  const lines = dotenv.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.substring(0, eq).trim();
    const val = trimmed.substring(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

import { fetchPodcastRSS } from './fetch-podcast-rss';
import { matchYouTubeVideos } from './match-youtube-videos';
import { fetchLateNightHistory } from './fetch-late-night-history';
import { enrichOrigins, upgradeToLateNightRegular } from './enrich-origins';
import { fetchPhotos } from './fetch-photos';
import { merge, writeOutput } from './merge';
import { normalizeGuestName } from './utils';
import type { OriginCache } from '../../lib/types';

async function main() {
  console.log('=== Friend Registry Ingest Pipeline ===\n');

  // Step 1: Fetch podcast RSS
  console.log('Step 1/6: Fetching podcast RSS...');
  const podcastEpisodes = await fetchPodcastRSS();
  const guestEpisodes = podcastEpisodes.filter(
    (e) => e.guestName && !e.isFanSegment && !e.isStaffEpisode
  );
  console.log(`  → ${guestEpisodes.length} guest episodes found\n`);

  // Step 2: Match YouTube videos
  console.log('Step 2/6: Matching YouTube videos...');
  const youtubeCache = await matchYouTubeVideos(podcastEpisodes);
  const ytMatched = Object.values(youtubeCache).filter((v) => v.videoId).length;
  console.log(`  → ${ytMatched} episodes with YouTube matches\n`);

  // Step 3: Fetch late night history
  console.log('Step 3/6: Fetching late night guest history...');
  const lateNightHistory = await fetchLateNightHistory();
  console.log(`  → ${lateNightHistory.length} late night appearances\n`);

  // Step 4: Enrich origins
  console.log('Step 4/6: Enriching guest origins...');
  const allNames = new Set<string>();
  for (const ep of guestEpisodes) {
    if (ep.guestName) allNames.add(normalizeGuestName(ep.guestName));
  }
  for (const ln of lateNightHistory) {
    allNames.add(normalizeGuestName(ln.guestName));
  }

  const originCache = await enrichOrigins(Array.from(allNames));

  // Count late night appearances per guest and upgrade origin if needed
  const lateNightCounts = new Map<string, number>();
  for (const ln of lateNightHistory) {
    if (ln.era === 'late-night-nbc') {
      const name = normalizeGuestName(ln.guestName);
      lateNightCounts.set(name, (lateNightCounts.get(name) || 0) + 1);
    }
  }
  for (const [name, count] of lateNightCounts) {
    upgradeToLateNightRegular(originCache as OriginCache, name, count);
  }
  console.log(`  → ${Object.keys(originCache).length} guest origins classified\n`);

  // Step 5: Fetch photos
  console.log('Step 5/6: Fetching guest photos...');
  const photoCache = await fetchPhotos(Array.from(allNames));
  const withPhotos = Object.values(photoCache).filter((v) => v.url).length;
  console.log(`  → ${withPhotos}/${allNames.size} guests have photos\n`);

  // Step 6: Merge and compute scores
  console.log('Step 6/6: Merging data and computing scores...');
  const data = merge(
    podcastEpisodes,
    lateNightHistory,
    youtubeCache,
    photoCache,
    originCache as OriginCache
  );

  writeOutput(data);

  console.log('\n=== Ingest Complete ===');
  console.log(`Total guests: ${data.totalGuests}`);
  console.log(`Total appearances: ${data.totalAppearances}`);
  console.log(`Generated at: ${data.generatedAt}`);

  // Print top 10
  console.log('\nTop 10 by Friendship Score:');
  data.guests.slice(0, 10).forEach((g, i) => {
    console.log(
      `  ${i + 1}. ${g.name}: ${g.friendshipScore} (${g.friendshipLabel})`
    );
  });
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
