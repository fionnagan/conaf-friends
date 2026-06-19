import * as fs from 'fs';
import * as path from 'path';
import { slugify, normalizeGuestName } from './utils';

// ── Guest splits / normalizations (committed config) ──────────────────────────
interface GuestSplitEntry {
  normalizeAs?: string;
  split?: Array<{ name: string; coldOpenWord?: string; coldOpenSentiment?: string }>;
}

function loadGuestSplits(): Record<string, GuestSplitEntry> {
  try {
    const p = path.join(__dirname, 'guest-splits.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}
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

const SHOW_NAMES: Record<string, string> = {
  'late-night-nbc': "Late Night with Conan O'Brien",
  'tonight-show': "The Tonight Show with Conan O'Brien",
  'tbs-conan': 'Conan',
  'podcast': "Conan O'Brien Needs a Friend",
  'conan-must-go': "Conan O'Brien Must Go",
};

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

  const guestSplits = loadGuestSplits();

  // Process podcast episodes
  for (const ep of podcastEpisodes) {
    if (!ep.guestName || ep.isFanSegment || ep.isStaffEpisode) continue;

    const splitConfig = guestSplits[ep.guestName];
    // Always normalise to ISO-date key so it aligns with youtube-matches.json
    const epISODate = ep.pubDate ? new Date(ep.pubDate).toISOString().substring(0, 10) : epDate;
    const cacheKey = `${ep.guestName}::${epISODate}`;
    const epDate = ep.pubDate
      ? new Date(ep.pubDate).toISOString().substring(0, 10)
      : '2018-01-01';
    const baseAppearance = {
      era: 'podcast' as const,
      date: epDate,
      episodeTitle: ep.title,
      episodeUrl: ep.link,
      audioUrl: ep.enclosure?.url,
      artworkUrl: ep.itunes?.image,
    };

    if (splitConfig?.normalizeAs) {
      // Normalize episode to a canonical guest name (e.g. "Martin Short Live From SiriusXM NY" → "Martin Short")
      const name = normalizeGuestName(splitConfig.normalizeAs);
      const guest = getGuest(name);
      const ytKey = `${splitConfig.normalizeAs}::${epISODate}`;
      const ytMatch = youtubeCache[ytKey] || youtubeCache[cacheKey];
      const appearance: Appearance = {
        ...baseAppearance,
        youtubeVideoId: ytMatch?.videoId ?? null,
        coldOpenWord: ep.coldOpenWord,
        coldOpenSentiment: ep.coldOpenSentiment,
      };
      guest.appearances.push(appearance);
    } else if (splitConfig?.split) {
      // Multi-guest episode: create independent appearance for each guest
      for (const splitGuest of splitConfig.split) {
        const name = normalizeGuestName(splitGuest.name);
        const guest = getGuest(name);
        const ytKey = `${splitGuest.name}::${epISODate}`;
        const ytMatch = youtubeCache[ytKey] || youtubeCache[cacheKey];
        const appearance: Appearance = {
          ...baseAppearance,
          youtubeVideoId: ytMatch?.videoId ?? null,
          coldOpenWord: splitGuest.coldOpenWord ?? ep.coldOpenWord,
          coldOpenSentiment: (splitGuest.coldOpenSentiment as Appearance['coldOpenSentiment']) ?? ep.coldOpenSentiment,
        };
        guest.appearances.push(appearance);

        const mentioned = detectMentionedGuests(ep.description, allGuestNames).filter(
          (n) => n !== name
        );
        if (mentioned.length > 0) {
          guest.mentionedGuests = [
            ...new Set([...(guest.mentionedGuests || []), ...mentioned]),
          ];
        }
      }
    } else {
      // Normal single-guest episode
      const name = normalizeGuestName(ep.guestName);
      const guest = getGuest(name);
      const ytMatch = youtubeCache[cacheKey];
      const appearance: Appearance = {
        ...baseAppearance,
        youtubeVideoId: ytMatch?.videoId ?? null,
        coldOpenWord: ep.coldOpenWord,
        coldOpenSentiment: ep.coldOpenSentiment,
      };
      guest.appearances.push(appearance);

      const mentioned = detectMentionedGuests(ep.description, allGuestNames).filter(
        (n) => n !== name
      );
      if (mentioned.length > 0) {
        guest.mentionedGuests = [
          ...new Set([...(guest.mentionedGuests || []), ...mentioned]),
        ];
      }
    }
  }

  // Process late night history. The source array is in billing order within each
  // episode (e.g. the premiere 1993-09-13 lists John Goodman, then Drew Barrymore,
  // then Tony Randall — the real on-air order), so we assign a per-episode `order`
  // index as we go. This is what lets "who was Conan's first guest?" be answered.
  const episodeSeq = new Map<string, number>();
  for (const ln of lateNightHistory) {
    const name = normalizeGuestName(ln.guestName);
    const guest = getGuest(name);

    const epKey = `${ln.era}|${ln.date}`;
    const order = episodeSeq.get(epKey) ?? 0;
    episodeSeq.set(epKey, order + 1);

    const appearance: Appearance = {
      era: ln.era,
      date: ln.date,
      order,
      episodeTitle: ln.episodeTitle,
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

    // Derive "How Conan knows them" from the REAL earliest appearance — overriding any
    // hallucinated bio text (e.g. cached Claude bios saying "...Needs a Friend in 1992"
    // for a guest whose first appearance was Late Night in 1993). Also strip that same
    // fabricated sentence if it was appended to the description prose.
    const first = guest.appearances[0];
    if (guest.bio && first) {
      const year = new Date(first.date).getFullYear();
      const show = SHOW_NAMES[first.era] ?? "Conan's show";
      const firstLine = `First appeared on ${show} in ${year}.`;
      const ot = guest.origin.type;
      const lead =
        (ot === 'snl-simpsons' || ot === 'harvard-lampoon' || ot === 'comedy-peer') &&
        guest.origin.label
          ? `${guest.origin.label.replace(/\.$/, '')}. `
          : '';
      guest.bio.conan_connection = {
        type: guest.bio.conan_connection?.type ?? 'inferred',
        evidence: `${lead}${firstLine}`,
      };
      guest.bio.description = guest.bio.description
        .replace(/\s*First appeared on[^.]*\b\d{4}\b\.?\s*$/i, '')
        .trim();
    }

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
