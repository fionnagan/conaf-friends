import axios from 'axios';
import { readCache, writeCache, sleep, USER_AGENT } from './utils';
import type { PhotoCache } from '../../lib/types';

const CACHE_FILE = 'photos.json';

export async function fetchPhotos(guestNames: string[]): Promise<PhotoCache> {
  const cache = readCache<PhotoCache>(CACHE_FILE) || {};
  let fetched = 0;

  console.log(`[Photos] Fetching photos for ${guestNames.length} guests`);

  for (const name of guestNames) {
    if (cache[name] !== undefined) continue;

    try {
      const res = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          prop: 'pageimages',
          titles: name,
          format: 'json',
          pithumbsize: 400,
          redirects: 1,
        },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 8000,
      });

      const pages = res.data.query?.pages || {};
      const page = Object.values(pages)[0] as any;
      const thumbUrl = page?.thumbnail?.source || null;

      cache[name] = { url: thumbUrl, fetchedAt: new Date().toISOString() };
      fetched++;

      if (fetched % 25 === 0) {
        writeCache(CACHE_FILE, cache);
        console.log(`[Photos] ${fetched} guests processed...`);
      }
    } catch {
      cache[name] = { url: null, fetchedAt: new Date().toISOString() };
    }

    await sleep(1200);
  }

  writeCache(CACHE_FILE, cache);
  const withPhoto = Object.values(cache).filter((v) => v.url).length;
  console.log(`[Photos] Done: ${fetched} new, ${withPhoto}/${Object.keys(cache).length} have photos`);
  return cache;
}

if (require.main === module) {
  // Load all guest names from guests.json (or fall back to podcast cache)
  import('path').then(async ({ default: path }) => {
    import('fs').then(async ({ default: fs }) => {
      const guestsPath = path.join(process.cwd(), 'data', 'guests.json');
      const podcastPath = path.join(process.cwd(), 'scripts', 'cache', 'podcast-episodes.json');
      let names: string[] = [];

      if (fs.existsSync(guestsPath)) {
        const data = JSON.parse(fs.readFileSync(guestsPath, 'utf-8'));
        names = data.guests.map((g: { name: string }) => g.name);
      } else if (fs.existsSync(podcastPath)) {
        const episodes = JSON.parse(fs.readFileSync(podcastPath, 'utf-8'));
        names = [...new Set(
          episodes.filter((e: any) => e.guestName && !e.isFanSegment && !e.isStaffEpisode)
            .map((e: any) => e.guestName as string)
        )];
      }

      if (names.length === 0) {
        console.error('No guest names found. Run npm run ingest first.');
        process.exit(1);
      }

      console.log(`[Photos] Loaded ${names.length} guest names`);
      const cache = await fetchPhotos(names);
      const withPhoto = Object.values(cache).filter((v) => v.url).length;
      console.log(`\nFinal: ${withPhoto}/${names.length} guests have photos`);
    });
  });
}
