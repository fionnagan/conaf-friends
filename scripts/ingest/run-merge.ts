/**
 * Standalone merge runner — reads all caches, regenerates data/guests.json.
 * No network calls; uses whatever is in scripts/cache/*.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import { merge, writeOutput } from './merge';
import type {
  RawPodcastEpisode,
  RawLateNightAppearance,
  YouTubeCache,
  PhotoCache,
  OriginCache,
  GuestBio,
} from '../../lib/types';

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'cache');

function readJson<T>(file: string, fallback: T): T {
  const p = path.join(CACHE_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

const podcastEpisodes  = readJson<RawPodcastEpisode[]>('podcast-episodes.json', []);
const lateNightHistory = readJson<RawLateNightAppearance[]>('late-night-history.json', []);
const youtubeCache     = readJson<YouTubeCache>('youtube-matches.json', {});
const photoCache       = readJson<PhotoCache>('photos.json', {});
const originCache      = readJson<OriginCache>('origin-cache.json', {});
const bioCache         = readJson<Record<string, GuestBio>>('bios.json', {});

const guestEps  = podcastEpisodes.filter(e => e.guestName && !e.isFanSegment && !e.isStaffEpisode);
console.log(`Podcast guest episodes : ${guestEps.length}`);
console.log(`Late-night appearances : ${lateNightHistory.length}`);
console.log(`Photos cached          : ${Object.values(photoCache).filter(v => v.url).length}`);

const data = merge(podcastEpisodes, lateNightHistory, youtubeCache, photoCache, originCache, bioCache);
writeOutput(data);

console.log(`\nTotal guests  : ${data.totalGuests}`);
console.log(`Total appear. : ${data.totalAppearances}`);
const withPhotos = data.guests.filter(g => g.photoUrl).length;
console.log(`With photos   : ${withPhotos}/${data.totalGuests}`);

const noPhotos = data.guests.filter(g => !g.photoUrl);
console.log(`\nMissing photos (${noPhotos.length}):`);
noPhotos.forEach(g => console.log(`  ${g.name}`));
