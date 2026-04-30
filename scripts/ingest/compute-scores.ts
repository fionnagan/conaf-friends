import type {
  Guest,
  Appearance,
  FriendshipLabel,
  ColdOpenSentiment,
  OriginType,
} from '../../lib/types';

const SENTIMENT_SCORES: Record<ColdOpenSentiment, number> = {
  warm: 25,
  'affectionate-absurd': 22,
  neutral: 15,
  deflecting: 12,
  anxious: 12,
  callback: 22,
};

const ORIGIN_SCORES: Record<OriginType, number> = {
  'snl-simpsons': 20,
  'harvard-lampoon': 20,
  'comedy-peer': 16,
  'late-night-regular': 14,
  'second-degree': 12,
  'cold-booking': 8,
};

function scoreAppearances(appearances: Appearance[]): number {
  const n = appearances.length;
  let base = 0;
  if (n === 1) base = 6;
  else if (n === 2) base = 12;
  else if (n === 3) base = 18;
  else base = 22;

  // Cross-era bonus
  const eras = new Set(appearances.map((a) => a.era));
  const crossEraBonus = Math.min(4 * (eras.size - 1), 8);

  return Math.min(30, base + crossEraBonus);
}

function scoreColdOpenSentiment(appearances: Appearance[]): number {
  const podcastApps = appearances.filter(
    (a) => a.era === 'podcast' && a.coldOpenSentiment
  );
  if (podcastApps.length === 0) return 15; // baseline for non-podcast

  if (podcastApps.length === 1) {
    return SENTIMENT_SCORES[podcastApps[0].coldOpenSentiment!] ?? 15;
  }

  // Sort by date descending — most recent weighted 60%, earlier 40%
  const sorted = [...podcastApps].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const mostRecent = SENTIMENT_SCORES[sorted[0].coldOpenSentiment!] ?? 15;
  const earlier =
    sorted.slice(1).reduce((sum, a) => {
      return sum + (SENTIMENT_SCORES[a.coldOpenSentiment!] ?? 15);
    }, 0) / (sorted.length - 1);

  return Math.round(mostRecent * 0.6 + earlier * 0.4);
}

function scoreVisitType(appearances: Appearance[]): number {
  if (appearances.length === 0) return 8;
  const promoCount = appearances.filter((a) => a.promoVisit).length;
  const ratio = promoCount / appearances.length;
  if (ratio < 0.25) return 15;
  if (ratio < 0.75) return 12;
  return 8;
}

function scoreGapResilience(appearances: Appearance[]): number {
  if (appearances.length <= 1) return 5;

  const dates = appearances
    .map((a) => new Date(a.date).getTime())
    .sort((a, b) => a - b);

  let maxGapYears = 0;
  for (let i = 1; i < dates.length; i++) {
    const gapYears = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24 * 365);
    if (gapYears > maxGapYears) maxGapYears = gapYears;
  }

  if (maxGapYears < 1) return 6;
  if (maxGapYears < 3) return 8;
  if (maxGapYears < 5) return 9;
  return 10;
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
    originDepth: ORIGIN_SCORES[guest.origin.type] ?? 8,
    visitType: scoreVisitType(guest.appearances),
    gapResilience: scoreGapResilience(guest.appearances),
  };

  const raw =
    breakdown.appearances +
    breakdown.coldOpenSentiment +
    breakdown.originDepth +
    breakdown.visitType +
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
        { era: 'podcast' as const, date: '2020-01-01', promoVisit: false, coldOpenSentiment: 'warm' as const },
        { era: 'podcast' as const, date: '2021-06-01', promoVisit: false, coldOpenSentiment: 'warm' as const },
        { era: 'tbs-conan' as const, date: '2018-01-01', promoVisit: false },
      ],
      originType: 'snl-simpsons' as OriginType,
    },
    {
      name: 'Honored Guest (single appearance, neutral)',
      appearances: [
        { era: 'podcast' as const, date: '2022-05-01', promoVisit: true, coldOpenSentiment: 'neutral' as const },
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
