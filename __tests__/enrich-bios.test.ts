import {
  extractBirthYear,
  extractDeathYear,
  extractGender,
  extractNationality,
  extractKnownFor,
  extractRecentWork,
  validate,
  runClaudePipeline,
  resolveEntityWithRetry,
  shouldEnqueueGuest,
  isTotalChunkFailure,
  tokenOverlap,
  normNameTokens,
} from '../scripts/ingest/enrich-bios';
import { checkDeathYearPlausibility } from '../scripts/ingest/booking-signal-schema';
import type { GuestBio, Guest } from '../lib/types';
import * as wiki from '../scripts/ingest/wiki';

jest.mock('../scripts/ingest/wiki', () => ({
  ...jest.requireActual('../scripts/ingest/wiki'),
  fetchWikiEntity: jest.fn(),
  fetchDisambiguationLinks: jest.fn(),
}));
const mockedFetchWikiEntity = wiki.fetchWikiEntity as jest.Mock;
const mockedFetchDisambiguationLinks = wiki.fetchDisambiguationLinks as jest.Mock;

function makeBio(overrides: Partial<GuestBio> = {}): GuestBio {
  return {
    entity: { name: 'Test Guest', wikipedia_url: 'https://en.wikipedia.org/wiki/Test_Guest', confidence: 1 },
    profession: ['actor'],
    known_for: [],
    recent_work: [],
    conan_connection: { type: 'inferred', evidence: 'Appeared on the show.' },
    // 80 words — passes the word-count check on its own so each test below
    // only exercises the specific rule it targets.
    description: Array(80).fill('word').join(' '),
    confidence: 1,
    needs_review: false,
    sources: [],
    enrichedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('validate() — death_year plausibility guardrail', () => {
  // Regression coverage for the real claude-haiku-4-5-20251001 A/B test
  // failure: 4 of 5 living guests got a fabricated death_year. This is the
  // exact case that guardrail exists to catch.
  it('rejects a death_year with no birth_year (Joseph Gordon-Levitt / Selma Blair pattern)', () => {
    const result = validate(makeBio({ birth_year: '', death_year: '1992' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('death_year_without_birth_year');
  });

  it('rejects a death_year before birth_year (impossible)', () => {
    const result = validate(makeBio({ birth_year: '2009', death_year: '1976' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('death_year_before_birth_year');
  });

  it('rejects a death_year equal to birth_year (impossible)', () => {
    const result = validate(makeBio({ birth_year: '1976', death_year: '1976' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('death_year_before_birth_year');
  });

  it('rejects a death_year in the future', () => {
    const result = validate(makeBio({ birth_year: '1976', death_year: '2099' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('death_year_in_future');
  });

  it('accepts a living guest (birth_year set, death_year empty) — Russell Brand pattern', () => {
    const result = validate(makeBio({ birth_year: '1975', death_year: '' }));
    expect(result.ok).toBe(true);
  });

  it('accepts a legitimately deceased guest with a plausible year range', () => {
    // Real data from this repo's cache: Bob Newhart (1929-2024).
    const result = validate(makeBio({ birth_year: '1929', death_year: '2024' }));
    expect(result.ok).toBe(true);
  });

  it('does not reject when both fields are empty (unknown, not implausible)', () => {
    const result = validate(makeBio({ birth_year: '', death_year: '' }));
    expect(result.ok).toBe(true);
  });

  // Honest limitation, documented in the guardrail's own comment: a
  // numerically plausible but simply WRONG death_year (correct birth_year,
  // incorrect but in-range death_year — the actual Nick Swardson/Seann
  // William Scott failure shape) cannot be caught by structural validation
  // alone. This test documents that limitation explicitly rather than
  // leaving it as an untested assumption.
  it('cannot catch a numerically plausible but factually wrong death_year (documented limitation)', () => {
    // Nick Swardson: born 1976 (correct), Haiku hallucinated death_year 2009
    // (actually the end-year of his Reno 911! run) — passes structural
    // validation because 2009 > 1976 and isn't in the future.
    const result = validate(makeBio({ birth_year: '1976', death_year: '2009' }));
    expect(result.ok).toBe(true);
  });
});

describe('validate() — word count and stale work checks', () => {
  it('rejects a description under 20 words', () => {
    const result = validate(makeBio({ description: 'Too short.' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('word_count');
  });

  it('rejects a description over 160 words', () => {
    const result = validate(makeBio({ description: Array(161).fill('word').join(' ') }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('word_count');
  });

  it('rejects recent_work with a stale year (older than the cutoff)', () => {
    const result = validate(makeBio({ recent_work: [{ title: 'Old Show', type: 'tv', year: '2015' }] }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('stale_recent_work');
  });

  it('rejects upcoming_work with a year already in the past', () => {
    const result = validate(makeBio({ upcoming_work: [{ title: 'Old Project', type: 'film', year: '2020' }] }));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('stale_upcoming_work');
  });
});

describe('extractBirthYear()', () => {
  it('extracts a US-format date (Month Day, Year)', () => {
    expect(extractBirthYear('Steve Zahn (born November 13, 1967) is an American actor.')).toBe('1967');
  });

  it('extracts a UK/international-format date (Day Month Year)', () => {
    expect(extractBirthYear('Russell Brand (born 4 June 1975) is an English comedian.')).toBe('1975');
  });

  it('extracts a bare year with no full date', () => {
    expect(extractBirthYear('Someone (born 1980) is an actor.')).toBe('1980');
  });

  it('returns empty string when no birth clause is present', () => {
    expect(extractBirthYear('Someone is an American actor known for many roles.')).toBe('');
  });
});

describe('extractDeathYear()', () => {
  it('extracts an explicit "died YYYY" statement', () => {
    expect(extractDeathYear('Chris Farley (born 1964) was an American actor. He died 1997 of an overdose.')).toBe('1997');
  });

  it('extracts the second year in a birth-death date range', () => {
    expect(extractDeathYear('Bob Newhart (September 5, 1929 – July 18, 2024) was an American comedian.')).toBe('2024');
  });

  it('extracts from a bare year range', () => {
    expect(extractDeathYear('Someone (1930–2010) was a musician.')).toBe('2010');
  });

  it('returns empty string for a living person (no death date stated)', () => {
    expect(extractDeathYear('Russell Brand (born 1975) is an English comedian.')).toBe('');
  });

  it('does not infer death from past-tense wording alone', () => {
    // "was" is past tense but no explicit death date is stated — must not extract.
    expect(extractDeathYear('Someone (born 1975) was previously a talk show host.')).toBe('');
  });
});

describe('extractGender()', () => {
  it('detects male from he/him/his pronoun dominance', () => {
    expect(extractGender('He is an actor. His career began in his twenties. He works in film.')).toBe('male');
  });

  it('detects female from she/her/hers pronoun dominance', () => {
    expect(extractGender('She is an actress. Her career began early. She works in television.')).toBe('female');
  });

  it('returns empty string when no pronouns are present', () => {
    expect(extractGender('An accomplished actor known for many roles.')).toBe('');
  });
});

describe('extractNationality()', () => {
  it('extracts the demonym before a profession word', () => {
    expect(extractNationality('Selma Blair is an American actress known for Cruel Intentions.')).toBe('American');
  });

  it('returns empty string when no nationality is stated', () => {
    expect(extractNationality('A talented performer with a long career.')).toBe('');
  });
});

describe('extractKnownFor()', () => {
  it('extracts an unquoted "Title (year)" work', () => {
    const works = extractKnownFor('He starred in Employee of the Month (2006), a comedy film.');
    expect(works.some(w => w.title === 'Employee of the Month' && w.year === '2006')).toBe(true);
  });

  it('deduplicates repeated titles', () => {
    const works = extractKnownFor('Reno 911! (2003) was his breakout role. Reno 911! (2003) remains iconic.');
    expect(works.filter(w => w.title === 'Reno 911!')).toHaveLength(1);
  });
});

describe('extractRecentWork()', () => {
  const CURRENT_YEAR = new Date().getFullYear();
  const RECENT = String(new Date().getFullYear());
  const STALE = String(new Date().getFullYear() - 10);

  it('includes a work within the recent-work cutoff window', () => {
    const works = extractRecentWork(`He appeared in Only Murders in the Building (${RECENT}), a hit series.`);
    expect(works.some(w => w.year === RECENT)).toBe(true);
  });

  it('excludes a work older than the cutoff window', () => {
    const works = extractRecentWork(`He appeared in Some Old Show (${STALE}), a series from a decade ago.`);
    expect(works.some(w => w.year === STALE)).toBe(false);
  });
});

// ── runClaudePipeline() — mocked Anthropic client ──────────────────────────
// These functions were the exact source of this session's real bugs (the
// known_for/recent_work duplicate-rejection bug, the death_year hallucination
// incident) — verified only via throwaway offline scripts, written and
// deleted, every time this session. Permanent coverage now.

function makeMockClient(responseText: string) {
  return { messages: { create: jest.fn().mockResolvedValue({ content: [{ text: responseText }] }) } };
}

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 'test-guest',
    name: 'Test Guest',
    photoUrl: null,
    origin: { type: 'comedy-peer', label: 'Stand-up circuit contemporary.', confidence: 'high' },
    appearances: [{ era: 'tbs-conan', date: '2015-03-01' }],
    ...overrides,
  } as Guest;
}

const testEntity = {
  name: 'Test Guest',
  wikipedia_url: 'https://en.wikipedia.org/wiki/Test_Guest',
  intro: 'Test Guest (born January 1, 1970) is an American actor and comedian.',
  confidence: 0.9,
};

const testConanConn = { type: 'industry' as const, evidence: 'Stand-up circuit contemporary.' };

const validClaudeResponse = (overrides: Record<string, any> = {}) => JSON.stringify({
  profession: ['actor', 'comedian'],
  known_for: [{ title: 'Employee of the Month', type: 'film', year: '2006' }],
  recent_work: [],
  upcoming_work: [],
  birth_year: '1970',
  death_year: '',
  gender: 'male',
  nationality: 'American',
  prestige_signals: [],
  primary_platform: 'tv',
  conan_mentions: [],
  description: Array(80).fill('word').join(' '),
  ...overrides,
});

describe('runClaudePipeline() — mocked Anthropic client', () => {
  it('returns null when the response is not valid JSON', async () => {
    const client = makeMockClient('not valid json at all');
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio).toBeNull();
  });

  it('returns null when the description word count is out of bounds', async () => {
    const client = makeMockClient(validClaudeResponse({ description: 'Too short.' }));
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio).toBeNull();
  });

  it('filters recent_work titles that already appear in known_for', async () => {
    const client = makeMockClient(validClaudeResponse({
      known_for: [{ title: 'Only Murders in the Building', type: 'tv', year: '2024' }],
      recent_work: [{ title: 'Only Murders in the Building', type: 'tv', year: '2024' }, { title: 'A Different Show', type: 'tv', year: '2024' }],
    }));
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio?.recent_work.map(w => w.title)).toEqual(['A Different Show']);
  });

  // Regression coverage for real needs_review guests reprocessed via
  // --retry-review (Samuel L. Jackson, Russell Crowe, Vera Farmiga, and 10
  // others — all otherwise perfectly good, high-confidence bios) that
  // validate() rejected wholesale over a single now-past "upcoming" entry.
  // Wikipedia's prose describing a project as upcoming doesn't get
  // re-edited the moment its year passes, so Claude's extraction was
  // faithful to a now-outdated source, not wrong — dropping just that
  // entry here is what actually fixes it, since validate() itself is
  // correct to reject a genuinely-stale entry if one reaches it.
  it('drops an upcoming_work entry whose year has already passed instead of losing the whole bio', async () => {
    const client = makeMockClient(validClaudeResponse({
      upcoming_work: [{ title: 'A Past-Due Project', type: 'film', year: String(new Date().getFullYear() - 1) }],
    }));
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio).not.toBeNull();
    expect(bio?.upcoming_work).toEqual([]);
    expect(validate(bio!).ok).toBe(true);
  });

  it('keeps an upcoming_work entry whose year has not passed yet', async () => {
    const client = makeMockClient(validClaudeResponse({
      upcoming_work: [{ title: 'A Real Upcoming Project', type: 'film', year: String(new Date().getFullYear() + 1) }],
    }));
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio?.upcoming_work?.map(w => w.title)).toEqual(['A Real Upcoming Project']);
  });

  it('upgrades conan_connection to direct when conan_mentions is non-empty', async () => {
    const client = makeMockClient(validClaudeResponse({
      conan_mentions: ["He appeared on Late Night with Conan O'Brien multiple times."],
    }));
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio?.conan_connection.type).toBe('direct');
    expect(bio?.conan_connection.evidence).toContain("Late Night with Conan O'Brien");
  });

  it('falls back to the given conan connection when conan_mentions is empty', async () => {
    const client = makeMockClient(validClaudeResponse({ conan_mentions: [] }));
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio?.conan_connection).toEqual(testConanConn);
  });

  it('passes the model parameter through to messages.create', async () => {
    const client = makeMockClient(validClaudeResponse());
    await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-haiku-4-5-20251001');
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    );
  });

  it('marks the system prompt with prompt-caching cache_control', async () => {
    const client = makeMockClient(validClaudeResponse());
    await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    const call = client.messages.create.mock.calls[0][0];
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('extracts birth_year/gender/nationality straight through from the response', async () => {
    const client = makeMockClient(validClaudeResponse());
    const bio = await runClaudePipeline(client, makeGuest(), testEntity, testConanConn, 'claude-sonnet-4-6');
    expect(bio?.birth_year).toBe('1970');
    expect(bio?.gender).toBe('male');
    expect(bio?.nationality).toBe('American');
  });
});

// ── resolveEntityWithRetry() — mocked Wikipedia fetch ──────────────────────

describe('resolveEntityWithRetry() — mocked Wikipedia fetch', () => {
  beforeEach(() => {
    mockedFetchWikiEntity.mockReset();
    mockedFetchDisambiguationLinks.mockReset();
  });

  it('returns a high-confidence match for a direct name hit with a bio signal', async () => {
    mockedFetchWikiEntity.mockResolvedValue({
      title: 'Jane Actor',
      url: 'https://en.wikipedia.org/wiki/Jane_Actor',
      extract: 'Jane Actor (born 1980) is an American actress known for many roles.',
      isDisambiguation: false,
    });
    const result = await resolveEntityWithRetry('Jane Actor');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThan(0.9);
    expect(result!.intro).toContain('born 1980');
  });

  it('returns null when a disambiguation page has no resolvable links', async () => {
    mockedFetchWikiEntity.mockResolvedValue({
      title: 'Ambiguous Name',
      url: 'https://en.wikipedia.org/wiki/Ambiguous_Name',
      extract: '',
      isDisambiguation: true,
    });
    mockedFetchDisambiguationLinks.mockResolvedValue([]);
    const result = await resolveEntityWithRetry('Ambiguous Name');
    expect(result).toBeNull();
  });

  describe('disambiguation fallback', () => {
    it('resolves through a disambiguation page when exactly one linked candidate matches', async () => {
      mockedFetchWikiEntity.mockImplementation(async (title: string) => {
        if (title === 'Leslie Jones') {
          return {
            title: 'Leslie Jones',
            url: 'https://en.wikipedia.org/wiki/Leslie_Jones',
            extract: '',
            isDisambiguation: true,
          };
        }
        if (title === 'Leslie Jones (comedian)') {
          return {
            title: 'Leslie Jones (comedian)',
            url: 'https://en.wikipedia.org/wiki/Leslie_Jones_(comedian)',
            extract: 'Leslie Jones (born 1967) is an American comedian and actress, known for Saturday Night Live.',
            isDisambiguation: false,
          };
        }
        if (title === 'Leslie Jones (footballer)') {
          return {
            title: 'Leslie Jones (footballer)',
            url: 'https://en.wikipedia.org/wiki/Leslie_Jones_(footballer)',
            extract: 'Leslie Jones was an English professional footballer.',
            isDisambiguation: false,
          };
        }
        return null;
      });
      mockedFetchDisambiguationLinks.mockResolvedValue([
        'Leslie Jones (footballer)', // no bio-signal word -> won't clear the bar
        '1955', // junk link a real disambig page also carries -> no entity at all
        'England national football team',
        'Leslie Jones (comedian)', // the only candidate that clears the bar
      ]);
      const result = await resolveEntityWithRetry('Leslie Jones');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Leslie Jones (comedian)');
    });

    it('refuses to guess when two or more disambiguation candidates both plausibly match', async () => {
      mockedFetchWikiEntity.mockImplementation(async (title: string) => {
        if (title === 'Tom Arnold') {
          return {
            title: 'Tom Arnold',
            url: 'https://en.wikipedia.org/wiki/Tom_Arnold',
            extract: '',
            isDisambiguation: true,
          };
        }
        if (title === 'Tom Arnold (comedian)') {
          return {
            title: 'Tom Arnold (comedian)',
            url: 'https://en.wikipedia.org/wiki/Tom_Arnold_(comedian)',
            extract: 'Tom Arnold (born 1959) is an American actor and comedian.',
            isDisambiguation: false,
          };
        }
        if (title === 'Tom Arnold (musician)') {
          return {
            title: 'Tom Arnold (musician)',
            url: 'https://en.wikipedia.org/wiki/Tom_Arnold_(musician)',
            extract: 'Tom Arnold is an English musician and record producer.',
            isDisambiguation: false,
          };
        }
        return null;
      });
      mockedFetchDisambiguationLinks.mockResolvedValue(['Tom Arnold (comedian)', 'Tom Arnold (musician)']);
      const result = await resolveEntityWithRetry('Tom Arnold');
      // Two plausible same-named people — must not guess between them.
      expect(result).toBeNull();
    });

    it('caps how many disambiguation candidates it probes', async () => {
      const probed: string[] = [];
      mockedFetchWikiEntity.mockImplementation(async (title: string) => {
        if (title === 'Many People') {
          return { title: 'Many People', url: '', extract: '', isDisambiguation: true };
        }
        probed.push(title);
        return null; // none resolve — just measuring how many were tried
      });
      mockedFetchDisambiguationLinks.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => `Many People (variant ${i})`)
      );
      await resolveEntityWithRetry('Many People');
      expect(probed.length).toBeLessThanOrEqual(8);
    });
  });

  it('returns null when Wikipedia has no matching page', async () => {
    mockedFetchWikiEntity.mockResolvedValue(null);
    const result = await resolveEntityWithRetry('Totally Unknown Person Xyz');
    expect(result).toBeNull();
  });

  it('strips a title prefix and retries with the bare name', async () => {
    mockedFetchWikiEntity.mockImplementation(async (name: string) => {
      if (name === 'John Smith') {
        return {
          title: 'John Smith',
          url: 'https://en.wikipedia.org/wiki/John_Smith',
          extract: 'John Smith (born 1960) is an American actor.',
          isDisambiguation: false,
        };
      }
      return null; // "Dr. John Smith" itself doesn't resolve
    });
    const result = await resolveEntityWithRetry('Dr. John Smith');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('John Smith');
  });

  it('scores lower confidence when no bio-signal words are present', async () => {
    mockedFetchWikiEntity.mockResolvedValue({
      title: 'Some Person',
      url: 'https://en.wikipedia.org/wiki/Some_Person',
      extract: 'A page about something with no biographical signal words at all.',
      isDisambiguation: false,
    });
    const result = await resolveEntityWithRetry('Some Person');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThan(0.9);
  });

  // Regression coverage for real needs_review guests (production bios.json,
  // Sept 2026 Backfill Full Bios run) that all landed at exactly 0.65
  // confidence — the correct Wikipedia entity, rejected anyway by
  // exact-token-only overlap plus float imprecision at the threshold.
  describe('name-form mismatches that previously scored exactly 0.65 and got rejected', () => {
    const withBioSig = (name: string) => `${name} (born 1975) is an American actor and comedian.`;

    it('matches compound initials against spaced Wikipedia initials (BJ Novak / B. J. Novak)', async () => {
      mockedFetchWikiEntity.mockResolvedValue({
        title: 'B. J. Novak',
        url: 'https://en.wikipedia.org/wiki/B._J._Novak',
        extract: withBioSig('B. J. Novak'),
        isDisambiguation: false,
      });
      const result = await resolveEntityWithRetry('BJ Novak');
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(1, 5);
    });

    it('matches compound initials the other direction (JJ Abrams / J. J. Abrams)', async () => {
      mockedFetchWikiEntity.mockResolvedValue({
        title: 'J. J. Abrams',
        url: 'https://en.wikipedia.org/wiki/J._J._Abrams',
        extract: withBioSig('J. J. Abrams'),
        isDisambiguation: false,
      });
      const result = await resolveEntityWithRetry('JJ Abrams');
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(1, 5);
    });

    it('matches a diacritic Wikipedia title against a plain-ASCII guest name (Eric Andre / Eric André)', async () => {
      mockedFetchWikiEntity.mockResolvedValue({
        title: 'Eric André',
        url: 'https://en.wikipedia.org/wiki/Eric_Andr%C3%A9',
        extract: withBioSig('Eric André'),
        isDisambiguation: false,
      });
      const result = await resolveEntityWithRetry('Eric Andre');
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(1, 5);
    });

    it('matches a short first name as a prefix of the Wikipedia full form (Chris Meloni / Christopher Meloni)', async () => {
      mockedFetchWikiEntity.mockResolvedValue({
        title: 'Christopher Meloni',
        url: 'https://en.wikipedia.org/wiki/Christopher_Meloni',
        extract: withBioSig('Christopher Meloni'),
        isDisambiguation: false,
      });
      const result = await resolveEntityWithRetry('Chris Meloni');
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('does not let the nickname-prefix rule fuzzy-match an unrelated short name', async () => {
      mockedFetchWikiEntity.mockResolvedValue({
        title: 'Alabama Shakes',
        url: 'https://en.wikipedia.org/wiki/Alabama_Shakes',
        extract: 'Alabama Shakes is an American rock band formed in 2009.',
        isDisambiguation: false,
      });
      const result = await resolveEntityWithRetry('Al Shakes');
      // "al" is a 2-char token — below the >=3 char gate for prefix matching
      // — so it must NOT get credit for "al" -> "alabama".
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeLessThan(0.65);
    });
  });
});

// ── tokenOverlap() / normNameTokens() — pure name-matching helpers ────────

describe('tokenOverlap() and normNameTokens()', () => {
  it('scores a full match at 1', () => {
    expect(tokenOverlap(normNameTokens('Jane Actor'), normNameTokens('Jane Actor'))).toBe(1);
  });

  it('merges contiguous single-letter title tokens to match a compound-initial name token', () => {
    expect(tokenOverlap(normNameTokens('BJ Novak'), normNameTokens('B. J. Novak'))).toBe(1);
  });

  it('strips diacritics before comparing', () => {
    expect(normNameTokens('André')).toEqual(['andre']);
    expect(tokenOverlap(normNameTokens('Eric Andre'), normNameTokens('Eric André'))).toBe(1);
  });

  it('credits a genuine nickname prefix within the length-gap cap', () => {
    expect(tokenOverlap(normNameTokens('Chris Meloni'), normNameTokens('Christopher Meloni'))).toBe(1);
  });

  it('does not credit a prefix match past the 6-character gap cap', () => {
    // "chris" (5) vs a hypothetical 13-char title token is a 8-char gap — too far.
    expect(tokenOverlap(normNameTokens('Chris X'), normNameTokens('Christopherson X'))).toBeLessThan(1);
  });

  it('does not credit a short (<3 char) token as a prefix match', () => {
    expect(tokenOverlap(normNameTokens('Al Shakes'), normNameTokens('Alabama Shakes'))).toBeLessThan(1);
  });

  it('returns 0 for an empty name', () => {
    expect(tokenOverlap([], normNameTokens('Some Title'))).toBe(0);
  });
});

// ── checkDeathYearPlausibility() — shared guardrail, used by both
// enrich-bios.ts's validate() and backfill-booking-signals.ts ────────────

describe('checkDeathYearPlausibility() — shared validator', () => {
  it('rejects death_year with no birth_year', () => {
    expect(checkDeathYearPlausibility('', '1992').ok).toBe(false);
  });

  it('rejects death_year before or equal to birth_year', () => {
    expect(checkDeathYearPlausibility('2009', '1976').ok).toBe(false);
    expect(checkDeathYearPlausibility('1976', '1976').ok).toBe(false);
  });

  it('rejects a future death_year', () => {
    expect(checkDeathYearPlausibility('1976', '2099', 2026).ok).toBe(false);
  });

  it('accepts empty death_year (unknown, not implausible)', () => {
    expect(checkDeathYearPlausibility('', '').ok).toBe(true);
    expect(checkDeathYearPlausibility('1976', '').ok).toBe(true);
  });

  it('accepts a plausible real death year', () => {
    expect(checkDeathYearPlausibility('1929', '2024', 2026).ok).toBe(true);
  });

  it('rejects a non-4-digit death_year instead of silently passing via NaN comparisons', () => {
    const result = checkDeathYearPlausibility('1970', 'garbage');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('death_year_malformed');
  });

  it('rejects a non-4-digit birth_year the same way', () => {
    const result = checkDeathYearPlausibility('garbage', '2020');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('birth_year_malformed');
  });
});

// ── shouldEnqueueGuest() — the --new-only re-spend-risk guardrail ─────────
// Regression coverage for the real cost-review finding: without --new-only,
// ANY guest re-qualifies for full re-enrichment once its enrichedAt ages
// past the 30-day TTL, including guests a backlog-catchup run just
// finished — meaning simply re-triggering Backfill Full Bios after 30 days
// would silently re-spend real Claude calls on the entire archive.

describe('shouldEnqueueGuest() — new-only vs TTL re-enrichment gating', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TTL_MS = 30 * DAY_MS;
  const NOW = Date.now();

  it('always queues a guest with no existing bio, in both modes', () => {
    expect(shouldEnqueueGuest(undefined, { retryReview: false, newOnly: true, now: NOW, ttlMs: TTL_MS })).toBe(true);
    expect(shouldEnqueueGuest(undefined, { retryReview: false, newOnly: false, now: NOW, ttlMs: TTL_MS })).toBe(true);
  });

  it('--new-only never re-queues an existing, non-stale bio', () => {
    const fresh = makeBio({ enrichedAt: new Date(NOW).toISOString() });
    expect(shouldEnqueueGuest(fresh, { retryReview: false, newOnly: true, now: NOW, ttlMs: TTL_MS })).toBe(false);
  });

  it('--new-only never re-queues an existing bio even once it is TTL-stale (the actual fix)', () => {
    const stale = makeBio({ enrichedAt: new Date(NOW - 31 * DAY_MS).toISOString() });
    expect(shouldEnqueueGuest(stale, { retryReview: false, newOnly: true, now: NOW, ttlMs: TTL_MS })).toBe(false);
  });

  it('TTL mode (newOnly: false) re-queues once a bio ages past the TTL', () => {
    const stale = makeBio({ enrichedAt: new Date(NOW - 31 * DAY_MS).toISOString() });
    expect(shouldEnqueueGuest(stale, { retryReview: false, newOnly: false, now: NOW, ttlMs: TTL_MS })).toBe(true);
  });

  it('TTL mode does not re-queue a bio still within the TTL window', () => {
    const recent = makeBio({ enrichedAt: new Date(NOW - 5 * DAY_MS).toISOString() });
    expect(shouldEnqueueGuest(recent, { retryReview: false, newOnly: false, now: NOW, ttlMs: TTL_MS })).toBe(false);
  });

  it('a needs_review bio is gated by retryReview regardless of newOnly/TTL', () => {
    const reviewBio = makeBio({ needs_review: true, enrichedAt: new Date(NOW).toISOString() });
    expect(shouldEnqueueGuest(reviewBio, { retryReview: false, newOnly: true, now: NOW, ttlMs: TTL_MS })).toBe(false);
    expect(shouldEnqueueGuest(reviewBio, { retryReview: true, newOnly: true, now: NOW, ttlMs: TTL_MS })).toBe(true);
  });
});

// ── isTotalChunkFailure() — the fail-loud-not-silent guard ─────────────────
// Regression coverage for a real bug an independent review caught: without
// this guard, a chunk where every guest fails (broken credential, Anthropic
// outage) writes zero new bios and the chunked workflow's own "no changes =
// backlog exhausted" check silently treats that identically to a
// successfully finished run.

describe('isTotalChunkFailure() — fail-loud guard', () => {
  it('flags a Claude-enabled chunk where every queued guest failed', () => {
    expect(isTotalChunkFailure(true, 50, 50)).toBe(true);
  });

  it('does not flag a mixed chunk (some succeeded/reviewed, some failed)', () => {
    expect(isTotalChunkFailure(true, 50, 3)).toBe(false);
  });

  it('does not flag an empty queue (genuinely nothing to process)', () => {
    expect(isTotalChunkFailure(true, 0, 0)).toBe(false);
  });

  it('does not flag wiki-only mode (claudeClient disabled) even if failed count is high', () => {
    // Wiki-only guests essentially never throw (pure regex, no Claude call),
    // so a high failed count here would itself be a different, unrelated bug
    // — but this guard is specifically about Claude credential/API breaks.
    expect(isTotalChunkFailure(false, 50, 50)).toBe(false);
  });

  it('does not flag a fully successful chunk', () => {
    expect(isTotalChunkFailure(true, 50, 0)).toBe(false);
  });
});
