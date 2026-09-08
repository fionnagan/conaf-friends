/**
 * wiki.ts
 * Small shared Wikipedia Action API helpers, factored out of
 * fetch-conan-activity.ts once fetch-crossed-paths.ts needed the exact same
 * "list sections, fetch one section's parsed HTML" mechanics for a different
 * page (a film's Wikipedia article instead of Conan's own).
 */
import axios from 'axios';
import { USER_AGENT } from './utils';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

export interface WikiSection {
  index: string;
  line: string;
}

// Full plain-text article extract. Note: this silently drops wikitables (see
// fetch-conan-activity.ts) — use fetchWikiSectionHtml for anything tabular.
export async function fetchWikiExtract(title: string): Promise<string> {
  const res = await axios.get(WIKI_API, {
    headers: { 'User-Agent': USER_AGENT },
    params: {
      action: 'query',
      prop: 'extracts',
      explaintext: 1,
      titles: title,
      format: 'json',
      redirects: 1,
    },
    timeout: 20000,
  });
  const pages = res.data?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  return page?.missing !== undefined ? '' : (page?.extract ?? '');
}

export async function fetchWikiSections(title: string): Promise<WikiSection[]> {
  const res = await axios.get(WIKI_API, {
    headers: { 'User-Agent': USER_AGENT },
    params: { action: 'parse', page: title, prop: 'sections', format: 'json', redirects: 1 },
    timeout: 20000,
  });
  return res.data?.parse?.sections ?? [];
}

// Raw parsed HTML for one section (by the index fetchWikiSections gave it) —
// the only way to reliably read a wikitable or bullet list, since the
// plaintext extract API drops both.
export async function fetchWikiSectionHtml(title: string, sectionIndex: string): Promise<string> {
  const res = await axios.get(WIKI_API, {
    headers: { 'User-Agent': USER_AGENT },
    params: { action: 'parse', page: title, section: sectionIndex, prop: 'text', format: 'json', redirects: 1 },
    timeout: 20000,
  });
  return res.data?.parse?.text?.['*'] ?? '';
}
