import { bucketProfession } from '../lib/data';

describe('bucketProfession', () => {
  it('buckets a guest whose defining career is athletic, even with incidental entertainment credits', () => {
    // Real case: Shaquille O'Neal's profession list is
    // ["professional basketball player", "sports analyst", "rapper", ...,
    // "actor", ...] — before Athlete was checked first, the mere presence of
    // "actor" anywhere in the joined list bucketed him as an Actor.
    expect(
      bucketProfession(['professional basketball player', 'sports analyst', 'rapper', 'actor'])
    ).toBe('Athlete');
  });

  it('still buckets a genuine actor-comedian as Comedian, not Athlete', () => {
    expect(bucketProfession(['actor', 'comedian'])).toBe('Comedian');
  });

  it('buckets a wrestler-turned-actor as Athlete', () => {
    expect(bucketProfession(['professional wrestler', 'actor', 'businessman'])).toBe('Athlete');
  });

  it('falls back to Other when nothing matches', () => {
    expect(bucketProfession(['chef'])).toBe('Other');
  });

  it('returns null for an empty or missing profession list', () => {
    expect(bucketProfession([])).toBeNull();
    expect(bucketProfession(undefined)).toBeNull();
  });
});
