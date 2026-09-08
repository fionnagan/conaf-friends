/**
 * match-upcoming-work.ts
 * Matches trade-press articles (scripts/cache/trade-press.json) against the
 * full guest list, then asks Claude to confirm + extract "upcoming work" only
 * for candidates that pass a two-signal bar: a full-name match AND contextual
 * corroboration (a profession word or a known known_for title in the same
 * article). Last-name-only or context-free matches are discarded outright —
 * this is meant to be a trustworthy signal for a booker, not a noisy guess.
 *
 * This is the VALIDATION step — it does NOT write into data/guests.json or
 * scripts/cache/bios.json. Results go to scripts/cache/upcoming-work-
 * candidates.json for review before any production merge step is built.
 *
 * Usage:
 *   npx tsx scripts/ingest/match-upcoming-work.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCache, writeCache } from './utils';
import type { TradePressArticle } from './fetch-trade-press';
import type { Guest, GuestBio } from '../../lib/types';

const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');
const BIOS_FILE = path.join(process.cwd(), 'scripts', 'cache', 'bios.json');
const CURRENT_YEAR = new Date().getFullYear();

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

interface Candidate {
  guestName: string;
  matchedContext: string;
  article: TradePressArticle;
}

function findCandidates(guests: Guest[], bios: Record<string, GuestBio>, articles: TradePressArticle[]): Candidate[] {
  const candidates: Candidate[] = [];

  for (const article of articles) {
    const text = `${article.title} ${article.snippet}`;
    const textLower = text.toLowerCase();

    for (const guest of guests) {
      const nameLower = guest.name.toLowerCase();
      // Require a real multi-word name match, not a single common first/last name.
      if (nameLower.split(/\s+/).length < 2) continue;
      if (!textLower.includes(nameLower)) continue;

      const bio = bios[guest.name];
      const professionWords = bio?.profession ?? [];
      const knownForTitles = (bio?.known_for ?? []).map((w) => w.title);

      const contextHit =
        professionWords.find((p) => textLower.includes(p.toLowerCase())) ??
        knownForTitles.find((t) => t && textLower.includes(t.toLowerCase()));

      if (!contextHit) continue; // name-only match — discard, too noisy

      candidates.push({ guestName: guest.name, matchedContext: contextHit, article });
    }
  }

  return candidates;
}

async function extractUpcomingWork(client: any, candidate: Candidate) {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `Output valid JSON only. No markdown. Today: ${new Date().toISOString().slice(0, 10)}.`,
    messages: [{
      role: 'user',
      content: `Article title: ${candidate.article.title}
Article snippet: ${candidate.article.snippet}
Source: ${candidate.article.source}
Guest this article was matched to: ${candidate.guestName}

Does this article describe an UPCOMING/forthcoming/announced project (not
already-released work) specifically involving ${candidate.guestName}?

Return JSON:
{ "is_upcoming": false, "title": "", "type": "film|tv|music|podcast|other", "year": "" }

Rules:
- is_upcoming: true only if the project is explicitly future/announced, not
  already out
- If the article is not really about ${candidate.guestName} (e.g. their name
  appears only in passing, or it's a different person with a similar name),
  return is_upcoming: false
- year: 4-digit string if stated or clearly implied, else ""`,
    }],
  });

  try {
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return null;
  }
}

async function main() {
  const guestsData = readJson<{ guests: Guest[] }>(DATA_FILE, { guests: [] });
  const bios = readJson<Record<string, GuestBio>>(BIOS_FILE, {});
  const articles = readCache<TradePressArticle[]>('trade-press.json') ?? [];

  if (articles.length === 0) {
    console.log('No trade-press articles cached — run fetch-trade-press.ts first.');
    return;
  }

  console.log(`Scanning ${articles.length} articles against ${guestsData.guests.length} guests...`);
  const candidates = findCandidates(guestsData.guests, bios, articles);
  console.log(`${candidates.length} candidate match(es) passed the two-signal bar (name + context).\n`);

  if (candidates.length === 0) {
    writeCache('upcoming-work-candidates.json', []);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY — printing raw candidates without LLM confirmation:');
    console.log(JSON.stringify(candidates, null, 2));
    writeCache('upcoming-work-candidates.json', candidates);
    return;
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const results = [];
  for (const candidate of candidates) {
    process.stdout.write(`  ${candidate.guestName} <- "${candidate.article.title.slice(0, 60)}..." (${candidate.article.source}) ... `);
    const extracted = await extractUpcomingWork(client, candidate);
    if (!extracted || !extracted.is_upcoming) {
      console.log('not upcoming / not confirmed');
      continue;
    }
    if (extracted.year && parseInt(extracted.year) < CURRENT_YEAR) {
      console.log(`rejected (year ${extracted.year} already past)`);
      continue;
    }
    console.log(`✓ ${extracted.title} (${extracted.type}, ${extracted.year || 'no year'})`);
    results.push({
      guestName: candidate.guestName,
      title: extracted.title,
      type: extracted.type,
      year: extracted.year,
      source: candidate.article.source,
      source_url: candidate.article.link,
      matchedContext: candidate.matchedContext,
    });
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n=== ${results.length} confirmed upcoming-work signal(s) ===`);
  writeCache('upcoming-work-candidates.json', results);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
