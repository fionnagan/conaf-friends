/**
 * Verified talk-show guest extraction from Wikipedia episode lists.
 *
 * Late Night, The Tonight Show, and Conan (TBS) all have Wikipedia episode tables with a
 * dedicated "Guest(s)" column (separate from "Musical/entertainment guest(s)") and an ISO
 * air date in the release-date cell. Reading only the Guest(s) column gives verified,
 * dated, people-only data — musical acts are excluded by column, no heuristics needed.
 *
 * This REPLACES both the old fabricated hardcoded list AND the earlier TVmaze sourcing,
 * which only covered ~1,004 of Late Night's ~2,400 episodes and lumped musical guests in.
 *
 * Conan O'Brien Must Go (travel show) has no guest column; its sparse celebrity guests are
 * pulled from the episode-summary prose ("...where he visits <a>Name</a>").
 *
 *   npx tsx scripts/ingest/fetch-talkshow-guests.ts            # fetch + cache
 *   npx tsx scripts/ingest/fetch-talkshow-guests.ts --dry      # report only
 *   npx tsx scripts/ingest/fetch-talkshow-guests.ts --samples  # show filtered samples
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { readCache, writeCache, sleep, normalizeGuestName, USER_AGENT } from './utils';
import type { RawLateNightAppearance, Era } from '../../lib/types';

const CACHE_FILE = 'late-night-history.json';

interface WikiSource { url: string; era: Era; label: string; }

const WIKI_SOURCES: WikiSource[] = [
  // Late Night with Conan O'Brien (1993–2009) — one article per season (16).
  ...Array.from({ length: 16 }, (_, i) => i + 1).map((n) => ({
    url: `https://en.wikipedia.org/wiki/List_of_Late_Night_with_Conan_O%27Brien_episodes_(season_${n})`,
    era: 'late-night-nbc' as Era,
    label: `Late Night season ${n}`,
  })),
  // The Tonight Show with Conan O'Brien (2009–2010) — single episode-list article.
  {
    url: 'https://en.wikipedia.org/wiki/List_of_The_Tonight_Show_with_Conan_O%27Brien_episodes',
    era: 'tonight-show' as Era,
    label: 'Tonight Show',
  },
  // Conan (TBS, 2010–2021) — one article per year.
  ...['2010%E2%80%9311', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021'].map((y) => ({
    url: `https://en.wikipedia.org/wiki/List_of_Conan_episodes_(${y})`,
    era: 'tbs-conan' as Era,
    label: `Conan TBS ${decodeURIComponent(y)}`,
  })),
];

const WIKI_MUSTGO = 'https://en.wikipedia.org/wiki/Conan_O%27Brien_Must_Go';

// Each era's real broadcast range — used to reject citation dates / OCR garbage that the
// release-date cell sometimes contains (e.g. a "retrieved 2018-03-17" ref, or "3008-07-30").
const ERA_RANGE: Record<string, [string, string]> = {
  'late-night-nbc': ['1993-09-13', '2009-02-20'],
  'tonight-show':   ['2009-06-01', '2010-01-22'],
  'tbs-conan':      ['2010-11-08', '2021-06-24'],
  'conan-must-go':  ['2024-04-18', '2027-12-31'],
};

// ── Name handling ────────────────────────────────────────────────────────────────

// Hosts / recurring bits / non-celebrity placeholders that must never be logged as guests.
const NOT_A_GUEST = new Set<string>([
  'conan o\'brien', 'conan obrien', 'andy richter', 'max weinberg', 'jimmy vivino', 'la bamba',
  'stuttering john', 'triumph', 'pimpbot', 'pimpbot 5000', 'the masturbating bear',
]);

const MONONYMS = new Set([
  'cher', 'sting', 'bono', 'madonna', 'slash', 'prince', 'common', 'eminem', 'drake', 'usher',
  'beck', 'pink', 'lorde', 'adele', 'sia', 'flea', 'moby', 'ludacris', 'nelly', 'rihanna',
  'beyonce', 'cee-lo', 'questlove', 'kesha', 'sinbad', 'fabio', 'jewel',
]);

function titleCaseIfShouty(name: string): string {
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    return name.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
  }
  return name;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/,\s*(jr|sr|ii|iii|iv)\b\.?/i, ' $1')  // "Harry Connick, Jr." → "Harry Connick Jr"
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z]+|[^A-Za-z.'’]+$/g, '')
    .trim();
}

function looksLikePerson(name: string): boolean {
  if (MONONYMS.has(name.toLowerCase())) return true;
  // First Last (with optional middle initials / particles) — two+ capitalised tokens.
  return /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(name);
}

interface ExtractStats {
  appearances: RawLateNightAppearance[];
  filteredOther: string[];
}

function addGuest(raw: string, era: Era, date: string, stats: ExtractStats): void {
  const [lo, hi] = ERA_RANGE[era] ?? ['1993-01-01', '2099-12-31'];
  if (date < lo || date > hi) return; // citation/garbage date, not a real air date
  const token = titleCaseIfShouty(cleanName(raw));
  if (!token || token.length < 3) return;
  if (NOT_A_GUEST.has(token.toLowerCase())) { stats.filteredOther.push(token); return; }
  // Episode-title / band leaks that land in a Guest(s) cell ("Finland Show",
  // "Andy's Good-bye Show", "Old Crow Medicine Show"). Costs us the wrestler "Big Show".
  if (/\b(show|compilation|anniversary|retrospective|good-?bye)\s*$/i.test(token)) { stats.filteredOther.push(token); return; }
  if (!looksLikePerson(token)) { stats.filteredOther.push(token); return; }
  stats.appearances.push({ guestName: normalizeGuestName(token), era, date, source: 'wikipedia', confidence: 'high' });
}

// ── Wikipedia episode tables (Late Night / Tonight Show / TBS) ───────────────────
async function fetchWikipediaEpisodes(src: WikiSource, stats: ExtractStats): Promise<number> {
  const res = await axios.get(src.url, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
  const $ = cheerio.load(res.data);
  let rows = 0;

  $('table.wikitable').each((_i, table) => {
    const headers = $(table).find('tr').first().find('th').map((_j, th) => $(th).text().trim().toLowerCase()).get();
    const guestIdx = headers.findIndex((h) => h.includes('guest') && !h.includes('musical') && !h.includes('entertainment'));
    const dateIdx = headers.findIndex((h) => h.includes('release date') || h.includes('air date') || h.includes('date'));
    if (guestIdx < 0 || dateIdx < 0) return;

    $(table).find('tr').slice(1).each((_j, tr) => {
      const cells = $(tr).find('th,td');
      if (cells.length <= Math.max(guestIdx, dateIdx)) return;
      const date = ($(cells[dateIdx]).text().match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (!date) return;

      const gcell = $(cells[guestIdx]);
      let names = gcell.find('a').map((_k, a) => $(a).text().trim()).get().filter((n) => n && !n.startsWith('['));
      if (names.length === 0) names = gcell.text().split(/[,;/]/).map((s) => s.trim());
      for (const raw of names) addGuest(raw, src.era, date, stats);
      rows++;
    });
  });
  return rows;
}

// ── Conan O'Brien Must Go (episode-summary prose) ────────────────────────────────
async function fetchMustGo(stats: ExtractStats): Promise<void> {
  const res = await axios.get(WIKI_MUSTGO, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
  const html = res.data as string;
  const dateRe = /itvstart">(\d{4}-\d{2}-\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(html))) {
    const date = m[1];
    const seg = html.slice(m.index, m.index + 600);
    const visits = seg.match(/where he visits ([\s\S]*?)(?:\.|<\/td>|<tr)/);
    if (!visits) continue;
    for (const link of visits[1].matchAll(/<a [^>]*>([^<]+)<\/a>/g)) addGuest(link[1], 'conan-must-go', date, stats);
  }
}

export async function fetchTalkShowGuests(): Promise<RawLateNightAppearance[]> {
  // Late Night / Tonight Show / TBS are finished (immutable); Must Go is ongoing but the
  // cache is gitignored, so a clean CI checkout re-fetches every run. Delete
  // cache/late-night-history.json locally to force a refresh.
  const cached = readCache<RawLateNightAppearance[]>(CACHE_FILE);
  if (cached && cached.length > 0) {
    console.log(`[TalkShow] Using cached ${cached.length} verified appearances`);
    return cached;
  }

  const stats: ExtractStats = { appearances: [], filteredOther: [] };

  for (const src of WIKI_SOURCES) {
    const rows = await fetchWikipediaEpisodes(src, stats);
    console.log(`[TalkShow] ${src.label}: ${rows} episode rows`);
    await sleep(700);
  }
  console.log('[TalkShow] Conan O\'Brien Must Go');
  await fetchMustGo(stats);

  // Dedupe by guest + era + date (a person can legitimately recur on other dates).
  const seen = new Set<string>();
  const deduped = stats.appearances.filter((a) => {
    const key = `${a.guestName.toLowerCase()}::${a.era}::${a.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Report ──
  const byEra: Record<string, Set<string>> = {};
  for (const a of deduped) (byEra[a.era] ??= new Set()).add(a.guestName.toLowerCase());
  console.log(`\n[TalkShow] ${deduped.length} verified appearances`);
  for (const era of Object.keys(byEra)) console.log(`  ${era}: ${deduped.filter((a) => a.era === era).length} appearances, ${byEra[era].size} distinct guests`);
  console.log(`  filtered as non-guests: ${stats.filteredOther.length} (${new Set(stats.filteredOther).size} distinct)`);

  if (process.argv.includes('--samples')) {
    const uniq = [...new Set(stats.filteredOther)];
    console.log('\n  other-filtered sample:', uniq.slice(0, 40).join(' · '));
    const counts = new Map<string, number>();
    for (const a of deduped) counts.set(a.guestName, (counts.get(a.guestName) ?? 0) + 1);
    console.log('\n  top recurring:', [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${n}(${c})`).join(' · '));
  }

  if (!process.argv.includes('--dry')) {
    writeCache(CACHE_FILE, deduped);
    console.log(`\n[TalkShow] Wrote ${deduped.length} → cache/${CACHE_FILE}`);
  } else {
    console.log('\n[TalkShow] --dry: cache not written');
  }

  return deduped;
}

if (require.main === module) {
  fetchTalkShowGuests().catch((err) => { console.error('[TalkShow] failed:', err); process.exit(1); });
}
