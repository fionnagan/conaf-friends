/**
 * One-time migration: convert data/guests.json from embedding each podcast
 * episode's title/url/audio/video/artwork on every guest's own Appearance
 * to a shared Episode record (GuestsData.episodes) that guests reference by
 * episodeId. Run once against the committed file — future weekly-ingest
 * runs produce this shape directly via the updated merge.ts.
 *
 * Non-podcast appearances (late-night, which never carried video/audio)
 * are left as-is.
 *
 * Usage: npx tsx scripts/ingest/migrate-to-episodes.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Guest, GuestsData, Appearance, Episode } from '../../lib/types';

const DATA_PATH = path.join(process.cwd(), 'data/guests.json');

interface OldAppearance extends Appearance {
  episodeUrl?: string;
  audioUrl?: string;
  youtubeVideoId?: string | null;
  artworkUrl?: string;
}

function main(): void {
  const data: GuestsData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

  const episodeMap = new Map<string, Episode>();
  let migrated = 0;

  for (const guest of data.guests as Guest[]) {
    guest.appearances = guest.appearances.map((appRaw) => {
      const app = appRaw as OldAppearance;
      if (app.era !== 'podcast') return app;

      const episodeId = `podcast-${app.date}`;
      if (!episodeMap.has(episodeId)) {
        episodeMap.set(episodeId, {
          id: episodeId,
          date: app.date,
          title: app.episodeTitle ?? '',
          url: app.episodeUrl,
          audioUrl: app.audioUrl,
          youtubeVideoId: app.youtubeVideoId ?? null,
          artworkUrl: app.artworkUrl,
        });
      }
      migrated++;

      const newApp: Appearance = {
        era: app.era,
        date: app.date,
        episodeId,
        coldOpenWord: app.coldOpenWord,
        coldOpenSentiment: app.coldOpenSentiment,
      };
      if (app.order !== undefined) newApp.order = app.order;
      return newApp;
    });
  }

  data.episodes = Array.from(episodeMap.values());

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Migrated ${migrated} podcast appearances into ${episodeMap.size} episodes.`);
}

main();
