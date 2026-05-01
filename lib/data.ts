import type { Guest, GuestsData, FriendshipLabel, Era } from './types';

export const ERA_LABELS: Record<Era, string> = {
  'late-night-nbc': 'Late Night NBC',
  'tonight-show': 'Tonight Show',
  'tbs-conan': 'Conan (TBS)',
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
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
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
      const d = new Date(a.date);
      return d.getMonth() + 1 === mm && d.getDate() === dd;
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
