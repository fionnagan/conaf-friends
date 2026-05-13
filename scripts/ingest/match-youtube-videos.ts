import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { readCache, writeCache, sleep } from './utils';
import type { RawPodcastEpisode, YouTubeCache } from '../../lib/types';

const PODCAST_NAME = "Conan O'Brien Needs a Friend";
const ACCEPTED_CHANNELS = ['team coco', "conan o'brien"];
const CACHE_FILE = 'youtube-matches.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SEARCHES_PER_RUN = 95;
const MIN_CONFIDENCE = 0.8;

// Clip/short title markers — reject these before scoring
const CLIP_MARKERS = ['clip', 'highlight', '#shorts', 'shorts', 'snippet', 'moment'];

function isClip(videoTitle: string): boolean {
  const t = videoTitle.toLowerCase();
  return CLIP_MARKERS.some((m) => t.includes(m));
}

// Normalize any date string (RFC 2822 or ISO) to YYYY-MM-DD
function toISODate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toISOString().substring(0, 10);
  } catch {
    return '';
  }
}

// Normalise a raw cache key so both RFC-2822 and ISO pubDates map to the same string.
// e.g. "Denis Leary::Mon, 23 Feb 2026 05:05:00 +0000"  →  "Denis Leary::2026-02-23"
//      "Denis Leary::2026-02-23"                        →  "Denis Leary::2026-02-23"
function normaliseCacheKey(key: string): string {
  const sep = key.lastIndexOf('::');
  if (sep === -1) return key;
  const guest = key.substring(0, sep);
  const date  = key.substring(sep + 2);
  return `${guest}::${toISODate(date) || date}`;
}

// Load committed manual overrides (persists across CI runs)
function loadManualOverrides(): Record<string, string> {
  try {
    const p = path.join(__dirname, 'youtube-manual-overrides.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

// ISO 8601 duration (PT1H23M45S) → seconds
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0') * 3600 +
          parseInt(m[2] || '0') * 60 +
          parseInt(m[3] || '0'));
}

// Word-overlap Jaccard similarity between two strings
function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const setA = words(a);
  const setB = words(b);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

function channelMatches(channelTitle: string): boolean {
  const c = channelTitle.toLowerCase();
  return ACCEPTED_CHANNELS.some((ac) => c.includes(ac));
}

// Date proximity bonus: rewards YT videos uploaded close to the podcast air date.
// Critical for guests with multiple appearances — prevents matching a 2019 video
// to a 2026 episode.
function dateProximityScore(videoPublishedAt: string, episodePubDate: string): number {
  if (!videoPublishedAt || !episodePubDate) return 0;
  const epDate   = new Date(episodePubDate).getTime();
  const vidDate  = new Date(videoPublishedAt).getTime();
  if (isNaN(epDate) || isNaN(vidDate)) return 0;
  const diffDays = Math.abs(epDate - vidDate) / (1000 * 60 * 60 * 24);
  if (diffDays <= 14)  return  0.30; // within 2 weeks  — strong match
  if (diffDays <= 45)  return  0.20; // within 6 weeks  — likely same appearance
  if (diffDays <= 120) return  0.10; // within 4 months — possible
  if (diffDays <= 365) return  0.00; // within a year   — neutral
  return -0.15;                       // older than 1 year — likely wrong appearance
}

function scoreCandidate(
  videoTitle: string,
  channelTitle: string,
  durationSecs: number,
  guestName: string,
  episodeTitle: string,
  videoPublishedAt: string,
  episodePubDate: string
): number {
  // Immediately reject clips/shorts
  if (isClip(videoTitle)) return -1;

  let score = 0;

  // +0.35 official channel
  if (channelMatches(channelTitle)) score += 0.35;

  // +0.25 guest name present in title
  const titleLower = videoTitle.toLowerCase();
  const nameParts = guestName.toLowerCase().split(/\s+/);
  if (nameParts.every((p) => titleLower.includes(p))) score += 0.25;

  // +0.30 (Full Episode) tag — strongest single signal for full uploads
  if (titleLower.includes('(full episode)') || titleLower.includes('full episode')) score += 0.30;

  // +0.10 episode title fuzzy match (reduced to make room for full-episode signal)
  const sim = titleSimilarity(episodeTitle, videoTitle);
  score += sim * 0.10;

  // +0.05 full episode by duration (> 20 minutes)
  if (durationSecs > 1200) score += 0.05;
  // −0.05 very short video (< 5 minutes) — likely a clip even without marker
  else if (durationSecs > 0 && durationSecs < 300) score -= 0.05;

  // ±0.30 date proximity — most important for repeat guests
  score += dateProximityScore(videoPublishedAt, episodePubDate);

  return Math.round(score * 1000) / 1000;
}

// Batch-fetch durations for a list of videoIds (1 API unit each, batched up to 50)
async function fetchDurations(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, number>> {
  if (videoIds.length === 0) return {};
  const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      part: 'contentDetails',
      id: videoIds.join(','),
      key: apiKey,
    },
    timeout: 10000,
  });
  const result: Record<string, number> = {};
  for (const item of res.data.items || []) {
    result[item.id] = parseDuration(item.contentDetails?.duration || '');
  }
  return result;
}

export async function matchYouTubeVideos(
  episodes: RawPodcastEpisode[]
): Promise<YouTubeCache> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.log('[YouTube] No YOUTUBE_API_KEY found, skipping video matching');
    return {};
  }

  const rawCache = readCache<YouTubeCache>(CACHE_FILE) || {};
  // Migrate any legacy RFC-2822 keys → ISO-date keys in one pass
  const cache: YouTubeCache = {};
  for (const [k, v] of Object.entries(rawCache)) {
    cache[normaliseCacheKey(k)] = v;
  }

  let searchCount = 0;
  let newMatches = 0;
  const now = Date.now();

  // Seed cache with manually verified overrides (committed file).
  // Keys in the overrides file already use ISO dates — normalise just in case.
  const manualOverrides = loadManualOverrides();
  for (const [key, videoId] of Object.entries(manualOverrides)) {
    const normKey = normaliseCacheKey(key);
    const entry: any = {
      videoId,
      fetchedAt: new Date().toISOString(),
      score: 1.0,
      confidence: 1.0,
      channelTitle: 'team coco',
      manualOverride: true,
    };
    cache[normKey] = entry;
  }

  const guestEpisodes = episodes.filter(
    (e) => e.guestName && !e.isFanSegment && !e.isStaffEpisode
  );

  console.log(`[YouTube] ${guestEpisodes.length} guest episodes to process`);

  for (const episode of guestEpisodes) {
    if (!episode.guestName) continue;

    const cacheKey = `${episode.guestName}::${toISODate(episode.pubDate ?? '')}`;
    const existing = cache[cacheKey];

    // Skip if manually overridden (human-verified correct video)
    if (existing && (existing as any).manualOverride) continue;

    // Skip if cached within TTL
    if (existing) {
      const age = now - new Date(existing.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) continue;
    }

    if (searchCount >= MAX_SEARCHES_PER_RUN) {
      console.log(`[YouTube] Reached quota cap (${MAX_SEARCHES_PER_RUN} searches)`);
      break;
    }

    const episodeYear = episode.pubDate ? new Date(episode.pubDate).getFullYear() : '';
    const query = `${PODCAST_NAME} ${episode.guestName} Full Episode ${episodeYear}`.trim();

    try {
      const res = await axios.get(
        'https://www.googleapis.com/youtube/v3/search',
        {
          params: {
            part: 'snippet',
            q: query,
            type: 'video',
            maxResults: 5,
            key: apiKey,
          },
          timeout: 10000,
        }
      );

      const items: Array<{
        id: { videoId: string };
        snippet: { title: string; channelTitle: string; publishedAt: string };
      }> = res.data.items || [];

      // Pre-filter: channel must match before spending quota on duration
      const candidates = items.filter((item) =>
        channelMatches(item.snippet.channelTitle)
      );

      let bestVideoId: string | null = null;
      let bestConfidence = 0;
      let bestChannel: string | null = null;

      if (candidates.length > 0) {
        const durations = await fetchDurations(
          candidates.map((c) => c.id.videoId),
          apiKey
        );

        for (const item of candidates) {
          const vid = item.id.videoId;
          const confidence = scoreCandidate(
            item.snippet.title,
            item.snippet.channelTitle,
            durations[vid] ?? 0,
            episode.guestName!,
            episode.title,
            item.snippet.publishedAt ?? '',
            episode.pubDate ?? ''
          );
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestVideoId = vid;
            bestChannel = item.snippet.channelTitle;
          }
        }
      }

      // Reject if below threshold
      const accepted = bestConfidence >= MIN_CONFIDENCE;
      if (!accepted) {
        bestVideoId = null;
        if (candidates.length === 0) {
          console.log(
            `[YouTube] No channel match — episode="${cacheKey}" query="${query}"`
          );
        } else {
          console.log(
            `[YouTube] Low confidence (${bestConfidence}) — episode="${cacheKey}" query="${query}"`
          );
        }
      }

      cache[cacheKey] = {
        videoId: accepted ? bestVideoId : null,
        fetchedAt: new Date().toISOString(),
        score: bestConfidence,
        confidence: bestConfidence,
        channelTitle: accepted ? bestChannel : null,
      };

      if (accepted && bestVideoId) newMatches++;
      searchCount++;

      if (searchCount % 10 === 0) {
        writeCache(CACHE_FILE, cache);
        console.log(`[YouTube] ${searchCount} searches, ${newMatches} matches`);
      }

      await sleep(200);
    } catch (err: any) {
      console.warn(`[YouTube] Error for "${episode.guestName}": ${err.message}`);
      cache[cacheKey] = {
        videoId: null,
        fetchedAt: new Date().toISOString(),
        score: 0,
        confidence: 0,
        channelTitle: null,
      };
    }
  }

  writeCache(CACHE_FILE, cache);
  console.log(`[YouTube] Done: ${searchCount} searches, ${newMatches} new matches`);
  return cache;
}

if (require.main === module) {
  import('./fetch-podcast-rss').then(async ({ fetchPodcastRSS }) => {
    const episodes = await fetchPodcastRSS();
    const cache = await matchYouTubeVideos(episodes);
    const total = Object.keys(cache).length;
    const matched = Object.values(cache).filter((v) => v.videoId).length;
    console.log(`\nYouTube cache: ${total} entries, ${matched} with videos`);
  });
}
