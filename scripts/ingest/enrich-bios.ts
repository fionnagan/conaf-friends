/**
 * Guest Bio Enrichment Pipeline
 *
 * Modes:
 *   --wiki-only   Wikipedia extraction + prose only (no Claude, free)
 *   default       Full pipeline: Wikipedia entity + Claude structured extract + Claude synthesis
 *
 * Usage:
 *   npx tsx scripts/ingest/enrich-bios.ts [--wiki-only] [--force] [--limit N] [--guest "Name"]
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GuestBio, GuestBioWork, Guest } from '../../lib/types';
import { fetchWikiEntity, fetchDisambiguationLinks } from './wiki';
import { BOOKING_SIGNAL_RULES, checkDeathYearPlausibility } from './booking-signal-schema';

// ── Config ───────────────────────────────────────────────────────────────────

const CACHE_DIR  = path.join(process.cwd(), 'scripts', 'cache');
const BIOS_FILE  = path.join(CACHE_DIR, 'bios.json');
const DATA_FILE  = path.join(process.cwd(), 'data', 'guests.json');
const TTL_MS     = 30 * 24 * 60 * 60 * 1000;
const MIN_ENTITY_CONFIDENCE = 0.65;
const MAX_PER_RUN = 50;
const CURRENT_YEAR = new Date().getFullYear();
const RECENT_WORK_CUTOFF_YEAR = CURRENT_YEAR - 3;

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
// Deliberately reprocesses EVERY queued guest regardless of any other
// filter, including --new-only below — an independent review flagged this
// interaction explicitly: --force is the manual escape hatch for a targeted
// fix (typically paired with --guest), and no automated caller passes both
// flags together today, but if a future manual invocation does, --force
// silently wins. That's --force's whole documented purpose working as
// designed, not a bug, but worth stating outright rather than leaving
// implicit in filter-ordering.
const FORCE        = args.includes('--force');
const WIKI_ONLY    = args.includes('--wiki-only');
const RETRY_REVIEW = args.includes('--retry-review');
// Real dollar-risk found in a cost review: without this flag, ANY guest's
// bio re-qualifies for full re-enrichment once its enrichedAt timestamp
// ages past TTL_MS — including guests a backlog-catchup run already
// finished. Once the full guest archive is caught up, simply re-triggering
// Backfill Full Bios after 30 days would silently re-spend real Claude
// calls on the ENTIRE archive, not just guests that never had a bio —
// directly contradicting that workflow's own header comment ("only ever
// picks up guests still missing a bio entirely"), which was aspirational,
// not actually enforced, before this flag existed. --new-only makes that
// promise real: only a guest with NO existing bio at all ever qualifies,
// regardless of staleness. weekly-ingest.yml's own invocation (`npm run
// enrich:bios`, no flags) is unaffected and keeps today's TTL-based
// staleness-refresh behavior — this is deliberately scoped to the one
// workflow where re-spending on the whole archive was a real, unbounded risk.
const NEW_ONLY      = args.includes('--new-only');
const LIMIT        = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : MAX_PER_RUN; })();
const ONLY         = (() => { const i = args.indexOf('--guest'); return i >= 0 ? args[i + 1] : null; })();
// Lets a run be pointed at a cheaper model (e.g. a Haiku generation) for
// direct quality comparison against known-good Sonnet output on the same
// guests, without editing code — defaults to the model this pipeline has
// been validated against.
const MODEL        = (() => { const i = args.indexOf('--model'); return i >= 0 ? args[i + 1] : 'claude-sonnet-4-6'; })();
// Bounded concurrency for the guest-processing loop — cuts wall-clock time
// (guests overlap their Wikipedia/Claude network waits) without changing
// steady-state tokens/dollars spent, since concurrency doesn't change what's
// sent per guest. Defaults to 1 (today's original, fully-serial behavior) —
// an independent review caught that defaulting this above 1 would silently
// change behavior for EVERY caller of this script, including
// weekly-ingest.yml's unflagged `npm run enrich:bios` invocation, which
// never asked for concurrency and whose real Anthropic per-minute rate
// limit headroom was never validated against it. Concurrency is opt-in per
// caller via --concurrency; backfill-full-bios.yml passes it explicitly
// since it's the workflow this optimization pass actually targets.
const CONCURRENCY  = (() => { const i = args.indexOf('--concurrency'); return i >= 0 ? parseInt(args[i + 1]) : 1; })();

// ── Env loading ───────────────────────────────────────────────────────────────

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Wikipedia ─────────────────────────────────────────────────────────────────

export interface WikiEntity {
  name: string;
  wikipedia_url: string;
  intro: string;
  confidence: number;
}

// Diacritic-insensitive — Wikipedia titles keep the accent ("André"),
// data/guests.json names are plain ASCII ("Andre"). Without stripping,
// these tokens never match at all.
const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Strip dots and quote marks (straight + curly) so a Wikipedia title like
// `"Weird Al" Yankovic` still token-matches the plain guest name "Weird Al
// Yankovic" instead of losing two tokens to stuck-on quote characters, and
// so "B.J." matches "B. J." either way.
export function normNameTokens(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/["“”'’]/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/);
}

// Confirmed against real needs_review guests that all landed at exactly the
// 0.65 rejection threshold despite the Wikipedia entity being the right
// person: plain exact-token overlap misses two common, legitimate name-form
// differences —
//   - compound initials: guest name has "bj" as one token, the Wikipedia
//     title spells it "B. J." (two single-letter tokens after normalizing).
//     Same for "jj"/"jb" etc. (BJ Novak, JJ Abrams, JB Smoove).
//   - nickname prefix: "Chris" vs "Christopher", "Mike" vs "Michael" — a
//     short first name that's a genuine prefix of the title's full form.
//     Gated to >=3 chars and <=6 chars of length difference so it can't
//     fuzzy-match unrelated short names (e.g. "Al" prefix-matching
//     "Alabama" would be wrong; "chris"/"christopher" is a 6-char gap).
export function tokenOverlap(nameTokens: string[], titleTokens: string[]): number {
  if (nameTokens.length === 0) return 0;

  // Every contiguous run of single-letter title tokens, concatenated — so
  // title tokens ["b","j"] contributes candidate "bj" (and "b") to match
  // against a guest-name token spelled as one word.
  const initialRuns = new Set<string>();
  for (let i = 0; i < titleTokens.length; i++) {
    if (titleTokens[i].length !== 1) continue;
    let combined = '';
    for (let j = i; j < titleTokens.length && titleTokens[j].length === 1; j++) {
      combined += titleTokens[j];
      initialRuns.add(combined);
    }
  }

  const matched = nameTokens.filter(t =>
    titleTokens.includes(t) ||
    initialRuns.has(t) ||
    titleTokens.some(tt => t.length >= 3 && tt.startsWith(t) && tt.length - t.length <= 6)
  ).length;

  return matched / nameTokens.length;
}

const BIO_SIGNAL_RE = /\b(born|actor|actress|comedian|writer|director|musician|author|host|producer|singer|stand-up)\b/i;

export function scoreEntityMatch(guestName: string, wikiTitle: string, intro: string): number {
  const overlap   = tokenOverlap(normNameTokens(guestName), normNameTokens(wikiTitle));
  const hasBioSig = BIO_SIGNAL_RE.test(intro);
  return Math.min(1, overlap * 0.7 + (hasBioSig ? 0.3 : 0));
}

// A disambiguation page for a name like "Leslie Jones" links out to every
// person who shares it — some genuinely relevant (comedian, actor), most
// not (a rugby player, an RAF officer, a 19th-century politician). Probing
// each one with the existing name/bio-signal scorer can tell "this is
// clearly not a match" from "this looks right", but when TWO OR MORE
// candidates both clear the confidence bar, guessing between them risks
// publishing a real, wrong person's bio under this guest's name — worse
// than the guest simply staying in needs_review. Only auto-resolves when
// exactly one candidate is a plausible match.
const MAX_DISAMBIG_CANDIDATES = 8;

async function resolveFromDisambiguation(
  disambigTitle: string,
  guestName: string,
  deadlineMs: number
): Promise<WikiEntity | null> {
  let links: string[];
  try {
    links = await fetchDisambiguationLinks(disambigTitle, deadlineMs);
  } catch {
    return null;
  }

  const matches: WikiEntity[] = [];
  for (const candidateTitle of links.slice(0, MAX_DISAMBIG_CANDIDATES)) {
    if (Date.now() >= deadlineMs) break;

    let candidate: Awaited<ReturnType<typeof fetchWikiEntity>>;
    try {
      candidate = await fetchWikiEntity(candidateTitle, deadlineMs);
    } catch {
      continue;
    }
    if (!candidate || candidate.isDisambiguation) continue;

    const intro = candidate.extract.slice(0, 6000).trim();
    if (!intro) continue;

    // Every candidate on this disambiguation page already shares the
    // guest's name almost verbatim (that's why it's linked here) — so
    // name-token overlap alone can't tell two same-named people apart, it
    // only screens out a junk link (a bare year, an unrelated "List of..."
    // page). The real discriminator is the bio signal: does this specific
    // candidate read like a person at all, let alone the right kind (actor/
    // comedian/writer/...), which is the population Conan's guest list is
    // drawn from.
    const overlap   = tokenOverlap(normNameTokens(guestName), normNameTokens(candidate.title));
    const hasBioSig = BIO_SIGNAL_RE.test(intro);
    if (overlap >= 0.9 && hasBioSig) {
      const confidence = scoreEntityMatch(guestName, candidate.title, intro);
      matches.push({ name: candidate.title, wikipedia_url: candidate.url, intro, confidence });
    }
  }

  if (matches.length !== 1) return null;
  return matches[0];
}

async function resolveEntity(guestName: string): Promise<WikiEntity | null> {
  // Strategy: try REST summary API (single call, different quota from MediaWiki API)
  // Falls back to name variants for compound titles like "X Live From Y"
  const namesToTry: string[] = [];

  // "Ambassador X" / "Sir X" / "Justice X" / "Dr. X" → "X"
  const noTitle = guestName.replace(/^(?:Ambassador|Senator|President|Governor|Secretary|Professor|Justice|Judge|Sir|Dame|Lord|Dr\.?|Mr\.?|Ms\.?|Coach)\s+/i, '').trim();
  if (noTitle !== guestName) namesToTry.push(noTitle);

  // "X Live From/at Y" → "X"
  const stripped = guestName.replace(/\s+(live\s+(?:from|at|with)|at\s+the)\b.*/i, '').trim();
  if (stripped && stripped !== guestName) namesToTry.push(stripped);

  // "X, Y, and Z" → "X" (first in comma-list)
  const beforeComma = guestName.split(/\s*,\s*/)[0].trim();
  if (beforeComma !== guestName) namesToTry.push(beforeComma);

  // "X and Y" → "X" (first person)
  const beforeAnd = guestName.replace(/\s+and\s+.+$/i, '').trim();
  if (beforeAnd !== guestName && beforeAnd !== stripped) namesToTry.push(beforeAnd);

  // Always try the original last
  namesToTry.push(guestName);

  // Dedupe preserving order
  const seen = new Set<string>();
  const deduped = namesToTry.filter(n => { if (seen.has(n)) return false; seen.add(n); return true; });

  // A REAL wall-clock cap across all variant attempts for one guest,
  // including each call's own internal 429 retry-wait — not just a check
  // between attempts. A guest whose name matches multiple stripping rules
  // above tries up to 5 variants sequentially; without threading this
  // deadline into wikiGet() itself, a between-attempts-only check couldn't
  // stop a single call from still waiting out an uncapped Retry-After, so
  // total time could exceed the intended budget by a full extra wait.
  // wikiGet() gives up early (throws, caught below) rather than waiting past
  // this deadline — one oddly-named guest can no longer stall a whole chunk
  // for minutes with no other guest able to make progress meanwhile.
  const RESOLVE_BUDGET_MS = 60_000;
  const resolveDeadline = Date.now() + RESOLVE_BUDGET_MS;

  for (const name of deduped) {
    if (Date.now() >= resolveDeadline) {
      // Distinguishes "gave up on remaining variants due to the time budget"
      // from a genuine "no matching Wikipedia entity" — both look identical
      // (null return) to the caller otherwise, with no way to tell how often
      // this actually fires versus a real not-found.
      console.log(`  Entity resolution budget (${RESOLVE_BUDGET_MS / 1000}s) exceeded for "${guestName}" — ${deduped.indexOf(name)}/${deduped.length} name variant(s) left untried.`);
      break;
    }

    // One Action API call gets title resolution + full plain-text extract +
    // disambiguation check together — down from the old two-call pattern (a
    // REST summary call for title/URL/disambiguation, then a separate Action
    // API call for the extract, because the REST summary's own `extract`
    // strips the "(born ...)" clause birth_year needs). Halving the request
    // count directly cuts how often a guest trips Wikipedia's rate limiter,
    // on top of being faster when it doesn't. wikiGet() already retries a
    // 429 internally using Wikipedia's real Retry-After header, so there's
    // no separate rate-limit handling needed here anymore.
    let entity: Awaited<ReturnType<typeof fetchWikiEntity>>;
    try {
      entity = await fetchWikiEntity(name, resolveDeadline);
    } catch {
      continue; // network error, exhausted retries, or deadline exceeded on this name variant — try next
    }
    if (!entity) continue;

    if (entity.isDisambiguation) {
      // Previously just skipped outright — a real, needless source of
      // needs_review for guests whose bare name collides with someone else's
      // (Leslie Jones, Tom Arnold, Richard Lewis, ...). Try to resolve which
      // linked candidate is actually this guest before giving up on this
      // name variant.
      const resolved = await resolveFromDisambiguation(name, guestName, resolveDeadline);
      if (resolved) return resolved;
      continue;
    }

    // fetchWikiEntity already returns the FULL article extract (not just the
    // lead), so this cap decides how much of it we actually use — bumped
    // from 1500 to 6000 chars to reach well past the intro into Career/
    // Personal life sections, where both a fuller known_for list and any
    // explicit Conan O'Brien / Team Coco mention are likely to live, not
    // just the opening paragraph.
    const intro = entity.extract.slice(0, 6000).trim();
    if (!intro) continue;

    const wikiTitle   = entity.title;
    const wikiUrl     = entity.url;
    const confidence  = scoreEntityMatch(guestName, wikiTitle, intro);

    return { name: wikiTitle, wikipedia_url: wikiUrl, intro, confidence };
  }
  return null;
}

export async function resolveEntityWithRetry(guestName: string): Promise<WikiEntity | null> {
  try {
    return await resolveEntity(guestName);
  } catch {
    return null;
  }
}

// ── Wikipedia-only extraction (no Claude) ─────────────────────────────────────

function extractProfessions(intro: string): string[] {
  // "X is an American actor, comedian and writer" → ["actor", "comedian", "writer"]
  const m = intro.match(/^[^.]+?\bis (?:an? |a )?(?:[A-Za-z-]+ )*?((?:actor|actress|comedian|writer|director|producer|musician|singer|author|host|journalist|chef|athlete|politician|stand-up)[^.]*)/i);
  if (!m) return [];
  return m[1]
    // Split on a comma, or "and" as a standalone word — not as a bare
    // substring. The old `(?:and|,)` matched "and" anywhere it appeared,
    // including inside a word like "Ireland", silently truncating it to
    // "Irel" (confirmed for real: Liam Neeson's "actor from Northern
    // Ireland" became "actor from northern irel").
    .split(/\s*,\s*|\s+and\s+/i)
    .map(s => s.trim().replace(/[^a-zA-Z -]/g, '').toLowerCase())
    .filter(s => /^[a-z]/.test(s) && s.length > 2)
    .slice(0, 3);
}

// Match "Title (year)" or "Title (year–year)" patterns common in Wikipedia intros
// Captures unquoted titles like "The Mindy Project (2012–2017)" and quoted ones.
// The negative lookahead excludes common sentence-initial pronouns as a match
// start — without it, a sentence like "He starred in Employee of the Month
// (2006)" captures the title as "He starred in Employee of the Month" instead
// of "Employee of the Month": the pattern's only start-of-match requirement was
// "not preceded by a word character" (true at both "He" and "Employee"), and
// since nothing shorter than the full clause reaches a "(" + digits, the
// non-greedy quantifier is forced to extend the match all the way from "He".
// Verified via a real test (extractKnownFor tests) that reproduced this exact
// failure before the lookahead was added.
// Excludes common sentence-initial words capitalized only by English
// convention (pronouns, demonstratives, transition/conjunction words) as a
// match-start — a punctuation-anchored requirement was tested and rejected:
// it breaks legitimate real titles preceded by a lowercase noun phrase (e.g.
// "...the television show Big Brother's Big Mouth (2004)" — "Big" is
// preceded by "show ", not punctuation, but is a real, correct title-start;
// the character class already can't start a match mid-lowercase-run, so
// punctuation-anchoring was solving a problem that didn't exist while
// breaking one that did). This blacklist targets the actual failure shape
// instead: a common word that's ONLY capitalized because it opens a
// sentence, not because it's part of a title.
const SENTENCE_OPENER_BLACKLIST = 'He|She|They|It|His|Her|Its|We|I|You|This|That|These|Those|Also|However|Meanwhile|During|After|Before|Since|While|Although|Additionally|Furthermore|Then|Later';
const TITLE_YEAR_RE = new RegExp(
  `[""]([^"""]{3,60})[""]|(?<!\\w)(?!(?:${SENTENCE_OPENER_BLACKLIST})\\b)([A-Z][A-Za-z0-9 ':!?&,-]{2,50}?)\\s+\\((\\d{4})(?:[–-]\\d{4}|[–-]present)?\\)`,
  'g'
);

export function extractKnownFor(intro: string): GuestBioWork[] {
  const works: GuestBioWork[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TITLE_YEAR_RE.source, 'g');
  while ((m = re.exec(intro)) !== null) {
    const title = (m[1] || m[2] || '').trim();
    const year  = m[3] || (() => {
      // For quoted titles, look for year nearby
      const around = intro.slice(Math.max(0, m!.index - 10), m!.index + title.length + 30);
      return around.match(/\b(19|20)\d{2}\b/)?.[0] || '';
    })();
    if (!title || title.length < 3 || /^(the|a|an|in|on|at|by|for|with|and|or)$/i.test(title)) continue;
    const ctx  = intro.slice(Math.max(0, m.index - 30), m.index + 60);
    const type: GuestBioWork['type'] = /film|movie/i.test(ctx) ? 'film'
      : /series|show|sitcom|drama|comedy series/i.test(ctx) ? 'tv'
      : /album|song|track/i.test(ctx) ? 'music' : 'tv';
    works.push({ title, type, year });
  }
  // No fixed cap — a well-established guest may have a dozen+ named works,
  // and the short intro text already bounds how many can realistically match.
  return works.filter((w, i, arr) => arr.findIndex(x => x.title === w.title) === i);
}

export function extractRecentWork(intro: string): GuestBioWork[] {
  const works: GuestBioWork[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TITLE_YEAR_RE.source, 'g');
  while ((m = re.exec(intro)) !== null) {
    const title = (m[1] || m[2] || '').trim();
    const year  = m[3] || (() => {
      const around = intro.slice(Math.max(0, m!.index - 10), m!.index + title.length + 30);
      return around.match(/\b(20(2[4-9]|[3-9]\d))\b/)?.[0] || '';
    })();
    if (!year || parseInt(year) < RECENT_WORK_CUTOFF_YEAR) continue;
    if (!title || title.length < 3) continue;
    const ctx  = intro.slice(Math.max(0, m.index - 30), m.index + 60);
    const type: GuestBioWork['type'] = /film|movie/i.test(ctx) ? 'film'
      : /series|show|sitcom|drama/i.test(ctx) ? 'tv'
      : /album|song/i.test(ctx) ? 'music' : 'tv';
    works.push({ title, type, year });
  }
  return works
    .filter((w, i, arr) => arr.findIndex(x => x.title === w.title) === i)
    .slice(0, 4);
}

// "(born March 5, 1975)" (US), "(born 5 March 1975)" (UK/international), or
// "(born 1975)" → "1975". Wikipedia uses day-month-year with no comma for most
// non-US subjects, so both orderings matter — this is exactly the international-
// guest case the nationality field most needs to work for.
export function extractBirthYear(intro: string): string {
  const m = intro.match(/\(born(?:\s+(?:[A-Z][a-z]+\s+\d{1,2},|\d{1,2}\s+[A-Z][a-z]+))?\s+(\d{4})\)/);
  return m ? m[1] : '';
}

// "X is an American actor" / "X is a British actor and singer" → "American" / "British"
export function extractNationality(intro: string): string {
  const m = intro.match(/\bis (?:an?|the) ([A-Z][a-z]+)\b(?=[^.]*\b(?:actor|actress|comedian|writer|director|producer|musician|singer|author|host|journalist|chef|athlete|politician|stand-up)\b)/);
  return m ? m[1] : '';
}

// Explicit "died [Month Day,] YYYY" wording, or the common "(born ... – died
// ...)" / date-range parenthetical right after the subject's name (e.g.
// "(March 5, 1930 – April 12, 2010)" or "(1930–2010)"). Empty means living
// or no death date stated — never inferred from tense.
export function extractDeathYear(intro: string): string {
  const died = intro.match(/\bdied\s+(?:[A-Z][a-z]+\s+\d{1,2},\s+)?(\d{4})\b/);
  if (died) return died[1];
  const range = intro.match(/\((?:[A-Z][a-z]+\s+\d{1,2},\s+)?(\d{4})\s*[–-]\s*(?:[A-Z][a-z]+\s+\d{1,2},\s+)?(\d{4})\)/);
  return range ? range[2] : '';
}

// Best-effort: count standalone he/him/his vs she/her/hers pronouns in the
// intro and take whichever is used. Only the Claude pipeline's version of
// this (which reads the actual stated pronoun, not a frequency count) should
// be trusted for anything but a rough fallback signal.
export function extractGender(intro: string): string {
  const male   = (intro.match(/\b(he|him|his)\b/gi) || []).length;
  const female = (intro.match(/\b(she|her|hers)\b/gi) || []).length;
  if (male === 0 && female === 0) return '';
  return male >= female ? 'male' : 'female';
}

function buildDescription(intro: string, guestName: string, conanEvidence: string, conanType: string): string {
  // Take first 1-2 sentences of Wikipedia intro (the "who they are" bit)
  const sentences = intro.split(/(?<=[.!?])\s+/);
  const keepSentences: string[] = [];
  let wordCount = 0;
  for (const s of sentences) {
    const wc = s.split(/\s+/).length;
    if (wordCount + wc > 90) break;
    keepSentences.push(s);
    wordCount += wc;
  }

  let base = keepSentences.join(' ').trim();
  // Scrub "[1]"-style citation markers
  base = base.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();

  // Append Conan connection if not already implied
  const connText = conanType === 'inferred'
    ? ` ${conanEvidence}`
    : ` ${conanEvidence}`;

  const combined = base.endsWith('.') ? `${base}${connText}` : `${base}. ${connText.trim()}`;
  // Hard-trim to ~130 words
  const words = combined.split(/\s+/);
  return words.length > 130 ? words.slice(0, 128).join(' ') + '…' : combined;
}

// ── Conan connection ──────────────────────────────────────────────────────────

interface ConanConnection { type: 'direct' | 'industry' | 'inferred'; evidence: string }

const SHOW_NAMES: Record<string, string> = {
  'late-night-nbc': "Late Night with Conan O'Brien",
  'tonight-show': "The Tonight Show with Conan O'Brien",
  'tbs-conan': 'Conan',
  'podcast': "Conan O'Brien Needs a Friend",
  'conan-must-go': "Conan O'Brien Must Go",
};

function buildConanConnection(guest: Guest): ConanConnection {
  const ot = guest.origin.type;
  const ol = guest.origin.label;

  // Always anchor on the real earliest appearance (correct show + year), never a
  // hardcoded show. For known SNL/Lampoon/peer connections, lead with that context.
  const first = [...guest.appearances].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )[0];
  const year = first ? new Date(first.date).getFullYear() : null;
  const firstLine =
    first && year ? `First appeared on ${SHOW_NAMES[first.era] ?? "Conan's show"} in ${year}.` : '';

  if (ot === 'snl-simpsons' || ot === 'harvard-lampoon') {
    return { type: 'direct', evidence: `${ol.replace(/\.$/, '')}. ${firstLine}`.trim() };
  }
  if (ot === 'comedy-peer' || ot === 'second-degree') {
    return { type: 'industry', evidence: `${ol.replace(/\.$/, '')}. ${firstLine}`.trim() };
  }
  return { type: 'inferred', evidence: firstLine || "Appeared on Conan's shows." };
}

// ── Claude pipeline ───────────────────────────────────────────────────────────

// Static across every guest in every run — marked with cache_control so
// Anthropic serves it from cache (~90% cheaper than a fresh input token)
// on every call after the first within the cache TTL. Previously this same
// rules text (plus a near-duplicate synthesis-only system prompt) was paid
// for in full, twice, per guest, across two separate Sonnet calls.
const EXTRACTION_SYSTEM_PROMPT = `Extract structured biographical data from a Wikipedia intro AND write a tight editorial bio paragraph from that same data, in one JSON response. Output valid JSON only. No markdown.

Return JSON:
{
  "profession": [],
  "known_for": [{"title":"","type":"film|tv|music|podcast|other","year":""}],
  "recent_work": [],
  "upcoming_work": [{"title":"","type":"film|tv|music|podcast|other","year":""}],
  "birth_year": "",
  "death_year": "",
  "gender": "",
  "nationality": "",
  "prestige_signals": [],
  "primary_platform": "film|tv|music|streaming|podcast|sports|other",
  "conan_mentions": [],
  "description": ""
}
Rules:
- known_for: ALL notable works named in the intro, across ANY medium (film, TV,
  music/albums, podcasts) — this is used to find connections between guests who
  worked on the same project or in the same band, so don't limit to acting
  credits alone. No fixed cap — a well-established guest may have a dozen or
  more; list every one actually named in the text, never invent or pad the list
- recent_work: year >= RECENT_WORK_CUTOFF_YEAR (given per-request below) only,
  empty array if none
- upcoming_work: work explicitly described as upcoming/announced/forthcoming in
  the intro (e.g. "is set to star in", "an upcoming album"), with a year if one
  is stated; empty array if the intro doesn't mention anything upcoming — this
  will be sparse, never infer or guess a future project
- year: 4-digit string or ""
${BOOKING_SIGNAL_RULES}
- conan_mentions: verbatim sentence(s) or clauses from the text that explicitly
  name Conan O'Brien, "Team Coco", or one of his shows/podcast by name (Late
  Night with Conan O'Brien, The Tonight Show with Conan O'Brien, Conan, Conan
  O'Brien Needs a Friend, Conan O'Brien Must Go) — quote the text exactly,
  don't paraphrase; empty array if the text never mentions him by name, even
  if the guest is known to have appeared on his shows
- description: 80–120 words, one paragraph, neutral editorial tone, no hype.
  Built ONLY from the profession/known_for/recent_work facts you just
  extracted above plus the given Conan connection — no new claims, nothing
  not grounded in those fields. For how to handle the Conan connection: if
  conan_mentions is non-empty, state that connection directly and naturally
  (you may paraphrase the mention, but don't invent detail beyond it); if
  conan_mentions is empty, use the given Conan connection below, and if its
  type is "inferred", use tentative language ("likely crossed paths with...",
  not a flat assertion). Plain prose only — never wrap a title in asterisks
  or any other markdown emphasis (confirmed a real, widespread issue: 216
  guests' descriptions came back with Wikipedia's *Title* italics carried
  straight through, and the frontend renders this field as plain text, so
  the literal asterisks showed up on the page). A title's own name may
  itself contain an asterisk (e.g. M*A*S*H) — leave that character alone,
  just don't ADD asterisks around a title that doesn't already have them.`;

export async function runClaudePipeline(
  client: any,
  guest: Guest,
  entity: WikiEntity,
  conanConn: ConanConnection,
  model: string
): Promise<GuestBio | null> {
  const today = new Date().toISOString().slice(0, 10);

  const msg = await client.messages.create({
    model,
    // known_for is uncapped ("ALL notable works") — a truly prolific guest's
    // list alone can approach 1000+ tokens, plus ~150-200 for the description
    // now folded into the same response. A response cut off mid-JSON fails
    // JSON.parse below and silently falls back to the weaker wiki-only
    // pipeline for exactly the well-established guests this was meant to
    // help most. 2800 gives real headroom without inflating cost for a
    // typical guest — max_tokens is a cap, Claude only generates what the
    // response actually needs.
    max_tokens: 2800,
    system: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: `Today: ${today}
RECENT_WORK_CUTOFF_YEAR: ${RECENT_WORK_CUTOFF_YEAR}
Guest: ${guest.name}
Given Conan connection (${conanConn.type}): ${conanConn.evidence}
Wikipedia intro:
${entity.intro}`,
    }],
  });

  let structured: any;
  try {
    structured = JSON.parse(msg.content[0].text.trim());
  } catch { return null; }

  // Wikipedia's own text explicitly naming Conan/Team Coco/a named show is
  // stronger, real evidence than our origin-based inference (which never
  // reads the article at all) — upgrade to 'direct' when present, quoting
  // the article rather than guessing. Falls back to the passed-in
  // origin-based connection when the intro never mentions him by name.
  const conanMentions: string[] = Array.isArray(structured.conan_mentions) ? structured.conan_mentions : [];
  const effectiveConanConn: ConanConnection = conanMentions.length > 0
    ? { type: 'direct', evidence: `Wikipedia: "${conanMentions[0]}"` }
    : conanConn;

  const description = (structured.description || '').trim();
  const wordCount = description.split(/\s+/).length;
  if (wordCount < 60 || wordCount > 150) return null;

  // Now that known_for is uncapped ("ALL notable works"), a title showing up
  // in both lists is the expected case whenever someone's most recent work
  // is also their most notable — not the extraction error it used to signal
  // back when known_for was a top-6 cut. Filter it out of recent_work here
  // (known_for already covers it) rather than reject the whole bio over it.
  const known_for = structured.known_for || [];
  const knownForTitles = new Set(known_for.map((w: any) => w.title?.toLowerCase()));
  const recent_work = (structured.recent_work || [])
    .filter((w: any) => !knownForTitles.has(w.title?.toLowerCase()))
    .slice(0, 4);

  // Claude extracts "upcoming" straight from Wikipedia's own wording ("is set
  // to star in...") without weighing whether that framing is still current —
  // Wikipedia prose describing a 2025 project as upcoming doesn't get
  // re-edited the moment the year turns, so by the time this runs in 2026
  // the same true, once-current sentence produces a now-stale entry. That's
  // real-world drift, not a bad extraction: everything else about the bio
  // (profession, known_for, description) is still correct. validate()
  // rejects the WHOLE bio over a single stale upcoming_work entry — real
  // guests this hit (Samuel L. Jackson, Russell Crowe, Vera Farmiga, ...)
  // are otherwise perfectly fine, high-confidence matches. Drop only the
  // stale entries here, mirroring the recent_work/known_for de-dup above,
  // so a merely-outdated "upcoming" claim doesn't cost the guest their bio.
  const upcoming_work = (structured.upcoming_work || [])
    .filter((w: any) => !w.year || parseInt(w.year) >= CURRENT_YEAR)
    .slice(0, 3);

  return {
    entity:           { name: entity.name, wikipedia_url: entity.wikipedia_url, confidence: entity.confidence },
    profession:       structured.profession || [],
    known_for,
    recent_work,
    conan_connection: effectiveConanConn,
    description,
    confidence:       entity.confidence,
    needs_review:     false,
    sources:          [entity.wikipedia_url],
    enrichedAt:       new Date().toISOString(),
    birth_year:       structured.birth_year || '',
    death_year:       structured.death_year || '',
    gender:           structured.gender || '',
    nationality:      structured.nationality || '',
    prestige_signals: structured.prestige_signals || [],
    primary_platform: structured.primary_platform || undefined,
    upcoming_work,
  };
}

// ── Wikipedia-only pipeline ───────────────────────────────────────────────────

// Same idea as the Claude pipeline's conan_mentions field, regex-only for
// the free fallback path: find the sentence containing an explicit mention
// of Conan O'Brien, Team Coco, or one of his named shows, and use it as
// direct evidence instead of the origin-based inference.
const CONAN_MENTION_RE = /\b(Conan O'?Brien|Team Coco|Late Night with Conan O'?Brien|The Tonight Show with Conan O'?Brien|Conan O'?Brien Needs a Friend|Conan O'?Brien Must Go)\b/i;

function extractConanMention(intro: string): ConanConnection | null {
  const sentences = intro.split(/(?<=[.!?])\s+/);
  const hit = sentences.find(s => CONAN_MENTION_RE.test(s));
  return hit ? { type: 'direct', evidence: `Wikipedia: "${hit.trim()}"` } : null;
}

function runWikiPipeline(guest: Guest, entity: WikiEntity, conanConn: ConanConnection): GuestBio {
  const profession = extractProfessions(entity.intro);
  const known_for  = extractKnownFor(entity.intro);
  // Same dedupe as the Claude pipeline: known_for already covers a title, so
  // drop it from recent_work rather than show it twice.
  const knownForTitles = new Set(known_for.map(w => w.title.toLowerCase()));
  const recent_work = extractRecentWork(entity.intro)
    .filter(w => !knownForTitles.has(w.title.toLowerCase()));
  const effectiveConanConn = extractConanMention(entity.intro) ?? conanConn;
  const description = buildDescription(entity.intro, guest.name, effectiveConanConn.evidence, effectiveConanConn.type);

  const wordCount = description.split(/\s+/).length;
  const needs_review = wordCount < 20 || wordCount > 160;

  return {
    entity:           { name: entity.name, wikipedia_url: entity.wikipedia_url, confidence: entity.confidence },
    profession,
    known_for,
    recent_work,
    conan_connection: effectiveConanConn,
    description,
    confidence:       entity.confidence,
    needs_review,
    sources:          [entity.wikipedia_url],
    enrichedAt:       new Date().toISOString(),
    birth_year:       extractBirthYear(entity.intro),
    death_year:       extractDeathYear(entity.intro),
    gender:           extractGender(entity.intro),
    nationality:      extractNationality(entity.intro),
    // Regex can't reliably tell "awards mentioned" from "no awards" or judge a
    // primary medium — leave these to the Claude pipeline rather than guess.
    prestige_signals: [],
  };
}

// ── Total-failure guard ──────────────────────────────────────────────────────

// Extracted as a pure predicate so this real-money-safety logic is unit-
// testable, not just verified by reading the code — an independent review
// found the specific failure mode this guards against: a chunk where every
// guest fails (broken credential, Anthropic outage) writes nothing new to
// bios.json, which the chunked workflow's "no changes staged = backlog
// exhausted" check can't distinguish from a genuinely finished backlog.
export function isTotalChunkFailure(claudeEnabled: boolean, queueLength: number, failedCount: number): boolean {
  return claudeEnabled && queueLength > 0 && failedCount === queueLength;
}

// ── Queue filter ─────────────────────────────────────────────────────────────

// Pure decision function extracted out of main()'s filter specifically so
// the real-dollar-stakes --new-only logic (see its definition above) is
// unit-testable rather than only verified by an offline script. Handles
// only the "does this guest's EXISTING bio state mean re-enrich" decision —
// the --guest/--force debug short-circuits stay inline in main() since
// they're trivial and don't carry the same risk.
export function shouldEnqueueGuest(
  existing: GuestBio | undefined,
  opts: { retryReview: boolean; newOnly: boolean; now: number; ttlMs: number }
): boolean {
  if (!existing) return true;
  // --retry-review re-attempts needs_review entries (usually rate-limited)
  if (existing.needs_review) return opts.retryReview;
  if (opts.newOnly) return false;
  return opts.now - new Date(existing.enrichedAt).getTime() > opts.ttlMs;
}

// A guest with no bios.json entry at all (enrichedAt undefined -> '') sorts
// before any needs_review guest with a real timestamp, since '' < any ISO
// string. Among needs_review guests, oldest-attempted-first — so a guest
// that just failed this run naturally falls to the back of next run's
// queue instead of never letting a never-attempted guest get a turn. Pure
// and stable-sort (no in-place mutation of the input array) so it's
// directly unit-testable without a filesystem fixture.
export function sortByEnrichmentPriority(guests: Guest[], bios: Record<string, GuestBio>): Guest[] {
  return [...guests].sort((a, b) => {
    const ta = bios[a.name]?.enrichedAt ?? '';
    const tb = bios[b.name]?.enrichedAt ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validate(bio: GuestBio): { ok: boolean; reason?: string } {
  const words = bio.description.split(/\s+/).length;
  if (words < 20 || words > 160) return { ok: false, reason: `word_count:${words}` };

  for (const w of bio.recent_work) {
    if (w.year && parseInt(w.year) < RECENT_WORK_CUTOFF_YEAR)
      return { ok: false, reason: `stale_recent_work:${w.title}(${w.year})` };
  }

  // "Upcoming" work with a year already in the past means the model treated a
  // since-released project as still forthcoming — stale, not a real signal.
  for (const w of bio.upcoming_work ?? []) {
    if (w.year && parseInt(w.year) < CURRENT_YEAR)
      return { ok: false, reason: `stale_upcoming_work:${w.title}(${w.year})` };
  }

  // death_year is the highest-stakes field this pipeline writes — wrongly
  // marking a living person as deceased is about as bad an accuracy failure
  // as this can produce. Confirmed via a real A/B test against
  // claude-haiku-4-5-20251001: it fabricated a death_year for 4 of 5 real,
  // living guests, misreading an unrelated in-text year (most often a
  // career-span end-year like "Reno 911! (2003–2009)") as a death date —
  // and 2 of those 4 also failed to extract a plainly-stated birth_year in
  // the same response. Shared with backfill-booking-signals.ts's identical
  // check so the two call sites can't drift out of agreement.
  const deathYearCheck = checkDeathYearPlausibility(bio.birth_year ?? '', bio.death_year ?? '', CURRENT_YEAR);
  if (!deathYearCheck.ok) return deathYearCheck;

  return { ok: true };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Attempt to load Claude client (optional)
  let claudeClient: any = null;
  if (!WIKI_ONLY) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        claudeClient = new Anthropic({ apiKey });
        // Quick smoke-test to verify credits — skippable via env var because
        // a chunked backfill workflow spawns a FRESH node process per chunk
        // (up to ~58 times across the full ~2,900-guest backlog at 50/chunk),
        // so without this flag the same smoke-test round-trip pays its
        // latency cost on every single chunk instead of once per run. The
        // caller (backfill-full-bios.yml) verifies once before the chunk
        // loop starts, then sets SKIP_CLAUDE_SMOKE_TEST for every subsequent
        // chunk. Unset/empty (any run invoked directly, e.g. --guest
        // debugging) still verifies every time, same as before.
        if (!process.env.SKIP_CLAUDE_SMOKE_TEST) {
          await claudeClient.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'hi' }],
          });
        }
        console.log(`[Bios] Claude available — using full pipeline (model: ${MODEL})\n`);
      } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('credit') || msg.includes('balance') || msg.includes('quota')) {
          console.warn('[Bios] Claude unavailable (no credits) — falling back to wiki-only mode\n');
          claudeClient = null;
        } else {
          console.warn(`[Bios] Claude error (${msg.slice(0, 60)}) — falling back to wiki-only\n`);
          claudeClient = null;
        }
      }
    } else {
      console.warn('[Bios] No ANTHROPIC_API_KEY — using wiki-only mode\n');
    }
  } else {
    console.log('[Bios] Wiki-only mode (--wiki-only flag)\n');
  }

  const guestsData = readJson<{ guests: Guest[] }>(DATA_FILE, { guests: [] });
  const bios       = readJson<Record<string, GuestBio>>(BIOS_FILE, {});
  const now        = Date.now();

  let queue = guestsData.guests.filter(g => {
    if (ONLY) return g.name.toLowerCase() === ONLY.toLowerCase();
    if (FORCE) return true;
    return shouldEnqueueGuest(bios[g.name], { retryReview: RETRY_REVIEW, newOnly: NEW_ONLY, now, ttlMs: TTL_MS });
  });

  // Without this, queue.slice(0, LIMIT) below always took data/guests.json's
  // raw array order — so a needs_review guest positioned early in that
  // array got retried every single --retry-review run, while any guest
  // positioned after the run's --limit was NEVER reached, no matter how
  // many times the workflow ran that day. Confirmed as the real cause
  // behind 234 of 281 remaining needs_review guests never getting a single
  // fresh attempt across two full --retry-review runs in one day — not a
  // different workflow or a cost problem, pure queue starvation. Sorting
  // never-attempted guests (no bios.json entry at all) first, then
  // needs_review guests oldest-enrichedAt-first, means a guest that just
  // failed goes to the BACK of the queue next run instead of permanently
  // crowding out guests nobody has tried yet.
  queue = sortByEnrichmentPriority(queue, bios);

  if (queue.length === 0) {
    console.log('[Bios] All guests up-to-date.');
    // Distinct from a normal 0-exit ("ran and did work") — callers that loop
    // chunks (backfill-full-bios.yml) need to tell "nothing left to enqueue"
    // apart from "ran fine." Without this, the loop's own git-diff check was
    // the only signal, and patch-bios-into-guests.ts unconditionally bumps
    // data/guests.json's generatedAt on every call, so that diff was never
    // empty even with zero real work — the loop ran to its full requested
    // limit instead of stopping once the backlog was actually exhausted.
    // Callers that don't care (weekly-ingest.yml's step has
    // continue-on-error: true; sample-bio-enrichment.yml already tolerates
    // any nonzero exit) are unaffected.
    process.exit(2);
  }

  queue = queue.slice(0, LIMIT);
  const mode = claudeClient ? 'Claude+Wikipedia' : 'Wikipedia-only';
  console.log(`[Bios] Enriching ${queue.length} guests via ${mode} (concurrency: ${CONCURRENCY})\n`);

  let success = 0, reviewNeeded = 0, failed = 0, completed = 0;

  async function processGuest(guest: Guest, i: number): Promise<void> {
    const tag = `[${i + 1}/${queue.length}]`;

    try {
      // Entity resolution
      const entity = await resolveEntityWithRetry(guest.name);

      // --guest is single-name debugging/sampling mode — cheap to also show the
      // exact source text the extraction step worked from, since "why didn't
      // field X get extracted" always starts with "was it even in the text".
      if (ONLY && entity) {
        console.log(`${tag} [debug] Wikipedia intro used for ${entity.name}:\n  "${entity.intro}"\n`);
      }

      // A tiny epsilon so a genuinely-at-threshold score (0.5 overlap + 0.3
      // bio signal = 0.65 exactly) isn't rejected over float representation
      // error (0.5 * 0.7 computes as 0.6499999999999999 in JS) — confirmed
      // this was silently rejecting real, correctly-resolved guests (BJ
      // Novak, JJ Abrams) whose overlap score legitimately equals 0.65.
      if (!entity || entity.confidence < MIN_ENTITY_CONFIDENCE - 1e-9) {
        const conf = entity?.confidence?.toFixed(2) ?? 'none';
        bios[guest.name] = {
          entity:           entity
            ? { name: entity.name, wikipedia_url: entity.wikipedia_url, confidence: entity.confidence }
            : { name: guest.name, wikipedia_url: '', confidence: 0 },
          profession:       [],
          known_for:        [],
          recent_work:      [],
          conan_connection: buildConanConnection(guest),
          description:      '',
          confidence:       entity?.confidence ?? 0,
          needs_review:     true,
          sources:          [],
          enrichedAt:       new Date().toISOString(),
        };
        console.log(`${tag} ${guest.name} ... needs_review (entity confidence: ${conf})`);
        reviewNeeded++;
        await sleep(200);
        return;
      }

      const conanConn = buildConanConnection(guest);
      let bio: GuestBio | null = null;

      if (claudeClient) {
        bio = await runClaudePipeline(claudeClient, guest, entity, conanConn, MODEL);
        if (!bio) {
          // Fallback to wiki-only if Claude fails
          bio = runWikiPipeline(guest, entity, conanConn);
        }
      } else {
        bio = runWikiPipeline(guest, entity, conanConn);
      }

      const check = validate(bio);
      if (!check.ok) {
        bio.needs_review = true;
        console.log(`${tag} ${guest.name} ... needs_review (${check.reason})`);
        reviewNeeded++;
      } else {
        const words = bio.description.split(/\s+/).length;
        const src   = claudeClient ? 'claude' : 'wiki';
        console.log(`${tag} ${guest.name} ... ✓ (${words}w, conf ${bio.confidence.toFixed(2)}, ${src})`);
        success++;
      }

      bios[guest.name] = bio;

    } catch (err: any) {
      console.log(`${tag} ${guest.name} ... error: ${err.message?.slice(0, 80)}`);
      failed++;
    }

    // Was 5000ms, then 1000ms — the 1000ms figure was sized for a 2-Claude-
    // call-per-guest pipeline that no longer exists (now 1 call). Wikipedia's
    // real rate-limit backoff (wikiGet's own, honoring the actual Retry-After
    // header) is what actually protects against 429s, not this flat sleep —
    // confirmed working on its own in an earlier validation run (six 429s
    // correctly retried). 400ms is still a real, deliberate pause per worker
    // slot between its own guests — with CONCURRENCY workers each pacing
    // themselves this way, the aggregate request rate scales with
    // concurrency while each individual worker still spaces its own calls out.
    await sleep(400);
  }

  // Bounded concurrency: CONCURRENCY workers pull from a single shared index
  // instead of processing strictly one guest at a time. This is primarily a
  // wall-clock optimization (overlapping network waits) — token/dollar cost
  // is unchanged for the STEADY STATE of a chunk, but not perfectly free at
  // chunk start: an independent review caught that the first wave of up to
  // CONCURRENCY requests can all miss the not-yet-written prompt cache and
  // each pay the cache-write premium instead of a cache read. Real but
  // small and bounded (at most CONCURRENCY extra cache-writes per chunk, not
  // per guest) — not worth staggering worker startup to avoid. Node is
  // single-threaded, so the shared `nextIndex`/`completed` counters and the
  // `bios` object are safe to mutate directly between `await` points — no
  // lock needed. Checkpoint writes trigger on COMPLETION count, not start
  // index, so they're still meaningful under out-of-order completion.
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < queue.length) {
      const i = nextIndex++;
      await processGuest(queue[i], i);
      completed++;
      if (completed % 10 === 0) fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`✓ Success:      ${success}`);
  console.log(`⚠ Needs review: ${reviewNeeded}`);
  console.log(`✗ Failed:       ${failed}`);
  console.log(`Cached:         ${Object.keys(bios).length} guests`);

  // A real finding from an independent review of this pipeline: a chunk
  // where every single guest fails (e.g. a Claude credential that breaks
  // mid-run — revoked key, org spend cap hit) writes nothing new to
  // bios.json. The chunked workflow's own "no changes staged = backlog
  // exhausted, stop cleanly" check can't tell that apart from a genuinely
  // finished backlog — it would print "Done" and exit 0 as if the run
  // completed, when what actually happened is every guest in this chunk was
  // silently dropped. Fail loudly instead: a real credential/API break
  // should always be visible, never look identical to a successful,
  // deliberate stop.
  if (isTotalChunkFailure(!!claudeClient, queue.length, failed)) {
    console.error(`\n[Bios] FATAL: every guest in this chunk (${failed}/${queue.length}) failed — this looks like a broken Claude credential or an Anthropic API outage, not a normal per-guest failure rate. Stopping loudly rather than letting this look like a completed run.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
