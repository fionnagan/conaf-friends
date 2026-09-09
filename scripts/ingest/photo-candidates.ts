/**
 * Multi-image candidate collector.
 *
 * For each guest fetches up to N_CANDIDATES URLs from:
 *   1. Wikipedia thumbnail (existing path)
 *   2. Wikipedia page images (prop=images, up to 3 more)
 *   3. Wikimedia Commons search by name (1 extra)
 *
 * Returns raw URL list — no face work here.
 */

import { sleep } from './utils';
import { wikiGet } from './wiki';

const N_CANDIDATES = 5;

const WC_API = 'https://commons.wikimedia.org/w/api.php';

// Portrait-signal: filenames with these keywords are more likely headshots
const PORTRAIT_HINTS = /portrait|headshot|photo|pic\b|\.jpg|\.jpeg/i;
// Filenames to skip (logos, awards, etc.)
const SKIP_PATTERNS  = /logo|award|icon|symbol|map|chart|poster|album|cover|sign|flag/i;

// All three functions below used raw axios.get with a bare try/catch that
// swallowed ANY error — including a 429 — as "no candidates found", no
// differently than a guest who genuinely has no Wikipedia photo. Confirmed
// via a real backfill run: Seth Rogen, Denis Leary, and Maria Bamford (all
// unambiguously have a Wikipedia infobox photo) got cached as photo-less
// this way, back-to-back, right after two other guests succeeded — the
// rate-limit-shaped failure pattern wiki.ts's wikiGet() already exists to
// handle correctly (real Retry-After, not a guess) for the bios pipeline.
// Switched to it here so a transient/rate-limited failure gets retried
// instead of silently becoming a false negative that's then cached forever.

async function getWikiThumb(name: string): Promise<string | null> {
  try {
    const data = await wikiGet({
      action: 'query', prop: 'pageimages', titles: name,
      format: 'json', pithumbsize: 500, redirects: 1,
    });
    const pages = data.query?.pages || {};
    const page  = Object.values(pages)[0] as any;
    return page?.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

async function getWikiPageImages(name: string): Promise<string[]> {
  try {
    // Step 1: get list of image file names on the page
    const listData = await wikiGet({
      action: 'query', prop: 'images', titles: name,
      format: 'json', imlimit: 20, redirects: 1,
    });
    const pages  = listData.query?.pages || {};
    const page   = Object.values(pages)[0] as any;
    const images: Array<{ title: string }> = page?.images ?? [];

    const candidates = images
      .map((i) => i.title)
      .filter((t) => !SKIP_PATTERNS.test(t) && /\.(jpg|jpeg|png)$/i.test(t))
      .slice(0, 6);

    if (!candidates.length) return [];

    // Step 2: resolve file names → actual URLs via imageinfo
    const urlData = await wikiGet({
      action: 'query', prop: 'imageinfo', titles: candidates.join('|'),
      format: 'json', iiprop: 'url', iiurlwidth: 500,
    });
    const urlPages = urlData.query?.pages || {};
    return Object.values(urlPages)
      .map((p: any) => p?.imageinfo?.[0]?.thumburl ?? p?.imageinfo?.[0]?.url)
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

async function getCommonsImages(name: string): Promise<string[]> {
  try {
    const searchData = await wikiGet({
      action: 'query', list: 'search', srsearch: `${name} portrait`,
      srnamespace: 6, srlimit: 5, format: 'json',
    }, WC_API);
    const hits: Array<{ title: string }> = searchData.query?.search ?? [];
    const titles = hits.map((h) => h.title).slice(0, 3);
    if (!titles.length) return [];

    const urlData = await wikiGet({
      action: 'query', prop: 'imageinfo', titles: titles.join('|'),
      format: 'json', iiprop: 'url', iiurlwidth: 500,
    }, WC_API);
    return Object.values(urlData.query?.pages || {})
      .map((p: any) => p?.imageinfo?.[0]?.thumburl ?? p?.imageinfo?.[0]?.url)
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

/** Score a URL for portrait likelihood (heuristic, no network call). */
function portraitScore(url: string): number {
  let score = 0;
  if (PORTRAIT_HINTS.test(url)) score += 1;
  if (/cropped/i.test(url)) score += 2;   // Wikipedia often crops portraits
  if (SKIP_PATTERNS.test(url)) score -= 5;
  return score;
}

export async function fetchCandidates(
  guestName: string,
  delayMs = 600
): Promise<string[]> {
  const [thumb, pageImgs, commonsImgs] = await Promise.all([
    getWikiThumb(guestName),
    getWikiPageImages(guestName),
    getCommonsImages(guestName),
  ]);

  await sleep(delayMs);

  const seen = new Set<string>();
  const pool: string[] = [];

  // Thumb first (highest trust Wikipedia portrait)
  if (thumb) { seen.add(thumb); pool.push(thumb); }

  // Wikipedia page images, ranked by portrait score
  const ranked = [...pageImgs, ...commonsImgs]
    .filter((u) => !seen.has(u))
    .sort((a, b) => portraitScore(b) - portraitScore(a));

  for (const url of ranked) {
    if (pool.length >= N_CANDIDATES) break;
    seen.add(url);
    pool.push(url);
  }

  return pool;
}
