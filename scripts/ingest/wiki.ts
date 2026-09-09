/**
 * wiki.ts
 * Small shared Wikipedia Action API helpers, factored out of
 * fetch-conan-activity.ts once fetch-crossed-paths.ts needed the exact same
 * "list sections, fetch one section's parsed HTML" mechanics for a different
 * page (a film's Wikipedia article instead of Conan's own).
 *
 * Confirmed via a real run: back-to-back requests across both scripts (one
 * article's extract + sections + per-section HTML, repeated per film) trip
 * Wikipedia's rate limiter (HTTP 429) well within a normal run. Wikipedia
 * tells us exactly how long to wait via the `Retry-After` header, so every
 * request here retries on 429 by waiting that long instead of guessing a
 * backoff — this is a real, documented rate limit, not a flake to shrug off.
 */
import axios from 'axios';
import { USER_AGENT, sleep } from './utils';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const MAX_RETRIES = 3;
const DEFAULT_RETRY_SECONDS = 30;

export interface WikiSection {
  index: string;
  line: string;
}

// Exported so callers hitting a different MediaWiki Action API (e.g.
// Wikimedia Commons) get the same real-Retry-After retry behavior instead
// of writing their own bare try/catch that silently swallows a 429 as "no
// results" — confirmed via a real photo-backfill run that guests with an
// unambiguous Wikipedia photo (Seth Rogen, Denis Leary, Maria Bamford) got
// cached as photo-less after 3 back-to-back requests without this.
// deadlineMs is an optional absolute Date.now()-scale timestamp — when a 429
// wait would push past it, wikiGet gives up immediately (throws) instead of
// waiting Wikipedia's real Retry-After in full. Omitted, behavior is
// unchanged from before this param existed: every other current caller
// (photo-candidates.ts, backfill-booking-signals.ts, fetch-conan-activity.ts,
// fetch-crossed-paths.ts) omits it and keeps waiting out 429s in full, same
// as always. Added for enrich-bios.ts's resolveEntity(), which tries up to 5
// name variants per guest sequentially — without a real per-call deadline, a
// between-attempts-only budget check couldn't cap a single call's own
// internal retry-wait, so total time could still exceed the intended cap by
// a full uncapped Retry-After.
export async function wikiGet(
  params: Record<string, string | number>,
  apiUrl: string = WIKI_API,
  deadlineMs?: number
): Promise<any> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(apiUrl, {
        headers: { 'User-Agent': USER_AGENT },
        params,
        timeout: 20000,
      });
      return res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status !== 429 || attempt === MAX_RETRIES) throw err;
      const retryAfter = Number(err.response.headers?.['retry-after']) || DEFAULT_RETRY_SECONDS;
      const waitMs = retryAfter * 1000;
      if (deadlineMs !== undefined && Date.now() + waitMs > deadlineMs) {
        console.log(`  Wikipedia rate limit hit (429) — a ${retryAfter}s wait would exceed the caller's deadline, giving up early instead of waiting.`);
        throw err;
      }
      console.log(`  Wikipedia rate limit hit (429) — waiting ${retryAfter}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await sleep(waitMs);
    }
  }
  throw new Error('unreachable');
}

// Full plain-text article extract. Note: this silently drops wikitables (see
// fetch-conan-activity.ts) — use fetchWikiSectionHtml for anything tabular.
export async function fetchWikiExtract(title: string): Promise<string> {
  const data = await wikiGet({
    action: 'query',
    prop: 'extracts',
    explaintext: 1,
    titles: title,
    format: 'json',
    redirects: 1,
  });
  const pages = data?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  return page?.missing !== undefined ? '' : (page?.extract ?? '');
}

export interface WikiEntity {
  title: string;
  url: string;
  extract: string;
  isDisambiguation: boolean;
}

// Title resolution + full plain-text extract + disambiguation check in ONE
// Action API call, instead of enrich-bios.ts's old two-call pattern (a REST
// summary call for title/URL/disambiguation, then a separate Action API call
// for the extract). Confirmed via a real backfill run that guest enrichment
// was tripping Wikipedia's rate limiter well within a 250-guest run at 2
// calls/guest — halving that to 1 call/guest directly cuts how often that
// happens, on top of being the faster path when it doesn't.
export async function fetchWikiEntity(pageTitle: string, deadlineMs?: number): Promise<WikiEntity | null> {
  const data = await wikiGet({
    action: 'query',
    prop: 'extracts|pageprops',
    explaintext: 1,
    ppprop: 'disambiguation',
    titles: pageTitle,
    format: 'json',
    redirects: 1,
  }, WIKI_API, deadlineMs);
  const pages = data?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;

  const title = page.title ?? pageTitle;
  return {
    title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    extract: page.extract ?? '',
    isDisambiguation: page.pageprops?.disambiguation !== undefined,
  };
}

export async function fetchWikiSections(title: string): Promise<WikiSection[]> {
  const data = await wikiGet({ action: 'parse', page: title, prop: 'sections', format: 'json', redirects: 1 });
  return data?.parse?.sections ?? [];
}

// Raw parsed HTML for one section (by the index fetchWikiSections gave it) —
// the only way to reliably read a wikitable or bullet list, since the
// plaintext extract API drops both.
export async function fetchWikiSectionHtml(title: string, sectionIndex: string): Promise<string> {
  const data = await wikiGet({ action: 'parse', page: title, section: sectionIndex, prop: 'text', format: 'json', redirects: 1 });
  return data?.parse?.text?.['*'] ?? '';
}
