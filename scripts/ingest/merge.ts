import * as fs from 'fs';
import * as path from 'path';
import { slugify, normalizeGuestName } from './utils';
import { computeScore } from './compute-scores';
import type {
  Guest,
  GuestBio,
  GuestsData,
  Appearance,
  RawPodcastEpisode,
  RawLateNightAppearance,
  YouTubeCache,
  PhotoCache,
  OriginCache,
  OriginType,
  ColdOpenSentiment,
} from '../../lib/types';

const PROMO_KEYWORDS = [
  'promoting',
  'new movie',
  'new film',
  'new show',
  'new book',
  'new album',
  'new series',
  'starring in',
  'out now',
  'in theaters',
  'on netflix',
  'on hbo',
  'premieres',
];

function isPromoVisit(description: string): boolean {
  const d = description.toLowerCase();
  return PROMO_KEYWORDS.some((k) => d.includes(k));
}

function detectMentionedGuests(
  description: string,
  allGuestNames: Set<string>
): string[] {
  const mentioned: string[] = [];
  const d = description.toLowerCase();
  for (const name of allGuestNames) {
    if (name.split(' ').length >= 2 && d.includes(name.toLowerCase())) {
      mentioned.push(name);
    }
  }
  return mentioned;
}

export function merge(
  podcastEpisodes: RawPodcastEpisode[],
  lateNightHistory: RawLateNightAppearance[],
  youtubeCache: YouTubeCache,
  photoCache: PhotoCache,
  originCache: OriginCache,
  bioCache: Record<string, GuestBio> = {}
): GuestsData {
  const guestMap = new Map<string, Guest>();

  // Helper: get or create guest
  function getGuest(name: string): Guest {
    const id = slugify(name);
    if (!guestMap.has(id)) {
      const origin = originCache[name] || {
        type: 'cold-booking' as OriginType,
        label: 'Booked as a guest',
        confidence: 'inferred' as const,
      };
      const bio = bioCache[name] || null;
      guestMap.set(id, {
        id,
        name,
        photoUrl: photoCache[name]?.url || null,
        bio: bio && !bio.needs_review ? bio : null,
        origin: {
          type: origin.type,
          label: origin.label,
          confidence: origin.confidence,
        },
        appearances: [],
        friendshipScore: 0,
        friendshipLabel: 'Honored Guest',
        scoreBreakdown: {
          appearances: 0,
          coldOpenSentiment: 0,
          originDepth: 0,
          visitType: 0,
          gapResilience: 0,
        },
      });
    }
    return guestMap.get(id)!;
  }

  // Collect all guest names for mention detection
  const allGuestNames = new Set<string>();
  for (const ep of podcastEpisodes) {
    if (ep.guestName && !ep.isFanSegment && !ep.isStaffEpisode) {
      allGuestNames.add(normalizeGuestName(ep.guestName));
    }
  }
  for (const ln of lateNightHistory) {
    allGuestNames.add(normalizeGuestName(ln.guestName));
  }

  // Process podcast episodes
  for (const ep of podcastEpisodes) {
    if (!ep.guestName || ep.isFanSegment || ep.isStaffEpisode) continue;

    const name = normalizeGuestName(ep.guestName);
    const guest = getGuest(name);

    const cacheKey = `${ep.guestName}::${ep.pubDate}`;
    const ytMatch = youtubeCache[cacheKey];

    const appearance: Appearance = {
      era: 'podcast',
      date: ep.pubDate
        ? new Date(ep.pubDate).toISOString().substring(0, 10)
        : '2018-01-01',
      episodeTitle: ep.title,
      episodeUrl: ep.link,
      audioUrl: ep.enclosure?.url,
      youtubeVideoId: ytMatch?.videoId ?? null,
      promoVisit: isPromoVisit(ep.description),
      coldOpenWord: ep.coldOpenWord,
      coldOpenSentiment: ep.coldOpenSentiment,
      artworkUrl: ep.itunes?.image,
    };

    guest.appearances.push(appearance);

    // Detect mentions of other guests in this episode
    const mentioned = detectMentionedGuests(ep.description, allGuestNames).filter(
      (n) => n !== name
    );
    if (mentioned.length > 0) {
      guest.mentionedGuests = [
        ...new Set([...(guest.mentionedGuests || []), ...mentioned]),
      ];
    }
  }

  // Process late night history
  for (const ln of lateNightHistory) {
    const name = normalizeGuestName(ln.guestName);
    const guest = getGuest(name);

    const appearance: Appearance = {
      era: ln.era,
      date: ln.date,
      episodeTitle: ln.episodeTitle,
      promoVisit: false, // unknown
    };

    // Don't double-add if we already have this era+date
    const exists = guest.appearances.some(
      (a) => a.era === ln.era && a.date === ln.date
    );
    if (!exists) {
      guest.appearances.push(appearance);
    }
  }

  // Compute scores and build related guests
  const allGuests = Array.from(guestMap.values());

  for (const guest of allGuests) {
    // Sort appearances by date
    guest.appearances.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const { friendshipScore, friendshipLabel, scoreBreakdown } = computeScore(guest);
    guest.friendshipScore = friendshipScore;
    guest.friendshipLabel = friendshipLabel;
    guest.scoreBreakdown = scoreBreakdown;
  }

  // Build related guests (same origin cluster, sorted by score)
  for (const guest of allGuests) {
    guest.relatedGuests = allGuests
      .filter(
        (g) => g.id !== guest.id && g.origin.type === guest.origin.type
      )
      .sort((a, b) => b.friendshipScore - a.friendshipScore)
      .slice(0, 5)
      .map((g) => g.id);
  }

  // Sort all guests by friendshipScore descending
  allGuests.sort((a, b) => b.friendshipScore - a.friendshipScore);

  return {
    generatedAt: new Date().toISOString(),
    totalGuests: allGuests.length,
    totalAppearances: allGuests.reduce((n, g) => n + g.appearances.length, 0),
    guests: allGuests,
  };
}

export function writeOutput(data: GuestsData): void {
  const outPath = path.join(process.cwd(), 'data', 'guests.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`[Merge] Written ${data.totalGuests} guests to data/guests.json`);
}
