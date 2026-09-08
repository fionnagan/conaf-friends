/**
 * match-personal-crossed-paths.ts
 * A third strand of the "Crossed Paths" idea, alongside fetch-conan-activity.ts
 * (his own credited work) and fetch-crossed-paths.ts (film/soundtrack cast
 * cross-referencing): personal/social overlaps that never show up in
 * Wikipedia's structured data at all — e.g. Taylor Swift inviting Conan to
 * her wedding. That kind of event only exists in entertainment press, not
 * an encyclopedia, so this scans the same trade-press corpus
 * fetch-trade-press.ts already pulls (scripts/cache/trade-press.json) for
 * mentions of Conan O'Brien himself, then asks Claude to tell a genuine
 * personal/social crossed-paths event (an invitation, a public appearance
 * together, a personal interaction) apart from ordinary career news about
 * Conan (hosting the Oscars, a new project — already covered by
 * fetch-conan-activity.ts and not what this script is for).
 *
 * This is a real step down in confidence from the Wikipedia-sourced steps:
 * trade press is noisier, and "personal event" is a judgment call rather
 * than a structural fact — which is why every candidate goes through a
 * Claude confirmation pass (same two-step pattern as match-upcoming-work.ts)
 * rather than a raw keyword hit standing on its own.
 *
 * Usage:
 *   npx tsx scripts/ingest/match-personal-crossed-paths.ts
 * Reads scripts/cache/trade-press.json (run fetch-trade-press.ts first)
 * Writes scripts/cache/personal-crossed-paths.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCache, writeCache, normalizeGuestName, sleep } from './utils';
import type { TradePressArticle } from './fetch-trade-press';
import type { Guest } from '../../lib/types';

const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');
// Full name required, not just "Conan" — his first name alone collides with
// Conan the Barbarian, Conan Exiles, Conan Gray, etc. in entertainment press.
const CONAN_MENTION_RE = /conan o'?brien/i;

interface PersonalCrossedPath {
  otherPersonName: string;
  description: string;
  source: string;
  sourceUrl: string;
  matchedGuestId: string | null;
  matchedGuestName: string | null;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

async function extractPersonalConnection(client: any, article: TradePressArticle) {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: 'Output valid JSON only. No markdown.',
    messages: [{
      role: 'user',
      content: `Article title: ${article.title}
Article snippet: ${article.snippet}
Source: ${article.source}

Does this article describe a genuine PERSONAL or SOCIAL crossed-paths event
between Conan O'Brien and one other SPECIFIC named person — e.g. an
invitation (a wedding, a party), a public appearance together, a personal
interaction reported as news? This is NOT Conan's own separate career news
(hosting a show, a new project, an interview only about him) — that's
tracked elsewhere. It is also NOT a passing mention of his name with no
described interaction.

Return JSON:
{ "is_personal_crossed_path": false, "otherPersonName": "", "description": "" }

Rules:
- is_personal_crossed_path: true only if a specific other named person and a
  specific social/personal event connecting them to Conan are both stated
- otherPersonName: that person's full name, exactly as the article gives it
- description: one short sentence describing the connection, in your own words
- Never infer or guess an event that isn't explicitly described`,
    }],
  });

  try {
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return null;
  }
}

async function main() {
  const articles = readCache<TradePressArticle[]>('trade-press.json') ?? [];
  if (articles.length === 0) {
    console.log('No scripts/cache/trade-press.json — run fetch-trade-press.ts first.');
    return;
  }

  const conanArticles = articles.filter((a) => CONAN_MENTION_RE.test(`${a.title} ${a.snippet}`));
  console.log(`${conanArticles.length} of ${articles.length} article(s) mention Conan O'Brien by name.\n`);
  if (conanArticles.length === 0) {
    writeCache('personal-crossed-paths.json', { generatedAt: new Date().toISOString(), results: [] });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY — cannot confirm personal crossed-paths. Set it and re-run.');
    process.exit(1);
  }

  const guestsData = readJson<{ guests: Guest[] }>(DATA_FILE, { guests: [] });
  const guestByName = new Map<string, Guest>();
  for (const guest of guestsData.guests) {
    guestByName.set(normalizeGuestName(guest.name).toLowerCase(), guest);
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const results: PersonalCrossedPath[] = [];

  for (const article of conanArticles) {
    process.stdout.write(`  "${article.title.slice(0, 70)}..." (${article.source}) ... `);
    const extracted = await extractPersonalConnection(client, article);
    if (!extracted || !extracted.is_personal_crossed_path || !extracted.otherPersonName) {
      console.log('not a personal crossed-path');
      await sleep(300);
      continue;
    }

    const matched = guestByName.get(normalizeGuestName(extracted.otherPersonName).toLowerCase()) ?? null;
    console.log(`✓ ${extracted.otherPersonName}${matched ? ` (existing guest: ${matched.name})` : ' (new candidate)'}`);
    results.push({
      otherPersonName: extracted.otherPersonName,
      description: extracted.description ?? '',
      source: article.source,
      sourceUrl: article.link,
      matchedGuestId: matched?.id ?? null,
      matchedGuestName: matched?.name ?? null,
    });
    await sleep(300);
  }

  const existingGuestHits = results.filter((r) => r.matchedGuestId !== null);
  const newCandidates = results.filter((r) => r.matchedGuestId === null);

  console.log(`\n=== ${existingGuestHits.length} personal crossed path(s) with existing guests ===`);
  for (const hit of existingGuestHits) {
    console.log(`  ${hit.matchedGuestName} — ${hit.description} (${hit.source})`);
  }

  console.log(`\n=== ${newCandidates.length} new candidate(s), never booked ===`);
  for (const candidate of newCandidates) {
    console.log(`  ${candidate.otherPersonName} — ${candidate.description} (${candidate.source})`);
  }

  writeCache('personal-crossed-paths.json', { generatedAt: new Date().toISOString(), results });
  console.log('\nWrote scripts/cache/personal-crossed-paths.json');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
