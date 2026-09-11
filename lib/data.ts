import type { Guest, GuestsData, FriendshipLabel, Era, CrossedPathsData } from './types';

export const ERA_LABELS: Record<Era, string> = {
  'late-night-nbc': 'Late Night NBC',
  'tonight-show': 'Tonight Show',
  'tbs-conan': 'Conan',
  'podcast': 'Needs a Friend',
  'conan-must-go': 'Conan Must Go',
};

export const ERA_YEARS: Record<Era, string> = {
  'late-night-nbc': '1993–2009',
  'tonight-show': '2009–2010',
  'tbs-conan': '2010–2021',
  'podcast': '2018–present',
  'conan-must-go': '2023–present',
};

export const TIER_COLORS: Record<FriendshipLabel, string> = {
  'Inner Circle': '#7F77DD',
  'Genuine Friend': '#6B63CC',
  'Trusted Confidant': '#3AAFA9',
  'Comedy Soulmate': '#2A8C86',
  'Beloved Acquaintance': '#E85D24',
  'Cherished Visitor': '#C4521E',
  'Honored Guest': '#D4A847',
};

export const TIER_CSS: Record<FriendshipLabel, string> = {
  'Inner Circle': 'tier-inner-circle',
  'Genuine Friend': 'tier-genuine-friend',
  'Trusted Confidant': 'tier-trusted-confidant',
  'Comedy Soulmate': 'tier-comedy-soulmate',
  'Beloved Acquaintance': 'tier-beloved-acquaintance',
  'Cherished Visitor': 'tier-cherished-visitor',
  'Honored Guest': 'tier-honored-guest',
};

export const ORIGIN_LABELS: Record<string, string> = {
  'snl-simpsons': 'SNL / Simpsons era',
  'harvard-lampoon': 'Harvard Lampoon',
  'comedy-peer': 'Comedy peer',
  'late-night-regular': 'Late Night regular',
  'second-degree': 'Friend of a friend',
  'cold-booking': 'Cold booking',
};

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function getAvatarColor(name: string): string {
  const colors = [
    '#7F77DD', '#E85D24', '#3AAFA9', '#D4A847',
    '#6B63CC', '#C4521E', '#2A8C86', '#B8952B',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function formatDate(dateStr: string): string {
  try {
    // Appearance dates are plain calendar dates (YYYY-MM-DD). `new Date("2008-03-21")`
    // parses as UTC midnight, so formatting in the viewer's local zone (e.g. the
    // Americas) would roll back to the previous day. Format in UTC so the stored
    // calendar date is what's shown, everywhere.
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

export function getTodayAnniversaries(guests: Guest[]): Guest[] {
  const today = new Date();
  const mm = today.getMonth() + 1;
  const dd = today.getDate();

  return guests.filter((g) =>
    g.appearances.some((a) => {
      // Read the stored calendar date in UTC (it's parsed as UTC midnight), so
      // "on this day" matches the real broadcast date rather than a tz-shifted one.
      const d = new Date(a.date);
      return d.getUTCMonth() + 1 === mm && d.getUTCDate() === dd;
    })
  );
}

// Band fill colors — dark base tints derived from logo primaries
export function getEraColor(era: Era): string {
  const map: Record<Era, string> = {
    'late-night-nbc': '#050B20', // dark navy from oval logo
    'tonight-show':   '#1A1200', // dark gold
    'tbs-conan':      '#1A0800', // dark orange
    'podcast':        '#1A0900', // dark orange (slightly warmer)
    'conan-must-go':  '#1A060E', // dark rose
  };
  return map[era];
}

// Dot / label colors — extracted directly from era logos
export function getEraTextColor(era: Era): string {
  const map: Record<Era, string> = {
    'late-night-nbc': '#4872D8', // brightened from oval blue #262A89
    'tonight-show':   '#D4B020', // subdued from gold text #FDDD3E
    'tbs-conan':      '#F26519', // exact from TBS Conan SVG .st1
    'podcast':        '#FC7604', // exact from podcast cover orange text
    'conan-must-go':  '#D45085', // rose — no official logo provided
  };
  return map[era];
}

// Logo image paths for each era
export const ERA_LOGOS: Partial<Record<Era, string>> = {
  'late-night-nbc': '/logos/era-late-night-nbc.png',
  'tonight-show':   '/logos/era-tonight-show.png',
  'tbs-conan':      '/logos/era-tbs-conan.svg',
  'podcast':        '/logos/era-podcast.jpg',
  'conan-must-go':  '/conanmustgologo.png',
};

let _cachedData: GuestsData | null = null;

export function getGuestsData(): GuestsData {
  if (_cachedData) return _cachedData;
  // This will be called server-side in Next.js
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data = require('../data/guests.json') as GuestsData;
    _cachedData = data;
    return data;
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      totalGuests: 0,
      totalAppearances: 0,
      guests: [],
    };
  }
}

let _cachedCrossedPaths: CrossedPathsData | null = null;

// data/crossed-paths.json is written by the weekly-ingest cron's merge step
// (scripts/ingest/merge-crossed-paths.ts) — it won't exist until that job has
// actually run at least once, so this must fall back to an empty structure
// exactly like getGuestsData() does, not throw.
export function getCrossedPathsData(): CrossedPathsData {
  if (_cachedCrossedPaths) return _cachedCrossedPaths;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data = require('../data/crossed-paths.json') as CrossedPathsData;
    _cachedCrossedPaths = data;
    return data;
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      conanActivity: [],
      guestCrossings: {},
      neverBookedCandidates: [],
    };
  }
}

// Profession is a real, if sparse, signal. Bucket the raw Wikipedia
// profession text into readable categories, first match wins. Matched as
// substrings of the guest's joined profession text rather than exact array
// entries — some bios came through a regex fallback pipeline that captured
// prose fragments (e.g. "actor best known for portraying...") instead of
// clean single words, and substring matching still buckets those correctly
// instead of dumping them in "Other". Shared by the Roundup and Explorer
// pages so a guest's profession category is identical wherever it's shown.
// Athlete is checked first, ahead of Comedian/Actor/etc. Bucketing works by
// joining a guest's ENTIRE profession list into one blob and taking the
// first bucket (in this array's order) whose keyword appears anywhere in it
// — so a guest's incidental, secondary professions can out-rank their real,
// defining one if that secondary bucket happens to sit earlier in this list.
// Confirmed for real: Shaquille O'Neal ("professional basketball player,
// sports analyst, rapper, ..., actor, ...") was landing in "Actor" purely
// because "actor" is a keyword and Actor used to be checked before Athlete,
// even though "professional basketball player" — his own first-listed,
// defining profession — was sitting right there. Same bug hit Magic Johnson,
// Dennis Rodman, Hulk Hogan, Kareem Abdul-Jabbar, and 20+ other guests whose
// athletic career is what actually got them booked.
// Deliberately NOT fixed by switching to "check each guest's own profession
// array in order, first match wins" instead of reordering the bucket list —
// that alternative was tried and rejected: it reshuffled 626 other guests
// site-wide, because Wikipedia's lead-sentence convention often states
// "is an American actor, comedian, ..." for people primarily known here as
// comedians (Adam Sandler, Tina Fey, Seth Rogen, ...), flipping their bucket
// from Comedian to Actor — a real regression for this site's own editorial
// framing, not a fix. Moving Athlete to the front is the surgical version:
// it only changes guests whose profession blob contains an athletic-career
// keyword at all (41 guests), and every one of those changes is a guest
// whose sport is arguably their most defining trait.
export const PROFESSION_BUCKETS: [string, string[]][] = [
  ["Athlete", ["athlete", "basketball", "football", "wrestler", "boxer"]],
  ["Comedian", ["comedian", "stand-up"]],
  ["Actor", ["actor", "actress"]],
  ["Musician", ["musician", "singer", "songwriter", "rapper", "composer"]],
  ["Filmmaker", ["filmmaker", "director", "producer", "animator", "cartoonist"]],
  ["Writer", ["writer", "screenwriter", "author"]],
  [
    "Media / TV host",
    [
      "television host", "television presenter", "television personality",
      "radio host", "podcaster", "journalist", "media personality",
      "political commentator", "broadcast",
    ],
  ],
];

export const PROFESSION_CATEGORY_ORDER = [...PROFESSION_BUCKETS.map(([label]) => label), "Other"];

export function bucketProfession(professions: string[] | undefined): string | null {
  if (!professions || professions.length === 0) return null;
  const joined = professions.join(" ").toLowerCase();
  for (const [label, keys] of PROFESSION_BUCKETS) {
    if (keys.some((k) => joined.includes(k))) return label;
  }
  return "Other";
}

export type Generation = 'Gen Z' | 'Millennial' | 'Gen X' | 'Boomer+';

// Computed on the fly from bio.birth_year, never stored — same ranges the
// Roundup page uses for its own (differently-labeled) generation buckets, so
// the two pages agree on where the lines fall.
export function getGeneration(birthYear: number): Generation | null {
  if (!Number.isFinite(birthYear)) return null;
  if (birthYear >= 1997) return 'Gen Z';
  if (birthYear >= 1981) return 'Millennial';
  if (birthYear >= 1965) return 'Gen X';
  return 'Boomer+';
}

// "3 years ago", "last month", etc. — appearance dates are plain calendar
// dates (YYYY-MM-DD), so this compares against UTC midnight today to match
// formatDate's UTC handling and avoid a viewer-timezone off-by-one.
export function formatTimeAgo(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'upcoming';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  // Derive years from months (not days/365 separately) so the two units
  // agree at the boundary — days 360-364 give months=12, which must map to
  // "1 year ago" here rather than falling through to a mismatched
  // days-based years=floor(364/365)=0.
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export type Recency = 'This year' | '1–3 years ago' | '3–10 years ago' | '10+ years ago';
export const RECENCY_BUCKETS: Recency[] = ['This year', '1–3 years ago', '3–10 years ago', '10+ years ago'];

// Bucketed from the same day math as formatTimeAgo, off the guest's most
// recent appearance — an "upcoming" (future-dated) appearance counts as
// This year rather than falling through with a negative day count.
export function getRecency(mostRecentDateStr: string): Recency {
  const then = new Date(mostRecentDateStr).getTime();
  const days = Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
  const years = days / 365;
  if (years < 1) return 'This year';
  if (years < 3) return '1–3 years ago';
  if (years < 10) return '3–10 years ago';
  return '10+ years ago';
}
