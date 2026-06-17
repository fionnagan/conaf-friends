/**
 * Verified talk-show guest extraction from the TVmaze API.
 *
 * Late Night and The Tonight Show store the guest line-up directly in each
 * episode's `name` field (e.g. "Will Ferrell, Pearl Jam"), with a real airdate.
 * Both shows are finished, so this data is immutable — we fetch once and cache.
 *
 * This REPLACES the old hardcoded/fabricated KNOWN_LATE_NIGHT_GUESTS list and the
 * crude Wikipedia/IMDb scrapers, which stamped invented dates (e.g. 2004-03-15) and
 * placeholders (1993-01-01). Every appearance here carries a real air date.
 *
 * TBS Conan (#243) is intentionally NOT here: TVmaze stores only comedic episode
 * titles for it (no guest names), so it needs a different source.
 *
 *   npx tsx scripts/ingest/fetch-talkshow-guests.ts            # fetch + cache + report
 *   npx tsx scripts/ingest/fetch-talkshow-guests.ts --dry      # report only, no cache write
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { readCache, writeCache, sleep, normalizeGuestName, USER_AGENT } from './utils';
import type { RawLateNightAppearance, Era } from '../../lib/types';

const CACHE_FILE = 'late-night-history.json';

// Late Night + Tonight Show: TVmaze stores the guest line-up in each episode's `name`.
const SHOWS: { id: number; era: Era; title: string }[] = [
  { id: 836,  era: 'late-night-nbc', title: 'Late Night with Conan O\'Brien' },
  { id: 4162, era: 'tonight-show',   title: 'The Tonight Show with Conan O\'Brien' },
];

// TBS Conan: TVmaze has only joke episode-titles, so we use Wikipedia's per-year episode
// lists, which have a dedicated "Guest(s)" column (separate from musical guests) and ISO
// dates. One article per year, 2010–2021.
const WIKI_TBS_YEARS = ['2010%E2%80%9311', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021'];
const WIKI_TBS_SOURCES = WIKI_TBS_YEARS.map((y) => ({
  url: `https://en.wikipedia.org/wiki/List_of_Conan_episodes_(${y})`,
  era: 'tbs-conan' as Era,
  label: `Conan TBS ${decodeURIComponent(y)}`,
}));

// Conan O'Brien Must Go (travel show): the premise is visiting fans, so celebrity guests
// are sparse. They appear in the episode-summary prose ("...where he visits <a>Name</a>")
// — only the linked names are notable people; unlinked fans are correctly skipped.
const WIKI_MUSTGO = 'https://en.wikipedia.org/wiki/Conan_O%27Brien_Must_Go';

// ── Filters ────────────────────────────────────────────────────────────────────

// Episode "names" that aren't guest line-ups at all.
const NON_EPISODE = /\b(best of|repeat|encore|rerun|clip show|highlights|in memoriam|tribute|anniversary|retrospective|tba|tbd|n\/a|special|finale|premiere)\b|^show\s*\d|^untitled|^episode\b/i;

// Pure musical acts / bands — excluded per project decision (people only).
// Name-structure can't distinguish "Pearl Jam" (band) from a person, so we use a
// curated stoplist of acts that appeared plus structural band signals.
const BAND_SIGNAL = /\b(band|trio|quartet|quintet|sextet|orchestra|ensemble|choir|symphony|allstars|all-stars|experience|project|collective|crew|sound system|featuring|feat\.?)\b|&| \+ |^the |^dj\s|^mc\s/i;

const MUSIC_STOPLIST = new Set<string>([
  'pearl jam', 'green day', 'foo fighters', 'radiohead', 'wilco', 'weezer', 'coldplay',
  'u2', 'r.e.m.', 'metallica', 'nirvana', 'beastie boys', 'the roots', 'the strokes',
  'the white stripes', 'kings of leon', 'arcade fire', 'vampire weekend', 'spinal tap',
  'superchunk', 'jackopierce', 'frente', 'lush', 'us3', 'radiators', 'g-love',
  'phish', 'sublime', 'no doubt', 'blink-182', 'sum 41', 'jimmy eat world', 'the killers',
  'modest mouse', 'death cab for cutie', 'my morning jacket', 'the shins', 'spoon',
  'gomez', 'fountains of wayne', 'guster', 'maroon 5', 'oasis', 'garbage', 'bush',
  'live', 'soul asylum', 'cake', 'ben folds five', 'they might be giants', 'pavement',
]);

// Recurring bits / non-celebrity placeholders that surface in the name field.
const NOT_A_GUEST = new Set<string>([
  'stuttering john', 'pimpbot', 'pimpbot 5000', 'the masturbating bear',
  'triumph', 'conan o\'brien', 'andy richter', 'max weinberg', 'la bamba',
]);

function titleCaseIfShouty(name: string): string {
  // "JIM GAFFIGAN" → "Jim Gaffigan"; leave normal/mixed-case names alone.
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) {
    return name.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
  }
  return name;
}

function cleanName(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, '')        // drop "(Full Episode)", "(host)" notes
    .replace(/\[[^\]]*\]/g, '')        // drop "[1]" refs
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z]+|[^A-Za-z.'’]+$/g, '')
    .trim();
}

function looksLikePerson(name: string): boolean {
  // Person mononyms we keep even though they're one token.
  const MONONYMS = new Set([
    'cher', 'sting', 'bono', 'madonna', 'slash', 'prince', 'common', 'eminem',
    'drake', 'usher', 'beck', 'pink', 'lorde', 'adele', 'sia', 'flea', 'moby',
    'ludacris', 'nelly', 'rihanna', 'beyonce', 'cee-lo', 'will.i.am',
  ]);
  const lower = name.toLowerCase();
  if (MONONYMS.has(lower)) return true;
  // First Last (optionally with middle initial / particles) — two+ capitalised tokens.
  return /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(name);
}

interface ExtractStats {
  appearances: RawLateNightAppearance[];
  filteredMusic: string[];
  filteredOther: string[];
}

const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md|esq)\.?$/i;

function splitGuests(episodeName: string): string[] {
  // Guests are separated by commas, semicolons, or slashes. We split on those (and a
  // leading "with"/"plus").
  const parts = episodeName
    .replace(/\bwith\b|\bplus\b/gi, ',')
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Re-attach orphaned name suffixes split off by a comma ("Cuba Gooding, Jr.").
  const merged: string[] = [];
  for (const p of parts) {
    if (SUFFIX.test(p) && merged.length) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }

  // Expand "X and Y" / "X & Y" billings, but only when BOTH sides independently look
  // like a person — so duos ("Steve Martin and Martin Short") split while bands
  // ("Hall & Oates", "Penn and Teller" mononyms) and real names don't get mangled.
  const expanded: string[] = [];
  for (const seg of merged) {
    const pair = seg.split(/\s+(?:&|and)\s+/i).map((s) => s.trim());
    if (pair.length === 2 && pair.every((p) => looksLikePerson(titleCaseIfShouty(cleanName(p))))) {
      expanded.push(...pair);
    } else {
      expanded.push(seg);
    }
  }
  return expanded;
}

async function fetchShow(
  id: number,
  era: Era,
  stats: ExtractStats
): Promise<void> {
  const url = `https://api.tvmaze.com/shows/${id}/episodes`;
  const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
  const episodes = res.data as { name: string; airdate: string }[];

  for (const ep of episodes) {
    const name = (ep.name || '').trim();
    const date = (ep.airdate || '').trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (NON_EPISODE.test(name)) continue;

    for (const tokenRaw of splitGuests(name)) {
      const token = titleCaseIfShouty(cleanName(tokenRaw));
      if (!token || token.length < 3) continue;
      const lower = token.toLowerCase();

      if (NOT_A_GUEST.has(lower)) { stats.filteredOther.push(token); continue; }
      if (MUSIC_STOPLIST.has(lower) || BAND_SIGNAL.test(token)) { stats.filteredMusic.push(token); continue; }
      if (!looksLikePerson(token)) { stats.filteredOther.push(token); continue; }

      stats.appearances.push({
        guestName: normalizeGuestName(token),
        era,
        date,
        episodeTitle: name,
        source: 'tvmaze',
        confidence: 'high',
      });
    }
  }
}

// Wikipedia per-year Conan (TBS) episode lists. Each table has a "Guest(s)" column
// (separate from "Musical/entertainment guest(s)"), so reading only that column gives
// people-only data with no music-filtering needed. Dates are ISO-encoded in the cell.
async function fetchWikipediaTBS(
  url: string,
  era: Era,
  stats: ExtractStats
): Promise<void> {
  const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
  const $ = cheerio.load(res.data);

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

      for (const raw of names) {
        const token = titleCaseIfShouty(cleanName(raw));
        if (!token || token.length < 3) continue;
        const lower = token.toLowerCase();
        if (NOT_A_GUEST.has(lower)) { stats.filteredOther.push(token); continue; }
        if (!looksLikePerson(token)) { stats.filteredOther.push(token); continue; }
        stats.appearances.push({ guestName: normalizeGuestName(token), era, date, source: 'wikipedia', confidence: 'high' });
      }
    });
  });
}

// Conan O'Brien Must Go — celebrity guests from episode-summary prose.
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
    for (const link of visits[1].matchAll(/<a [^>]*>([^<]+)<\/a>/g)) {
      const token = titleCaseIfShouty(cleanName(link[1]));
      if (!token || token.length < 3) continue;
      if (NOT_A_GUEST.has(token.toLowerCase())) { stats.filteredOther.push(token); continue; }
      if (!looksLikePerson(token)) { stats.filteredOther.push(token); continue; }
      stats.appearances.push({ guestName: normalizeGuestName(token), era: 'conan-must-go', date, source: 'wikipedia', confidence: 'high' });
    }
  }
}

export async function fetchTalkShowGuests(): Promise<RawLateNightAppearance[]> {
  // The NBC eras are finished (immutable); TBS is finished too. Conan Must Go is ongoing,
  // but the cache is gitignored, so a clean CI checkout re-fetches every run and stays
  // current. Delete cache/late-night-history.json locally to force a refresh.
  const cached = readCache<RawLateNightAppearance[]>(CACHE_FILE);
  if (cached && cached.length > 0) {
    console.log(`[TalkShow] Using cached ${cached.length} verified appearances`);
    return cached;
  }

  const stats: ExtractStats = { appearances: [], filteredMusic: [], filteredOther: [] };

  for (const show of SHOWS) {
    console.log(`[TalkShow] TVmaze #${show.id} — ${show.title}`);
    await fetchShow(show.id, show.era, stats);
    await sleep(500);
  }

  for (const src of WIKI_TBS_SOURCES) {
    console.log(`[TalkShow] Wikipedia — ${src.label}`);
    await fetchWikipediaTBS(src.url, src.era, stats);
    await sleep(800);
  }

  console.log('[TalkShow] Wikipedia — Conan O\'Brien Must Go');
  await fetchMustGo(stats);
  await sleep(500);

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
  for (const [era, set] of Object.entries(byEra)) console.log(`  ${era}: ${deduped.filter(a => a.era === era).length} appearances, ${set.size} distinct guests`);
  console.log(`  filtered as music acts: ${stats.filteredMusic.length} (${new Set(stats.filteredMusic).size} distinct)`);
  console.log(`  filtered as non-guests: ${stats.filteredOther.length} (${new Set(stats.filteredOther).size} distinct)`);

  if (process.argv.includes('--samples')) {
    const uniq = (a: string[]) => [...new Set(a)];
    console.log('\n  music-filtered sample:', uniq(stats.filteredMusic).slice(0, 30).join(' · '));
    console.log('\n  other-filtered sample:', uniq(stats.filteredOther).slice(0, 30).join(' · '));
    const counts = new Map<string, number>();
    for (const a of deduped) counts.set(a.guestName, (counts.get(a.guestName) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log('\n  top recurring kept guests:', top.map(([n, c]) => `${n}(${c})`).join(' · '));
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
