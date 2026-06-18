import type {
  Guest,
  Appearance,
  FriendshipLabel,
  ColdOpenSentiment,
  OriginType,
} from '../../lib/types';

// Weights were redistributed after removing the "visitType" (promoVisit-based)
// component — its 15 points were spread proportionally across the remaining
// four so the max total stays 100: appearances 30→35, coldOpenSentiment 25→30,
// originDepth 20→23, gapResilience 10→12.

const SENTIMENT_SCORES: Record<ColdOpenSentiment, number> = {
  warm: 30,
  'affectionate-absurd': 26,
  neutral: 18,
  deflecting: 14,
  anxious: 14,
  callback: 26,
};

const ORIGIN_SCORES: Record<OriginType, number> = {
  'snl-simpsons': 23,
  'harvard-lampoon': 23,
  'comedy-peer': 18,
  'late-night-regular': 16,
  'second-degree': 14,
  'cold-booking': 9,
};

function scoreAppearances(appearances: Appearance[]): number {
  const n = appearances.length;
  let base = 0;
  if (n === 1) base = 7;
  else if (n === 2) base = 14;
  else if (n === 3) base = 21;
  else base = 26;

  // Cross-era bonus
  const eras = new Set(appearances.map((a) => a.era));
  const crossEraBonus = Math.min(5 * (eras.size - 1), 9);

  return Math.min(35, base + crossEraBonus);
}

function scoreColdOpenSentiment(appearances: Appearance[]): number {
  const podcastApps = appearances.filter(
    (a) => a.era === 'podcast' && a.coldOpenSentiment
  );
  if (podcastApps.length === 0) return 18; // baseline for non-podcast

  if (podcastApps.length === 1) {
    return SENTIMENT_SCORES[podcastApps[0].coldOpenSentiment!] ?? 18;
  }

  // Sort by date descending — most recent weighted 60%, earlier 40%
  const sorted = [...podcastApps].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const mostRecent = SENTIMENT_SCORES[sorted[0].coldOpenSentiment!] ?? 18;
  const earlier =
    sorted.slice(1).reduce((sum, a) => {
      return sum + (SENTIMENT_SCORES[a.coldOpenSentiment!] ?? 18);
    }, 0) / (sorted.length - 1);

  return Math.round(mostRecent * 0.6 + earlier * 0.4);
}

function scoreGapResilience(appearances: Appearance[]): number {
  if (appearances.length <= 1) return 6;

  const dates = appearances
    .map((a) => new Date(a.date).getTime())
    .sort((a, b) => a - b);

  let maxGapYears = 0;
  for (let i = 1; i < dates.length; i++) {
    const gapYears = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24 * 365);
    if (gapYears > maxGapYears) maxGapYears = gapYears;
  }

  if (maxGapYears < 1) return 7;
  if (maxGapYears < 3) return 10;
  if (maxGapYears < 5) return 11;
  return 12;
}

function getFriendshipLabel(score: number): FriendshipLabel {
  if (score >= 90) return 'Inner Circle';
  if (score >= 80) return 'Genuine Friend';
  if (score >= 70) return 'Trusted Confidant';
  if (score >= 60) return 'Comedy Soulmate';
  if (score >= 50) return 'Beloved Acquaintance';
  if (score >= 40) return 'Cherished Visitor';
  return 'Honored Guest';
}

export function computeScore(guest: Omit<Guest, 'friendshipScore' | 'friendshipLabel' | 'scoreBreakdown'>): {
  friendshipScore: number;
  friendshipLabel: FriendshipLabel;
  scoreBreakdown: Guest['scoreBreakdown'];
} {
  const breakdown = {
    appearances: scoreAppearances(guest.appearances),
    coldOpenSentiment: scoreColdOpenSentiment(guest.appearances),
    originDepth: ORIGIN_SCORES[guest.origin.type] ?? 9,
    gapResilience: scoreGapResilience(guest.appearances),
  };

  const raw =
    breakdown.appearances +
    breakdown.coldOpenSentiment +
    breakdown.originDepth +
    breakdown.gapResilience;

  const friendshipScore = Math.min(100, Math.max(35, Math.round(raw)));
  const friendshipLabel = getFriendshipLabel(friendshipScore);

  return { friendshipScore, friendshipLabel, scoreBreakdown: breakdown };
}

if (require.main === module) {
  // Self-test
  const testCases = [
    {
      name: 'Inner Circle (many appearances, warm)',
      appearances: [
        { era: 'podcast' as const, date: '2020-01-01', coldOpenSentiment: 'warm' as const },
        { era: 'podcast' as const, date: '2021-06-01', coldOpenSentiment: 'warm' as const },
        { era: 'tbs-conan' as const, date: '2018-01-01' },
      ],
      originType: 'snl-simpsons' as OriginType,
    },
    {
      name: 'Honored Guest (single appearance, neutral)',
      appearances: [
        { era: 'podcast' as const, date: '2022-05-01', coldOpenSentiment: 'neutral' as const },
      ],
      originType: 'cold-booking' as OriginType,
    },
  ];

  for (const tc of testCases) {
    const result = computeScore({
      id: 'test',
      name: tc.name,
      photoUrl: null,
      origin: { type: tc.originType, label: '', confidence: 'high' },
      appearances: tc.appearances as Appearance[],
    });
    console.log(`${tc.name}: ${result.friendshipScore} (${result.friendshipLabel})`);
    console.log(`  Breakdown:`, result.scoreBreakdown);
  }
}
