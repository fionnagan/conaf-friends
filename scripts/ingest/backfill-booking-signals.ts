/**
 * backfill-booking-signals.ts
 * Fills in the booking-signal fields (birth_year, death_year, gender,
 * nationality, prestige_signals, primary_platform, upcoming_work) added to
 * GuestBio in PR #15 (plus death_year/gender added later, in a separate
 * change), for guests who were already enriched before ALL of those fields
 * existed.
 *
 * Deliberately NOT a re-run of enrich-bios.ts --force: that would redo the
 * full Claude pipeline (re-synthesizing descriptions that are already fine)
 * for every guest, roughly doubling cost and runtime for no benefit. This
 * does ONE Claude call per guest — structured extraction only — and merges
 * just the new fields into the EXISTING bio, leaving
 * description/known_for/recent_work/profession untouched.
 *
 * Only touches guests whose cached bio exists and isn't needs_review (that
 * guest's Wikipedia entity resolution already failed once — re-running the
 * same resolution isn't expected to succeed now). Queues a guest whenever
 * ANY of the booking-signal fields' KEYS is entirely missing from the
 * cached bio — not just birth_year. death_year and gender were added to
 * this schema after birth_year/nationality/prestige_signals/
 * primary_platform were, so a bio processed by an earlier version of this
 * script (or of enrich-bios.ts, before gender/death_year existed) can have
 * birth_year present while gender/death_year are entirely absent. A filter
 * that only checked for birth_year's presence would treat that bio as
 * "already checked" and skip it forever — confirmed via a real check: 245
 * of 297 valid cached bios have birth_year but are missing gender and
 * death_year, and were being silently skipped by the old birth_year-only
 * filter.
 *
 * Usage:
 *   npx tsx scripts/ingest/backfill-booking-signals.ts [--limit N] [--retry-empty] [--guest "Name"]
 *   --retry-empty  also reprocess guests where every field's KEY is present
 *                  but birth_year is "" — needed after a real run came back
 *                  0/20 on birth_year despite the intro text containing
 *                  "born", to re-check those specific guests once the root
 *                  cause is fixed rather than skipping them forever (the
 *                  default filter treats "" as "checked, not stated").
 *   --guest "Name" process one guest regardless of the above filter — cheap
 *                  targeted debugging.
 * Reads/writes scripts/cache/bios.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveEntityWithRetry } from './enrich-bios';
import { BOOKING_SIGNAL_RULES, checkDeathYearPlausibility } from './booking-signal-schema';
import type { GuestBio, Guest } from '../../lib/types';

const CACHE_DIR = path.join(process.cwd(), 'scripts', 'cache');
const BIOS_FILE = path.join(CACHE_DIR, 'bios.json');
const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');
const DEFAULT_LIMIT = 20; // small default — validate on a sample before scaling up

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : DEFAULT_LIMIT; })();
const RETRY_EMPTY = args.includes('--retry-empty');
const ONLY_GUEST = (() => { const i = args.indexOf('--guest'); return i >= 0 ? args[i + 1] : null; })();

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function extractBookingSignals(client: any, guestName: string, intro: string) {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: 'Extract structured biographical data from a Wikipedia intro. Output valid JSON only. No markdown.',
    messages: [{
      role: 'user',
      content: `Guest: ${guestName}
Wikipedia intro:
${intro}

Return JSON:
{ "birth_year": "", "death_year": "", "gender": "", "nationality": "", "prestige_signals": [], "primary_platform": "film|tv|music|streaming|podcast|sports|other" }

Rules:
${BOOKING_SIGNAL_RULES}`,
    }],
  });

  try {
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return null;
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY — cannot extract booking signals. Set it and re-run.');
    process.exit(1);
  }

  const guestsData = readJson<{ guests: Guest[] }>(DATA_FILE, { guests: [] });
  const bios = readJson<Record<string, GuestBio>>(BIOS_FILE, {});

  // All fields this script writes together in one call — a bio is only
  // "fully checked" once every one of these keys is present, regardless of
  // which earlier run (or which version of enrich-bios.ts) touched it.
  const BOOKING_SIGNAL_KEYS = ['birth_year', 'death_year', 'gender', 'nationality', 'prestige_signals', 'primary_platform'] as const;
  const isFullyChecked = (bio: GuestBio) => BOOKING_SIGNAL_KEYS.every((k) => k in bio);

  let queue = guestsData.guests.filter((g) => {
    if (ONLY_GUEST) return g.name.toLowerCase() === ONLY_GUEST.toLowerCase();
    const bio = bios[g.name];
    if (!bio || bio.needs_review) return false;
    if (!isFullyChecked(bio)) return true;
    return RETRY_EMPTY && bio.birth_year === '';
  });

  console.log(`${queue.length} guest(s) have a bio missing booking-signal fields (of ${guestsData.guests.length} total).`);
  queue = queue.slice(0, LIMIT);
  console.log(`Processing ${queue.length} (--limit ${LIMIT}).\n`);
  if (queue.length === 0) return;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  let success = 0, skipped = 0, failed = 0;

  for (let i = 0; i < queue.length; i++) {
    const guest = queue[i];
    process.stdout.write(`[${i + 1}/${queue.length}] ${guest.name} ... `);

    try {
      const entity = await resolveEntityWithRetry(guest.name);
      if (!entity) {
        console.log('could not re-resolve Wikipedia entity, skipped');
        skipped++;
        await sleep(400);
        continue;
      }

      // Debug: confirmed via a real run that birth_year came back empty for
      // 20/20 guests (including Kenan Thompson, Adam Sandler, Matt Damon —
      // whose Wikipedia intros certainly state a birth date) while
      // nationality succeeded 20/20. Log whether the raw intro text even
      // contains "born" so a data-source problem (REST summary API stripping
      // it) is distinguishable from an extraction problem (Claude not
      // reading it out) instead of guessing which one it is.
      const hasBornText = /\bborn\b/i.test(entity.intro);
      console.log(`\n  [debug] intro has "born": ${hasBornText} — first 200 chars: "${entity.intro.slice(0, 200)}"`);

      const signals = await extractBookingSignals(client, guest.name, entity.intro);
      if (!signals) {
        console.log('extraction failed, skipped');
        skipped++;
        await sleep(300);
        continue;
      }

      // death_year is the highest-stakes field this script writes — wrongly
      // marking a living person as deceased is about as bad an accuracy
      // failure as this pipeline can produce. Confirmed via a real A/B test
      // of enrich-bios.ts against claude-haiku-4-5-20251001: it fabricated a
      // death_year for 4 of 5 real, living guests, misreading an unrelated
      // in-text year (most often a career-span end-year) as a death date —
      // this script uses the same kind of extraction call, so the same
      // failure mode is possible here regardless of model. Shared with
      // enrich-bios.ts's identical check (checkDeathYearPlausibility) so the
      // two call sites can't drift out of agreement.
      const birthYear = signals.birth_year || '';
      let deathYear = signals.death_year || '';
      if (deathYear && !checkDeathYearPlausibility(birthYear, deathYear).ok) {
        console.log(`\n  [warn] dropping implausible death_year "${deathYear}" (birth_year: "${birthYear || 'none'}") — needs manual review`);
        deathYear = '';
      }

      const bio = bios[guest.name];
      bio.birth_year = birthYear;
      bio.death_year = deathYear;
      bio.gender = signals.gender || '';
      bio.nationality = signals.nationality || '';
      bio.prestige_signals = signals.prestige_signals || [];
      bio.primary_platform = signals.primary_platform || undefined;

      console.log(`✓ birth_year=${bio.birth_year || '(none)'}, nationality=${bio.nationality || '(none)'}`);
      success++;

      if ((i + 1) % 10 === 0) fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));
    } catch (err: any) {
      console.log(`error: ${err.message?.slice(0, 80)}`);
      failed++;
    }

    await sleep(1200);
  }

  fs.writeFileSync(BIOS_FILE, JSON.stringify(bios, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`✓ Success: ${success}`);
  console.log(`⊘ Skipped: ${skipped}`);
  console.log(`✗ Failed:  ${failed}`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
