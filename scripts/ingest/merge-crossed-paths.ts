/**
 * merge-crossed-paths.ts
 * Folds the three "Crossed Paths" caches — Conan's own activity, film/
 * soundtrack cast cross-referencing, and trade-press personal events — into
 * data/crossed-paths.json, the file the site actually reads. Mirrors
 * run-merge.ts's role for bios: pure re-merge, no network, and runs even if
 * an upstream step failed (each source falls back to empty rather than
 * blocking the others).
 *
 * Usage:
 *   npx tsx scripts/ingest/merge-crossed-paths.ts
 * Reads scripts/cache/{conan-activity,crossed-paths,personal-crossed-paths}.json
 * Writes data/crossed-paths.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCache } from './utils';

const OUT_FILE = path.join(process.cwd(), 'data', 'crossed-paths.json');

interface ConanActivity {
  title: string;
  type: 'film' | 'tv' | 'hosting' | 'podcast_guest' | 'other';
  year: string;
  role: string;
}

interface FilmCrossedPath {
  activityTitle: string;
  activityYear: string;
  castName: string;
  character: string;
  creditType: 'cast' | 'music';
  matchedGuestId: string | null;
  matchedGuestName: string | null;
}

interface PersonalCrossedPath {
  otherPersonName: string;
  description: string;
  source: string;
  sourceUrl: string;
  matchedGuestId: string | null;
  matchedGuestName: string | null;
}

// What the site actually consumes: crossings grouped by the existing guest
// they involve, plus a flat "never booked" list. Only one candidate tier is
// populated today — crossed paths with Conan himself, via his own film/
// soundtrack/personal connections. A second, weaker tier (connected via an
// existing GUEST's own other credits, not Conan's) was part of the original
// design but has no pipeline yet — that needs enriching each guest's own
// filmography the way fetch-crossed-paths.ts does for Conan's, which is real
// future work, not something to fake here with a made-up tier.
export interface GuestCrossing {
  source: 'film-cast' | 'film-music' | 'personal';
  activityTitle: string;
  activityYear: string;
  detail: string;
  sourceUrl?: string;
}

export interface NeverBookedCandidate {
  name: string;
  tier: 'crossed-with-conan';
  source: 'film-cast' | 'film-music' | 'personal';
  activityTitle: string;
  activityYear: string;
  detail: string;
  sourceUrl?: string;
}

export interface CrossedPathsData {
  generatedAt: string;
  conanActivity: ConanActivity[];
  guestCrossings: Record<string, GuestCrossing[]>;
  neverBookedCandidates: NeverBookedCandidate[];
}

function main() {
  const conanActivity = readCache<{ activity: ConanActivity[] }>('conan-activity.json')?.activity ?? [];
  const filmResults = readCache<{ results: FilmCrossedPath[] }>('crossed-paths.json')?.results ?? [];
  const personalResults = readCache<{ results: PersonalCrossedPath[] }>('personal-crossed-paths.json')?.results ?? [];

  const guestCrossings: Record<string, GuestCrossing[]> = {};
  const neverBookedCandidates: NeverBookedCandidate[] = [];

  for (const r of filmResults) {
    const source = r.creditType === 'music' ? 'film-music' : 'film-cast';
    const detail = r.creditType === 'music' ? 'Soundtrack contributor' : `Played ${r.character}`;
    if (r.matchedGuestId) {
      (guestCrossings[r.matchedGuestId] ??= []).push({
        source, activityTitle: r.activityTitle, activityYear: r.activityYear, detail,
      });
    } else {
      neverBookedCandidates.push({
        name: r.castName, tier: 'crossed-with-conan', source,
        activityTitle: r.activityTitle, activityYear: r.activityYear, detail,
      });
    }
  }

  for (const r of personalResults) {
    if (r.matchedGuestId) {
      (guestCrossings[r.matchedGuestId] ??= []).push({
        source: 'personal', activityTitle: r.source, activityYear: '', detail: r.description, sourceUrl: r.sourceUrl,
      });
    } else {
      neverBookedCandidates.push({
        name: r.otherPersonName, tier: 'crossed-with-conan', source: 'personal',
        activityTitle: r.source, activityYear: '', detail: r.description, sourceUrl: r.sourceUrl,
      });
    }
  }

  const output: CrossedPathsData = {
    generatedAt: new Date().toISOString(),
    conanActivity,
    guestCrossings,
    neverBookedCandidates,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(
    `Wrote data/crossed-paths.json: ${Object.keys(guestCrossings).length} existing guest(s) with crossings, ` +
    `${neverBookedCandidates.length} never-booked candidate(s).`
  );
}

if (require.main === module) {
  main();
}
