import { merge } from '../scripts/ingest/merge';
import type { RawPodcastEpisode, RawLateNightAppearance } from '../lib/types';

// Regression coverage for a real needs_review-tail finding: some raw
// "guests" aren't individual people at all — a recurring bit/segment
// title ("Conan Scrapisode"), a show credited as if it were the guest
// ("The Walking Dead"), a group ("Denver Broncos Offensive Line"), or a
// memorial episode's title parsed as a guest name ("Remembering Paul
// Reubens"). No Wikipedia lookup will ever resolve these. Confirmed
// against the real scripts/ingest/excluded-guest-names.json denylist this
// test exercises, not a synthetic one, so a future edit to that file is
// covered by this test without needing an update here too.

function podcastEpisode(overrides: Partial<RawPodcastEpisode> = {}): RawPodcastEpisode {
  return {
    title: 'Test Episode',
    pubDate: '2023-01-01T00:00:00Z',
    description: '',
    link: 'https://example.com/ep',
    isFanSegment: false,
    isStaffEpisode: false,
    isSpecial: false,
    isRepeatGuest: false,
    guestName: 'Real Guest',
    ...overrides,
  };
}

function lateNightAppearance(overrides: Partial<RawLateNightAppearance> = {}): RawLateNightAppearance {
  return {
    guestName: 'Real Guest',
    era: 'late-night-nbc',
    date: '1996-01-01',
    source: 'wikipedia',
    confidence: 'high',
    ...overrides,
  };
}

describe('merge() — excluded non-person guest names', () => {
  it('never creates a guest from an excluded podcast episode guestName', () => {
    const data = merge(
      [podcastEpisode({ guestName: 'Remembering Paul Reubens' })],
      [],
      {},
      {},
      {}
    );
    expect(data.guests.find((g) => g.name === 'Remembering Paul Reubens')).toBeUndefined();
    expect(data.guests.length).toBe(0);
  });

  it('never creates a guest from an excluded lateNightHistory guestName', () => {
    const data = merge(
      [],
      [lateNightAppearance({ guestName: 'Denver Broncos Offensive Line' })],
      {},
      {},
      {}
    );
    expect(data.guests.find((g) => g.name === 'Denver Broncos Offensive Line')).toBeUndefined();
    expect(data.guests.length).toBe(0);
  });

  it('still creates a real, non-excluded guest normally (sanity check)', () => {
    const data = merge(
      [],
      [lateNightAppearance({ guestName: 'Tom Hanks' })],
      {},
      {},
      {}
    );
    expect(data.guests.find((g) => g.name === 'Tom Hanks')).toBeDefined();
  });

  it('assigns billing order to real guests skipping over an excluded entry, not leaving a gap', () => {
    const data = merge(
      [],
      [
        lateNightAppearance({ guestName: 'Conan Scrapisode', era: 'tbs-conan', date: '2020-01-01' }),
        lateNightAppearance({ guestName: 'Tom Hanks', era: 'tbs-conan', date: '2020-01-01' }),
      ],
      {},
      {},
      {}
    );
    const tomHanks = data.guests.find((g) => g.name === 'Tom Hanks');
    expect(tomHanks).toBeDefined();
    expect(tomHanks!.appearances[0].order).toBe(0);
  });
});
