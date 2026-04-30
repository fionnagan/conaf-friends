# The Friend Registry

> A fan-made archive of every friendship Conan O'Brien has formed across 30+ years of television and podcasting.

**Unofficial fan project. Not affiliated with Team Coco or Conan O'Brien.**

## What it is

The Friend Registry maps guests across all five eras of Conan's career:

| Era | Years |
|-----|-------|
| Late Night with Conan O'Brien | 1993–2009 |
| The Tonight Show with Conan O'Brien | 2009–2010 |
| Conan (TBS) | 2010–2021 |
| Conan O'Brien Needs a Friend (podcast) | 2018–present |
| Conan Must Go | 2023–present |

Each guest gets a **Friendship Score** (35–100) and a descriptor label ("Inner Circle", "Genuine Friend", etc.), calculated from five factors: appearances, cold open sentiment, origin depth, visit type, and gap resilience. The score is entirely fan-made and affectionate.

## Quick start

```bash
npm install
npm run ingest   # ~10 min, fetches all real data
npm run dev      # open http://localhost:3000
```

## Pages

- **`/`** — The Map: D3 force-directed constellation of all guests, clustered by origin type
- **`/arc`** — Friendship Arcs: every guest's timeline from 1993 to today
- **`/cold-opens`** — Cold Open Archive: every "I feel ___ about being Conan O'Brien's friend" moment
- **`/guest/[id]`** — Full guest profile with score breakdown, arc, and episode player
- **`/about`** — Methodology, data sources, and attribution

## Ingest pipeline

The data layer is a standalone Node.js pipeline that runs at build time and writes a single canonical `data/guests.json`. The frontend reads this file — no live API calls.

### Prerequisites

- Node.js 18+ (uses `tsx` for TypeScript execution)
- Optional: `YOUTUBE_API_KEY` in `.env.local` for YouTube video matching

### Setting up YouTube (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project, enable **YouTube Data API v3**
3. Create an API key (free tier: 10,000 units/day; each search = 100 units)
4. Add to `.env.local`:

```
YOUTUBE_API_KEY=your_key_here
```

The ingest works without a YouTube key — episodes will fall back to Simplecast audio playback.

### Running ingest

```bash
npm run ingest          # full pipeline (all 6 steps)
npm run ingest:rss      # step 1: podcast RSS only
npm run ingest:youtube  # step 2: YouTube video matching
npm run ingest:history  # step 3: late night guest history
npm run ingest:origins  # step 4: origin classification
npm run ingest:photos   # step 5: guest photos
npm run ingest:scores   # step 6: compute scores (dry run)
npm run ingest:merge    # step 7: merge to guests.json
```

### Caching

All network requests are cached to `scripts/cache/`. Re-runs only fetch what's missing:

- `scripts/cache/podcast-episodes.json` — RSS feed (delete to re-fetch)
- `scripts/cache/youtube-matches.json` — YouTube search results
- `scripts/cache/late-night-history.json` — Wikipedia/IMDb scrape results
- `scripts/cache/origins.json` — Wikipedia bio classifications
- `scripts/cache/photos.json` — Wikipedia thumbnail URLs

Delete any cache file to force a fresh fetch of that data source.

### Approximate run times (first run)

| Step | Time | Notes |
|------|------|-------|
| RSS fetch | ~5 sec | 691 episodes |
| YouTube matching | ~3 min | 95 searches max (quota cap); skipped if no API key |
| Late night history | ~30 sec | Wikipedia + IMDb scraping at 1 req/sec |
| Origins | ~5 min | 488 Wikipedia bio lookups at 2 req/sec |
| Photos | ~10 min | 488 Wikipedia pageimage lookups at 1 req/sec |
| Merge + scores | ~1 sec | Pure computation |

Subsequent runs are near-instant (all cached).

## Build & deploy

```bash
npm run build   # production build with static HTML for all 488+ guest pages
npm start       # serve production build locally
```

### Vercel deployment

```bash
npx vercel
```

Environment variable to set in Vercel dashboard (optional):
- `YOUTUBE_API_KEY`

The app is fully static-friendly. No server-side runtime required.

## Tech stack

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Styling:** Tailwind CSS + custom CSS variables
- **Visualization:** D3.js (force-directed graph) + plain SVG (timelines)
- **Fonts:** Fraunces (serif headlines) + Inter (body)
- **Data pipeline:** Node.js scripts with `tsx`, `rss-parser`, `axios`, `cheerio`

## Data sources

- **Podcast:** [Simplecast RSS feed](https://feeds.simplecast.com/dHoohVNH) — cold open phrases parsed from episode descriptions
- **Late night history:** Wikipedia episode lists + IMDb cast pages (incomplete, especially pre-2010 — gaps marked as unknown)
- **Photos:** Wikipedia pageimage API
- **YouTube:** Team Coco YouTube channel via YouTube Data API v3 (requires API key)
- **Origins:** Wikipedia bio scraping + hardcoded ruleset

## Testing

```bash
npm test         # run friendship score algorithm tests
npm run test:watch
```

19 tests cover all score algorithm factors: floor/cap, label assignment, cross-era bonuses, sentiment weighting, gap resilience.

## Data limitations

- **Late Night NBC (1993–2009):** Guest data is very sparse on the open web. The ingest pulls what's available from Wikipedia and IMDb, but most pre-2010 appearances are either missing or marked with `confidence: "inferred"`.
- **Photos:** Wikipedia rate limits API requests; the first full run fetches photos at 1.2 sec/request (~10 min). If rate-limited, delete `scripts/cache/photos.json` and re-run after an hour.
- **YouTube:** The free API tier allows ~95 searches per ingest run. Cache is incremental so full coverage builds over multiple runs.

## Friendship Score algorithm

Five weighted factors, 0–100 scale, floored at 35:

| Factor | Max | Description |
|--------|-----|-------------|
| Appearances | 30 | 1→6, 2→12, 3→18, 4+→22, +4 per cross-era |
| Cold open sentiment | 25 | warm→25, affectionate-absurd→22, neutral→15, deflecting/anxious→12 |
| Origin depth | 20 | SNL/Simpsons→20, Harvard Lampoon→20, comedy peer→16, late-night regular→14, second-degree→12, cold booking→8 |
| Visit type | 15 | non-promo→15, mixed→12, pure promo→8 |
| Gap resilience | 10 | 5yr+→10, 3–5yr→9, 1–3yr→8, <1yr→6, one-timer→5 |

Labels: Inner Circle (90+), Genuine Friend (80+), Trusted Confidant (70+), Comedy Soulmate (60+), Beloved Acquaintance (50+), Cherished Visitor (40+), Honored Guest (35+).

## Respecting Team Coco

- Audio playback uses Simplecast's hosted URLs directly (no downloading or proxying)
- Video playback uses official YouTube IFrame embeds (ads and view counts preserved)
- No content is downloaded, mirrored, or re-hosted
- All data sources are fully public

---

*Unofficial fan project. All trademarks belong to their respective owners. Made with love.*
