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
  episodeTitle?: string;
  episodeUrl?: string;
  audioUrl?: string;
  youtubeVideoId?: string | null;
  promoVisit: boolean;
  coldOpenWord?: string;
  coldOpenSentiment?: ColdOpenSentiment;
  artworkUrl?: string;
}

export interface ScoreBreakdown {
  appearances: number;
  coldOpenSentiment: number;
  originDepth: number;
  visitType: number;
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
  type: 'film' | 'tv' | 'podcast' | 'other';
  year: string;
}

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
  source: 'wikipedia' | 'imdb' | 'unknown';
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
