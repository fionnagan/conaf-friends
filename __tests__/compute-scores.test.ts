import { computeScore } from '../scripts/ingest/compute-scores';
import type { Appearance, OriginType } from '../lib/types';

function makeAppearance(overrides: Partial<Appearance>): Appearance {
  return {
    era: 'podcast',
    date: '2022-01-01',
    promoVisit: false,
    ...overrides,
  };
}

function makeGuest(
  appearances: Appearance[],
  originType: OriginType = 'cold-booking'
) {
  return {
    id: 'test',
    name: 'Test Guest',
    photoUrl: null,
    origin: { type: originType, label: 'Test', confidence: 'high' as const },
    appearances,
  };
}

describe('computeScore', () => {
  describe('floor and cap', () => {
    it('never goes below 35', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'deflecting', promoVisit: true }),
      ]);
      const { friendshipScore } = computeScore(guest);
      expect(friendshipScore).toBeGreaterThanOrEqual(35);
    });

    it('never exceeds 100', () => {
      const guest = makeGuest(
        [
          makeAppearance({ era: 'podcast', coldOpenSentiment: 'warm', promoVisit: false }),
          makeAppearance({ era: 'podcast', coldOpenSentiment: 'warm', promoVisit: false, date: '2023-01-01' }),
          makeAppearance({ era: 'tbs-conan', coldOpenSentiment: 'warm', promoVisit: false, date: '2019-01-01' }),
          makeAppearance({ era: 'late-night-nbc', promoVisit: false, date: '2005-01-01' }),
          makeAppearance({ era: 'late-night-nbc', promoVisit: false, date: '2006-01-01' }),
        ],
        'snl-simpsons'
      );
      const { friendshipScore } = computeScore(guest);
      expect(friendshipScore).toBeLessThanOrEqual(100);
    });
  });

  describe('friendship labels', () => {
    it('assigns "Honored Guest" for low-scoring single appearance', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'deflecting', promoVisit: true }),
      ], 'cold-booking');
      const { friendshipLabel } = computeScore(guest);
      expect(['Honored Guest', 'Cherished Visitor']).toContain(friendshipLabel);
    });

    it('assigns "Inner Circle" for top guests', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'warm', promoVisit: false }),
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'warm', promoVisit: false, date: '2020-01-01' }),
        makeAppearance({ era: 'tbs-conan', promoVisit: false, date: '2015-01-01' }),
        makeAppearance({ era: 'late-night-nbc', promoVisit: false, date: '2000-01-01' }),
      ], 'snl-simpsons');
      const { friendshipScore, friendshipLabel } = computeScore(guest);
      expect(friendshipScore).toBeGreaterThanOrEqual(80);
      expect(['Inner Circle', 'Genuine Friend']).toContain(friendshipLabel);
    });
  });

  describe('appearance scoring', () => {
    it('gives 6 pts for 1 appearance', () => {
      const base = makeGuest([makeAppearance({})], 'cold-booking');
      // Origin (cold-booking=8) + appearances (1=6) + visitType + sentiment + gap
      const { scoreBreakdown } = computeScore(base);
      expect(scoreBreakdown.appearances).toBe(6);
    });

    it('gives 12 pts for 2 appearances', () => {
      const guest = makeGuest([
        makeAppearance({ date: '2021-01-01' }),
        makeAppearance({ date: '2022-01-01' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.appearances).toBe(12);
    });

    it('gives cross-era bonus', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', date: '2020-01-01' }),
        makeAppearance({ era: 'tbs-conan', date: '2018-01-01' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      // 2 appearances = 12 + 1 cross-era bonus of 4 = 16
      expect(scoreBreakdown.appearances).toBe(16);
    });

    it('caps cross-era bonus so appearances ≤ 30', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', date: '2020-01-01' }),
        makeAppearance({ era: 'tbs-conan', date: '2018-01-01' }),
        makeAppearance({ era: 'late-night-nbc', date: '2005-01-01' }),
        makeAppearance({ era: 'tonight-show', date: '2009-06-01' }),
        makeAppearance({ era: 'conan-must-go', date: '2023-06-01' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.appearances).toBeLessThanOrEqual(30);
    });
  });

  describe('cold open sentiment', () => {
    it('gives 25 for warm sentiment', () => {
      const guest = makeGuest([
        makeAppearance({ coldOpenSentiment: 'warm' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.coldOpenSentiment).toBe(25);
    });

    it('gives 12 for deflecting', () => {
      const guest = makeGuest([
        makeAppearance({ coldOpenSentiment: 'deflecting' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.coldOpenSentiment).toBe(12);
    });

    it('weights most recent 60%, earlier 40% for repeat guests', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'deflecting', date: '2020-01-01' }),
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'warm', date: '2022-01-01' }), // most recent
      ]);
      const { scoreBreakdown } = computeScore(guest);
      // warm(25) * 0.6 + deflecting(12) * 0.4 = 15 + 4.8 = 19.8 ≈ 20
      expect(scoreBreakdown.coldOpenSentiment).toBe(20);
    });
  });

  describe('origin depth', () => {
    it('gives 20 for snl-simpsons', () => {
      const guest = makeGuest([makeAppearance({})], 'snl-simpsons');
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.originDepth).toBe(20);
    });

    it('gives 8 for cold-booking', () => {
      const guest = makeGuest([makeAppearance({})], 'cold-booking');
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.originDepth).toBe(8);
    });
  });

  describe('visit type', () => {
    it('gives 15 for non-promo visit', () => {
      const guest = makeGuest([makeAppearance({ promoVisit: false })]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.visitType).toBe(15);
    });

    it('gives 8 for pure promo visit', () => {
      const guest = makeGuest([makeAppearance({ promoVisit: true })]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.visitType).toBe(8);
    });
  });

  describe('gap resilience', () => {
    it('gives 5 for single appearance', () => {
      const guest = makeGuest([makeAppearance({})]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.gapResilience).toBe(5);
    });

    it('gives 10 for 5+ year gap', () => {
      const guest = makeGuest([
        makeAppearance({ date: '2010-01-01' }),
        makeAppearance({ date: '2016-01-01' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.gapResilience).toBe(10);
    });

    it('gives 6 for gap < 1 year', () => {
      const guest = makeGuest([
        makeAppearance({ date: '2022-01-01' }),
        makeAppearance({ date: '2022-08-01' }),
      ]);
      const { scoreBreakdown } = computeScore(guest);
      expect(scoreBreakdown.gapResilience).toBe(6);
    });
  });

  describe('score breakdown sum', () => {
    it('score equals sum of breakdown factors (before floor/cap)', () => {
      const guest = makeGuest([
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'warm', promoVisit: false }),
        makeAppearance({ era: 'podcast', coldOpenSentiment: 'neutral', promoVisit: false, date: '2023-01-01' }),
      ], 'comedy-peer');
      const { friendshipScore, scoreBreakdown } = computeScore(guest);
      const sum = Object.values(scoreBreakdown).reduce((a, b) => a + b, 0);
      // After floor/cap, score should equal min(100, max(35, sum))
      expect(friendshipScore).toBe(Math.min(100, Math.max(35, Math.round(sum))));
    });
  });
});
