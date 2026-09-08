export type Era =
  | 'late-night-nbc'
  | 'tonight-show'
  | 'tbs-conan'
  | 'podcast'
  | 'conan-must-go';

export type OriginType =
  | 'snl-simpsons'
  | 'harvard-lampoon'
  | 'comedy-peer'
  | 'late-night-regular'
  | 'second-degree'
  | 'cold-booking';

export type ColdOpenSentiment =
  | 'warm'
  | 'affectionate-absurd'
  | 'neutral'
  | 'deflecting'
  | 'anxious'
  | 'callback';

export interface Appearance {
  era: Era;
  date: string;
  /** Billing order within the same episode (0 = first guest out that night). */
  order?: number;
  episodeTitle?: string;
  episodeUrl?: string;
  audioUrl?: string;
  youtubeVideoId?: string | null;
  coldOpenWord?: string;
  coldOpenSentiment?: ColdOpenSentiment;
  artworkUrl?: string;
}

export interface ScoreBreakdown {
  appearances: number;
  coldOpenSentiment: number;
  originDepth: number;
  gapResilience: number;
}

export type FriendshipLabel =
  | 'Inner Circle'
  | 'Genuine Friend'
  | 'Trusted Confidant'
  | 'Comedy Soulmate'
  | 'Beloved Acquaintance'
  | 'Cherished Visitor'
  | 'Honored Guest';

export interface GuestBioWork {
  title: string;
  type: 'film' | 'tv' | 'music' | 'podcast' | 'other';
  year: string;
}

export type PrimaryPlatform =
  | 'film'
  | 'tv'
  | 'music'
  | 'streaming'
  | 'podcast'
  | 'sports'
  | 'other';

export interface GuestBio {
  entity: {
    name: string;
    wikipedia_url: string;
    confidence: number;
  };
  profession: string[];
  known_for: GuestBioWork[];
  recent_work: GuestBioWork[];
  conan_connection: {
    type: 'direct' | 'industry' | 'inferred';
    evidence: string;
  };
  description: string;
  confidence: number;
  needs_review: boolean;
  sources: string[];
  enrichedAt: string;
  /** Booking-signal fields — same Wikipedia intro, extracted alongside the rest.
   * All optional/best-effort: absent or "" means "not stated in the intro", not
   * "unknown fact about this person" — never inferred or guessed beyond the text. */
  birth_year?: string;
  /** 4-digit year from an explicit death date in the intro (e.g. "(1950–2020)").
   * Empty/absent means living or not stated — never inferred from tense. */
  death_year?: string;
  /** "male" | "female" | "" — extracted ONLY from pronouns the intro itself
   * uses (he/him, she/her), never inferred from name, profession, or photo. */
  gender?: string;
  /** Nationality/demonym as stated in the intro (e.g. "American", "British") —
   * not a birth-country lookup, just what Wikipedia's own opening sentence says. */
  nationality?: string;
  /** Awards/honors explicitly named in the intro (e.g. "Emmy nominee", "Grammy
   * winner"). Empty array means none stated, not "no awards exist". */
  prestige_signals?: string[];
  /** The single medium the intro emphasizes as their current/primary work. */
  primary_platform?: PrimaryPlatform;
  /** Announced/forward-dated work mentioned in the intro (e.g. "set to appear in
   * the upcoming film X (2026)"). Sparse by nature — Wikipedia ledes are
   * backward-looking by default, so this only catches guests currently being
   * actively updated for a known upcoming release. Empty, not a promise nothing
   * is coming. */
  upcoming_work?: GuestBioWork[];
}

export interface Guest {
  id: string;
  name: string;
  photoUrl: string | null;
  bio?: GuestBio | null;
  origin: {
    type: OriginType;
    label: string;
    confidence: 'high' | 'medium' | 'inferred';
  };
  appearances: Appearance[];
  friendshipScore: number;
  friendshipLabel: FriendshipLabel;
  scoreBreakdown: ScoreBreakdown;
  relatedGuests?: string[];
  mentionedGuests?: string[];
}

export interface GuestsData {
  generatedAt: string;
  totalGuests: number;
  totalAppearances: number;
  guests: Guest[];
}

export interface RawPodcastEpisode {
  title: string;
  pubDate: string;
  description: string;
  link: string;
  enclosure?: { url: string; type: string; length: string };
  itunes?: { image?: string; duration?: string };
  isFanSegment: boolean;
  isStaffEpisode: boolean;
  isSpecial: boolean;
  guestName?: string;
  coldOpenWord?: string;
  coldOpenSentiment?: ColdOpenSentiment;
  isRepeatGuest: boolean;
}

export interface RawLateNightAppearance {
  guestName: string;
  era: Era;
  date: string;
  episodeTitle?: string;
  source: 'tvmaze' | 'wikipedia' | 'imdb' | 'tmdb' | 'known' | 'unknown';
  confidence: 'high' | 'medium' | 'inferred';
}

export interface YouTubeCache {
  [episodeId: string]: {
    videoId: string | null;
    fetchedAt: string;
    score: number;
    confidence?: number;
    channelTitle?: string | null;
  };
}

export interface PhotoCache {
  [guestName: string]: {
    url: string | null;
    fetchedAt: string;
  };
}

export interface OriginCache {
  [guestName: string]: {
    type: OriginType;
    label: string;
    confidence: 'high' | 'medium' | 'inferred';
    fetchedAt: string;
  };
}

export interface SOTUMetric {
  metric: string;
  value: string;
  note: string;
}

// ── Crossed Paths ────────────────────────────────────────────────────────────
// Mirrors scripts/ingest/merge-crossed-paths.ts's output shape exactly — that
// script is the only writer of data/crossed-paths.json. Only one candidate
// tier exists: crossed paths with Conan HIMSELF (his own film/soundtrack/
// personal connections). A second, weaker tier — connected via an existing
// guest's own other credits — has no pipeline yet; never fabricate it here.

export interface ConanActivity {
  title: string;
  type: 'film' | 'tv' | 'hosting' | 'podcast_guest' | 'other';
  year: string;
  role: string;
}

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

export interface SOTURecord {
  id: string;
  title: string;
  source_url: string;
  air_date: string;
  host_episode: string | null;
  segment_type: 'standalone-clip' | 'full-podcast-episode';
  transcript_source: string;
  topics: string[];
  summary: string;
  metrics: SOTUMetric[];
}
