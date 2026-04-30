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
import axios from 'axios';
import type { GuestBio, GuestBioWork, Guest } from '../../lib/types';

// ── Config ───────────────────────────────────────────────────────────────────

const CACHE_DIR  = path.join(process.cwd(), 'scripts', 'cache');
const BIOS_FILE  = path.join(CACHE_DIR, 'bios.json');
const DATA_FILE  = path.join(process.cwd(), 'data', 'guests.json');
const HEADERS    = { 'User-Agent': 'FriendRegistry-Bot/1.0 (fan project)' };
const TTL_MS     = 30 * 24 * 60 * 60 * 1000;
const MIN_ENTITY_CONFIDENCE = 0.65;
const MAX_PER_RUN = 50;
const CURRENT_YEAR = new Date().getFullYear();
const TWO_YEARS_AGO = CURRENT_YEAR - 2;

// ── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE        = args.includes('--force');
const WIKI_ONLY    = args.includes('--wiki-only');
const RETRY_REVIEW = args.includes('--retry-review');
const LIMIT        = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : MAX_PER_RUN; })();
const ONLY         = (() => { const i = args.indexOf('--guest'); return i >= 0 ? args[i + 1] : null; })();

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

interface WikiEntity {
  name: string;
  wikipedia_url: string;
  intro: string;
  confidence: number;
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

  for (const name of deduped) {
    try {
      const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
      const res  = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
        headers: HEADERS, timeout: 10000,
      });
      const data = res.data as any;
      if (data.type === 'disambiguation') continue;

      const intro = (data.extract || '').slice(0, 1500).trim();
      if (!intro) continue;

      const wikiTitle = data.title || name;
      const wikiUrl   = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`;

      // Confidence: name token overlap + bio signal
      // Normalise dots so "B.J." matches "B. J." and vice versa
      const norm        = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
      const nameTokens  = norm(guestName).split(/\s+/);
      const titleTokens = norm(wikiTitle).split(/\s+/);
      const overlap     = nameTokens.filter(t => titleTokens.includes(t)).length / nameTokens.length;
      const hasBioSig   = /\b(born|actor|actress|comedian|writer|director|musician|author|host|producer|singer|stand-up)\b/i.test(intro);
      const confidence  = Math.min(1, overlap * 0.7 + (hasBioSig ? 0.3 : 0));

      return { name: wikiTitle, wikipedia_url: wikiUrl, intro, confidence };
    } catch (e: any) {
      // 404 = no article for this name variant, try next
      if (e?.response?.status === 404) continue;
      // 429 or network error
      return null;
    }
  }
  return null;
}

// ── Wikipedia-only extraction (no Claude) ─────────────────────────────────────

function extractProfessions(intro: string): string[] {
  // "X is an American actor, comedian and writer" → ["actor", "comedian", "writer"]
  const m = intro.match(/^[^.]+?\bis (?:an? |a )?(?:[A-Za-z-]+ )*?((?:actor|actress|comedian|writer|director|producer|musician|singer|author|host|journalist|chef|athlete|politician|stand-up)[^.]*)/i);
  if (!m) return [];
  return m[1]
    .split(/\s*(?:and|,)\s*/i)
    .map(s => s.trim().replace(/[^a-zA-Z -]/g, '').toLowerCase())
    .filter(s => /^[a-z]/.test(s) && s.length > 2)
    .slice(0, 3);
}

// Match "Title (year)" or "Title (year–year)" patterns common in Wikipedia intros
// Captures unquoted titles like "The Mindy Project (2012–2017)" and quoted ones
const TITLE_YEAR_RE = /[""]([^"""]{3,60})[""]|(?<!\w)([A-Z][A-Za-z0-9 ':!?&,-]{2,50}?)\s+\((\d{4})(?:[–-]\d{4}|[–-]present)?\)/g;

function extractKnownFor(intro: string): GuestBioWork[] {
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
      : /album|song|track/i.test(ctx) ? 'other' : 'tv';
    works.push({ title, type, year });
  }
  return works
    .filter((w, i, arr) => arr.findIndex(x => x.title === w.title) === i)
    .slice(0, 4);
}

function extractRecentWork(intro: string): GuestBioWork[] {
  const works: GuestBioWork[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TITLE_YEAR_RE.source, 'g');
  while ((m = re.exec(intro)) !== null) {
    const title = (m[1] || m[2] || '').trim();
    const year  = m[3] || (() => {
      const around = intro.slice(Math.max(0, m!.index - 10), m!.index + title.length + 30);
      return around.match(/\b(20(2[4-9]|[3-9]\d))\b/)?.[0] || '';
    })();
    if (!year || parseInt(year) < TWO_YEARS_AGO) continue;
    if (!title || title.length < 3) continue;
    const ctx  = intro.slice(Math.max(0, m.index - 30), m.index + 60);
    const type: GuestBioWork['type'] = /film|movie/i.test(ctx) ? 'film'
      : /series|show|sitcom|drama/i.test(ctx) ? 'tv'
      : /album|song/i.test(ctx) ? 'other' : 'tv';
    works.push({ title, type, year });
  }
  return works
    .filter((w, i, arr) => arr.findIndex(x => x.title === w.title) === i)
    .slice(0, 4);
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

function buildConanConnection(guest: Guest): ConanConnection {
  const ot = guest.origin.type;
  const ol = guest.origin.label;

  if (ot === 'snl-simpsons' || ot === 'harvard-lampoon') {
    return { type: 'direct', evidence: ol };
  }
  if (ot === 'late-night-regular') {
    const firstApp = guest.appearances[0];
    const year = firstApp ? new Date(firstApp.date).getFullYear() : null;
    return {
      type: 'direct',
      evidence: year ? `Longtime guest going back to ${year}; ${ol}` : ol,
    };
  }
  if (ot === 'comedy-peer' || ot === 'second-degree') {
    return { type: 'industry', evidence: ol };
  }
  const firstYear = new Date(guest.appearances[0]?.date || '').getFullYear();
  return {
    type: 'inferred',
    evidence: `First appeared on Conan O'Brien Needs a Friend in ${firstYear || 'the podcast era'}.`,
  };
}

// ── Claude pipeline ───────────────────────────────────────────────────────────

async function runClaudePipeline(
  client: any,
  guest: Guest,
  entity: WikiEntity,
  conanConn: ConanConnection
): Promise<GuestBio | null> {
  const today = new Date().toISOString().slice(0, 10);

  // Step 1: structured extraction
  const extractMsg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `Extract structured biographical data from Wikipedia intro. Output valid JSON only. No markdown. Today: ${today}.`,
    messages: [{
      role: 'user',
      content: `Guest: ${guest.name}
Wikipedia intro:
${entity.intro}

Return JSON:
{
  "profession": [],
  "known_for": [{"title":"","type":"film|tv|podcast|other","year":""}],
  "recent_work": []
}
Rules:
- known_for: 2-4 highest-signal works
- recent_work: year >= ${TWO_YEARS_AGO} only, empty array if none
- year: 4-digit string or ""`,
    }],
  });

  let structured: any;
  try {
    structured = JSON.parse(extractMsg.content[0].text.trim());
  } catch { return null; }

  await sleep(300);

  // Step 2: description synthesis
  const knownList  = (structured.known_for || []).map((w: any) => `${w.title} (${w.type}, ${w.year})`).join(', ');
  const recentList = (structured.recent_work || []).map((w: any) => `${w.title} (${w.year})`).join(', ');
  const softener   = conanConn.type === 'inferred' ? ' Use tentative language for the Conan connection.' : '';

  const synthMsg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `Write tight editorial bios. Neutral, no hype. 80–120 words. One paragraph. ONLY use provided facts. No new claims.${softener}`,
    messages: [{
      role: 'user',
      content: `Bio for ${guest.name}.
- Profession: ${(structured.profession || []).join(', ') || 'entertainer'}
- Known for: ${knownList || 'see intro'}
- Recent work: ${recentList || 'none confirmed'}
- Conan connection (${conanConn.type}): ${conanConn.evidence}

Paragraph only:`,
    }],
  });

  const description = synthMsg.content[0].text.trim();
  const wordCount = description.split(/\s+/).length;
  if (wordCount < 60 || wordCount > 150) return null;

  return {
    entity:           { name: entity.name, wikipedia_url: entity.wikipedia_url, confidence: entity.confidence },
    profession:       structured.profession || [],
    known_for:        (structured.known_for || []).slice(0, 4),
    recent_work:      (structured.recent_work || []).slice(0, 4),
    conan_connection: conanConn,
    description,
    confidence:       entity.confidence,
    needs_review:     false,
    sources:          [entity.wikipedia_url],
    enrichedAt:       new Date().toISOString(),
  };
}

// ── Wikipedia-only pipeline ───────────────────────────────────────────────────

function runWikiPipeline(guest: Guest, entity: WikiEntity, conanConn: ConanConnection): GuestBio {
  const profession = extractProfessions(entity.intro);
  const known_for  = extractKnownFor(entity.intro);
  const recent_work = extractRecentWork(entity.intro);
  const description = buildDescription(entity.intro, guest.name, conanConn.evidence, conanConn.type);

  const wordCount = description.split(/\s+/).length;
  const needs_review = wordCount < 20 || wordCount > 160;

  return {
    entity:           { name: entity.name, wikipedia_url: entity.wikipedia_url, confidence: entity.confidence },
    profession,
    known_for,
    recent_work,
    conan_connection: conanConn,
    description,
    confidence:       entity.confidence,
    needs_review,
    sources:          [entity.wikipedia_url],
    enrichedAt:       new Date().toISOString(),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate(bio: GuestBio): { ok: boolean; reason?: string } {
  const words = bio.description.split(/\s+/).length;
  if (words < 20 || words > 160) return { ok: false, reason: `word_count:${words}` };

  for (const w of bio.recent_work) {
    if (w.year && parseInt(w.year) < TWO_YEARS_AGO)
      return { ok: false, reason: `stale_recent_work:${w.title}(${w.year})` };
  }

  const knownTitles = new Set(bio.known_for.map(w => w.title.toLowerCase()));
  for (const w of bio.recent_work) {
    if (knownTitles.has(w.title.toLowerCase()))
      return { ok: false, reason: `duplicate:${w.title}` };
  }
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
        // Quick smoke-test to verify credits
        await claudeClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'hi' }],
        });
        console.log('[Bios] Claude available — using full pipeline\n');
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
    const existing = bios[g.name];
    if (!existing) return true;
    // --retry-review re-attempts needs_review entries (usually rate-limited)
    if (existing.needs_review) return RETRY_REVIEW;
    return now - new Date(existing.enrichedAt).getTime() > TTL_MS;
  });

  if (queue.length === 0) {
    console.log('[Bios] All guests up-to-date.');
    return;
  }

  queue = queue.slice(0, LIMIT);
  const mode = claudeClient ? 'Claude+Wikipedia' : 'Wikipedia-only';
  console.log(`[Bios] Enriching ${queue.length} guests via ${mode}\n`);

  let success = 0, reviewNeeded = 0, failed = 0;

  for (let i = 0; i < queue.length; i++) {
    const guest = queue[i];
    const tag   = `[${i + 1}/${queue.length}]`;
    process.stdout.write(`${tag} ${guest.name} ... `);

    try {
      // Entity resolution
      const entity = await resolveEntity(guest.name);
      await sleep(500);

      if (!entity || entity.confidence < MIN_ENTITY_CONFIDENCE) {
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
        console.log(`needs_review (entity confidence: ${conf})`);
        reviewNeeded++;
        if ((i + 1) % 10 === 0) fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));
        await sleep(400);
        continue;
      }

      const conanConn = buildConanConnection(guest);
      let bio: GuestBio | null = null;

      if (claudeClient) {
        bio = await runClaudePipeline(claudeClient, guest, entity, conanConn);
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
        console.log(`needs_review (${check.reason})`);
        reviewNeeded++;
      } else {
        const words = bio.description.split(/\s+/).length;
        const src   = claudeClient ? 'claude' : 'wiki';
        console.log(`✓ (${words}w, conf ${bio.confidence.toFixed(2)}, ${src})`);
        success++;
      }

      bios[guest.name] = bio;
      if ((i + 1) % 10 === 0) fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));

    } catch (err: any) {
      console.log(`error: ${err.message?.slice(0, 80)}`);
      failed++;
    }

    await sleep(3500);
  }

  fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`✓ Success:      ${success}`);
  console.log(`⚠ Needs review: ${reviewNeeded}`);
  console.log(`✗ Failed:       ${failed}`);
  console.log(`Cached:         ${Object.keys(bios).length} guests`);
}

main().catch(err => { console.error(err); process.exit(1); });
