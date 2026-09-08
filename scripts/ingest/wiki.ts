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

async function wikiGet(params: Record<string, string | number>): Promise<any> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(WIKI_API, {
        headers: { 'User-Agent': USER_AGENT },
        params,
        timeout: 20000,
      });
      return res.data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status !== 429 || attempt === MAX_RETRIES) throw err;
      const retryAfter = Number(err.response.headers?.['retry-after']) || DEFAULT_RETRY_SECONDS;
      console.log(`  Wikipedia rate limit hit (429) — waiting ${retryAfter}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await sleep(retryAfter * 1000);
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
