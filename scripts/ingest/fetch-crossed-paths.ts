/**
 * fetch-crossed-paths.ts
 * Step 2 of the "Crossed Paths" pipeline: for each of Conan's own recent FILM
 * credits (scripts/cache/conan-activity.json, from fetch-conan-activity.ts),
 * fetch that film's cast AND soundtrack credits off Wikipedia and cross-
 * reference them against data/guests.json — surfacing existing guests he
 * crossed paths with while making it, and brand-new candidates who've never
 * been booked.
 *
 * Music credits are their own signal, not a cast substitute: a real run
 * found Toy Story 5's cast-only pass missed Taylor Swift entirely, because
 * her connection is a soundtrack song, not a voice-cast role. That section's
 * Wikipedia formatting is much less consistent than a cast list (prose,
 * bullet lists, and tables all show up in the wild), so rather than assuming
 * a strict "Artist – Song" grammar, this reads the whole Music/Soundtrack
 * section as text and checks it for existing guests' full names — a
 * narrower, name-match-only signal (see findMusicCredits below), not a
 * cast-equivalent new-candidate discovery.
 *
 * Deliberately FILM-ONLY for this first pass. TV credits and awards-show
 * hosting were considered and rejected: a TV Wikipedia article's "Cast"
 * section lists the show's ENTIRE run (e.g. every actor across 12 seasons of
 * Curb Your Enthusiasm), not just the one episode Conan appeared in — cross-
 * referencing against it would falsely claim he "crossed paths" with cast
 * members from unrelated seasons. A film's cast, by contrast, genuinely
 * worked on that one production together. Fixing TV needs per-episode
 * guest-star data, which most TV Wikipedia articles don't carry cleanly;
 * that's future work, not guessed around here. Awards-show hosting has the
 * same problem one level worse (nominees/presenters lists are huge and only
 * loosely "crossed paths"), so it's skipped too.
 *
 * Usage:
 *   npx tsx scripts/ingest/fetch-crossed-paths.ts
 * Reads scripts/cache/conan-activity.json
 * Writes scripts/cache/crossed-paths.json
 */
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { readCache, writeCache, normalizeGuestName, sleep } from './utils';
import { fetchWikiSections, fetchWikiSectionHtml } from './wiki';
import type { Guest } from '../../lib/types';

const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');
// Animated films (Toy Story 5 included) title this section "Voice cast", not
// "Cast" — confirmed via a real run where Toy Story 5 came back with 0 cast
// members found because the plain "Cast" match missed it entirely.
const CAST_HEADING_RE = /^(voice )?cast$/i;
const MUSIC_HEADING_RE = /^(music|soundtrack)$/i;
// He's in his own films' casts, obviously — but he's the whole reason this
// pipeline exists, not a "never booked" candidate. A live run listed him as
// exactly that in 3 films before this filter existed.
const CONAN_NAME = "conan o'brien";

interface ConanActivity {
  title: string;
  type: 'film' | 'tv' | 'hosting' | 'podcast_guest' | 'other';
  year: string;
  role: string;
}

interface CastMember {
  name: string;
  character: string;
}

interface CrossedPath {
  activityTitle: string;
  activityYear: string;
  castName: string;
  character: string;
  creditType: 'cast' | 'music';
  matchedGuestId: string | null;
  matchedGuestName: string | null;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

async function fetchFilmCast(title: string): Promise<CastMember[]> {
  const sections = await fetchWikiSections(title);
  const castSection = sections.find((s) => CAST_HEADING_RE.test(s.line.trim()));
  if (!castSection) {
    console.log(`    (no cast-shaped section found — headings were: ${sections.map((s) => s.line).join(', ') || '(none)'})`);
    return [];
  }

  const html = await fetchWikiSectionHtml(title, castSection.index);
  const $ = cheerio.load(html);
  const members: CastMember[] = [];

  // Strip footnote reference markers (Wikipedia renders these as <sup> tags,
  // e.g. "Linda[1]") before reading text — confirmed leaking into real
  // character names in a live run otherwise.
  $('li sup.reference').remove();
  // Some articles (Toy Story 5's included) embed a <references>/reflist block
  // directly inside the cast section rather than a separate "References"
  // heading — its <li> citation entries ("^ Battison, Jess (May 25, 2026)...")
  // got picked up as fake cast rows in a live run. Drop the whole block.
  $('.reflist, ol.references, .references').remove();

  $('li').each((_, li) => {
    const text = $(li).text().trim().replace(/\s+/g, ' ');
    if (!text) return;
    // Second safety net: a citation entry that survived the block removal
    // above still starts with Wikipedia's "^" backlink marker.
    if (text.startsWith('^')) return;
    // Wikipedia cast bullets read "Actor Name as Character" (often with a
    // trailing parenthetical like "(voice)"). Bullets without " as " —
    // occasional framing text like "and others" — are skipped rather than
    // guessed at.
    const match = text.match(/^(.+?)\s+as\s+(.+)$/i);
    if (!match) return;
    members.push({ name: match[1].trim(), character: match[2].trim() });
  });

  return members;
}

// Returns the Music/Soundtrack section's text with citations stripped, or ''
// if the film's article has no such section.
async function fetchMusicSectionText(title: string): Promise<string> {
  const sections = await fetchWikiSections(title);
  const musicSection = sections.find((s) => MUSIC_HEADING_RE.test(s.line.trim()));
  if (!musicSection) return '';

  const html = await fetchWikiSectionHtml(title, musicSection.index);
  const $ = cheerio.load(html);
  $('sup.reference').remove();
  $('.reflist, ol.references, .references').remove();
  return $.root().text().replace(/\s+/g, ' ').trim();
}

// Name-match only (see file header for why): finds which existing guests are
// named in the film's Music/Soundtrack section text.
function findMusicCredits(musicText: string, guests: Guest[]): Guest[] {
  if (!musicText) return [];
  const textLower = musicText.toLowerCase();
  return guests.filter((guest) => {
    const nameLower = guest.name.toLowerCase();
    // A single-word name (stage name, mononym) matching inside a whole
    // section of prose is too easy to false-positive on — require a real
    // multi-word name, same bar match-upcoming-work.ts uses for trade press.
    if (nameLower.split(/\s+/).length < 2) return false;
    return textLower.includes(nameLower);
  });
}

async function main() {
  const activity = readCache<{ activity: ConanActivity[] }>('conan-activity.json')?.activity ?? [];
  if (activity.length === 0) {
    console.log('No scripts/cache/conan-activity.json — run fetch-conan-activity.ts first.');
    return;
  }

  const films = activity.filter((a) => a.type === 'film');
  console.log(`${films.length} of ${activity.length} activity item(s) are films (TV/hosting/podcast skipped — see file header).\n`);
  if (films.length === 0) return;

  const guestsData = readJson<{ guests: Guest[] }>(DATA_FILE, { guests: [] });
  const guestByName = new Map<string, Guest>();
  for (const guest of guestsData.guests) {
    guestByName.set(normalizeGuestName(guest.name).toLowerCase(), guest);
  }

  const results: CrossedPath[] = [];

  for (const film of films) {
    process.stdout.write(`Fetching cast for "${film.title}" (${film.year})... `);
    const cast = await fetchFilmCast(film.title);
    console.log(`${cast.length} cast member(s) found`);

    for (const member of cast) {
      const normalized = normalizeGuestName(member.name).toLowerCase();
      if (normalized === CONAN_NAME) continue;
      const matched = guestByName.get(normalized) ?? null;
      results.push({
        activityTitle: film.title,
        activityYear: film.year,
        castName: member.name,
        character: member.character,
        creditType: 'cast',
        matchedGuestId: matched?.id ?? null,
        matchedGuestName: matched?.name ?? null,
      });
    }

    process.stdout.write(`  Checking "${film.title}" soundtrack for existing guests... `);
    const musicText = await fetchMusicSectionText(film.title);
    const musicMatches = findMusicCredits(musicText, guestsData.guests);
    console.log(`${musicMatches.length} found`);

    for (const guest of musicMatches) {
      results.push({
        activityTitle: film.title,
        activityYear: film.year,
        castName: guest.name,
        character: 'soundtrack contributor',
        creditType: 'music',
        matchedGuestId: guest.id,
        matchedGuestName: guest.name,
      });
    }

    await sleep(300);
  }

  const existingGuestHits = results.filter((r) => r.matchedGuestId !== null);
  const newCandidates = results.filter((r) => r.matchedGuestId === null);

  console.log(`\n=== ${existingGuestHits.length} crossed path(s) with existing guests ===`);
  for (const hit of existingGuestHits) {
    console.log(`  ${hit.matchedGuestName} — "${hit.activityTitle}" (${hit.activityYear}) as ${hit.character}`);
  }

  console.log(`\n=== ${newCandidates.length} new candidate(s), never booked ===`);
  for (const candidate of newCandidates) {
    console.log(`  ${candidate.castName} — "${candidate.activityTitle}" (${candidate.activityYear}) as ${candidate.character}`);
  }

  writeCache('crossed-paths.json', { generatedAt: new Date().toISOString(), results });
  console.log('\nWrote scripts/cache/crossed-paths.json');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
