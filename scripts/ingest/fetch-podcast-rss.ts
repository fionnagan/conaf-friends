import Parser from 'rss-parser';
import { writeCache, readCache, slugify } from './utils';
import type { RawPodcastEpisode, ColdOpenSentiment } from '../../lib/types';

const RSS_URL = 'https://feeds.simplecast.com/dHoohVNH';
const CACHE_FILE = 'podcast-episodes.json';

const FAN_PATTERNS = [
  /conan\s+o.?brien\s+needs\s+a\s+fan/i,
  /fan\s+mail/i,
  /interrupto/i,
  /listener\s+mail/i,
  /staff\s+picks/i,
  /conan\s+calls/i,
];

// Parse "HH:MM:SS" or "MM:SS" → total seconds
function parseDurationSeconds(dur: string): number {
  const parts = (dur || '').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// Real guest episodes are typically ≥ 40 min.
// Short episodes (< 40 min) without a recognisable guest pattern are fan segments.
const GUEST_EPISODE_MIN_SECONDS = 40 * 60;

const STAFF_PATTERNS = [
  /with\s+sona\s+movsesian/i,
  /with\s+matt\s+gourley/i,
  /with\s+the\s+staff/i,
  /sona.*matt.*answer/i,
];

const SPECIAL_PATTERNS = [
  /deep\s+dive\s+with\s+dana\s+carvey/i,
  /hans\s+and\s+franz/i,
  /miniseries/i,
];

// Job title prefixes that appear in RSS descriptions before the guest's name
const JOB_TITLE_PREFIX =
  /^(?:(?:actor|actress|comedian|writer|director|producer|musician|singer|host|author|journalist|chef|athlete|politician|ambassador|senator|professor|dr\.?|mr\.?|ms\.?)[,\s/&]+)+/i;

const COLD_OPEN_REGEX =
  /([A-Z][^.!?]+?)\s+feels?\s+(.+?)\s+about\s+being\s+Conan\s+O.?Brien.?s\s+friend/i;

const WARM_WORDS = new Set([
  'blessed', 'honored', 'grateful', 'delighted', 'fine', 'good', 'hopeful',
  'relieved', 'electric', 'just fine', 'still really good', 'genuinely',
  'genuinely good', 'wonderful', 'great', 'fantastic', 'amazing', 'thrilled',
  'excited', 'lucky', 'fortunate', 'proud', 'happy', 'very good',
  'bullish', 'content', 'comfortable', 'at peace', 'at ease',
]);

const NEUTRAL_WORDS = new Set(['okay', 'alright', "it's fine", 'fine enough', 'neutral']);

const DEFLECTING_WORDS = new Set([
  'indifferent', 'nothing', 'ghosted', 'still ghosted', 'not sure',
  'unsure', 'confused', 'lost',
]);

const ANXIOUS_WORDS = new Set([
  'terrified', 'afraid', 'in the constant threat of physical danger', 'skeptical',
  'nervous', 'scared', 'worried', 'stressed', 'overwhelmed', 'panicked',
  'conflicted', 'uncertain', 'uneasy',
]);

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')   // remove tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function classifySentiment(word: string): ColdOpenSentiment {
  const w = word.toLowerCase().trim();
  if (WARM_WORDS.has(w)) return 'warm';
  if (NEUTRAL_WORDS.has(w)) return 'neutral';
  if (DEFLECTING_WORDS.has(w)) return 'deflecting';
  if (ANXIOUS_WORDS.has(w)) return 'anxious';
  if (/outraged|still outraged|callback/.test(w)) return 'affectionate-absurd';
  if (/zach galifianakis/i.test(w)) return 'affectionate-absurd';
  if (w.split(' ').length >= 4) return 'affectionate-absurd';
  return 'neutral';
}

// Clean a raw guest name extracted from descriptions — strip job titles and HTML artifacts
function cleanGuestName(raw: string): string {
  return raw
    .replace(JOB_TITLE_PREFIX, '')
    .replace(/^[^A-Z]+/, '')     // strip leading non-uppercase chars (e.g. "p>", "- ")
    .trim();
}

// Build a teamcoco.com episode URL from the episode title (slug-based)
function buildTeamCocoUrl(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `https://teamcoco.com/podcasts/conan-obrien-needs-a-friend/episodes/${slug}`;
}

const SUFFIX_WORDS = /\b(?:Returns?|Again|Is Back|Once More|Part|Vol|Episode)\b/i;

function extractGuestName(title: string, plainText: string): string | undefined {
  // 1. Title with suffix FIRST: "Timothy Olyphant Returns Again", "Lisa Kudrow (Full Episode)"
  //    Check this before simpleName to avoid swallowing suffix words into the name
  const withSuffix = title.match(
    /^([A-Z][A-Za-z .'-]+?)\s+(?:Returns?|Is Back|Once More|Again|\()/i
  );
  if (withSuffix?.[1]) return withSuffix[1].trim();

  // 2. Simple single-name title (most common): "Seth Rogen", "Bill Burr", etc.
  //    Must be 2+ capitalised words, no trailing suffix keywords
  const simpleName = title.match(
    /^([A-Z][a-záàâäéèêëíìîïóòôöúùûüñçA-Z][a-záàâäéèêëíìîïóòôöúùûüñçA-Z .'-]{1,}[a-záàâäéèêëíìîïóòôöúùûüñçA-Z])$/
  );
  if (
    simpleName?.[1] &&
    !simpleName[1].match(/^(The|A|An|Conan|Episode|Part|Vol|And)\b/i) &&
    !SUFFIX_WORDS.test(simpleName[1])
  ) {
    return simpleName[1].trim();
  }

  // 3. Multi-guest title (keep as-is, limit length)
  const multiGuest = title.match(/^([A-Z][A-Za-z ,.'-]{3,60})(?:\s+And\s+|\s*$)/);
  if (multiGuest?.[1] && !multiGuest[1].match(/^(The|Conan|Episode)/i)) {
    return multiGuest[1].trim();
  }

  // 4. Fall back to cold open description (plain text only)
  const coldMatch = plainText.match(COLD_OPEN_REGEX);
  if (coldMatch?.[1]) {
    return cleanGuestName(coldMatch[1]);
  }

  return undefined;
}

export async function fetchPodcastRSS(): Promise<RawPodcastEpisode[]> {
  const cached = readCache<RawPodcastEpisode[]>(CACHE_FILE);
  if (cached && cached.length > 0) {
    console.log(`[RSS] Using cached ${cached.length} episodes`);
    return cached;
  }

  console.log('[RSS] Fetching Simplecast RSS feed...');
  const parser = new Parser({
    customFields: {
      item: [
        ['itunes:image', 'itunesImage'],
        ['itunes:duration', 'itunesDuration'],
        ['enclosure', 'enclosure'],
      ],
    },
  });

  const feed = await parser.parseURL(RSS_URL);
  console.log(`[RSS] Got ${feed.items.length} episodes`);

  const episodes: RawPodcastEpisode[] = [];

  for (const item of feed.items) {
    const title = (item.title || '').trim();
    const rawHtml = item.content || '';
    // Use HTML-stripped plain text for all text analysis
    const plainText = item.contentSnippet || stripHtml(rawHtml);

    const durationSecs = parseDurationSeconds((item as any).itunesDuration || '');
    const isShortEpisode = durationSecs > 0 && durationSecs < GUEST_EPISODE_MIN_SECONDS;
    const isFanSegment =
      FAN_PATTERNS.some((p) => p.test(title) || p.test(plainText)) ||
      isShortEpisode;
    const isStaffEpisode = STAFF_PATTERNS.some((p) => p.test(title));
    const isSpecial = SPECIAL_PATTERNS.some((p) => p.test(title));
    const isRepeatGuest = /returns|once more|is back|again/i.test(title);

    // Parse cold open from plain text only (never raw HTML)
    const coldMatch = plainText.match(COLD_OPEN_REGEX);
    const coldOpenWord = coldMatch?.[2]?.trim();
    const coldOpenSentiment = coldOpenWord ? classifySentiment(coldOpenWord) : undefined;

    const guestName =
      !isFanSegment && !isStaffEpisode
        ? extractGuestName(title, plainText)
        : undefined;

    const enclosureUrl =
      (item as any).enclosure?.url || (item as any).enclosureUrl || undefined;

    // Build a proper teamcoco.com URL instead of the siriusxm.com placeholder
    const episodeLink = buildTeamCocoUrl(title);

    episodes.push({
      title,
      pubDate: item.pubDate || item.isoDate || '',
      description: plainText,
      link: episodeLink,
      enclosure: enclosureUrl
        ? { url: enclosureUrl, type: 'audio/mpeg', length: '0' }
        : undefined,
      itunes: {
        image:
          (item as any).itunesImage?.['$']?.href ||
          (item as any).itunes?.image ||
          undefined,
        duration: (item as any).itunesDuration || undefined,
      },
      isFanSegment,
      isStaffEpisode,
      isSpecial,
      guestName,
      coldOpenWord,
      coldOpenSentiment,
      isRepeatGuest,
    });
  }

  writeCache(CACHE_FILE, episodes);
  console.log(`[RSS] Cached ${episodes.length} episodes`);
  return episodes;
}

if (require.main === module) {
  fetchPodcastRSS().then((eps) => {
    const withGuests = eps.filter((e) => e.guestName && !e.isFanSegment && !e.isStaffEpisode);
    console.log(`\nTotal: ${eps.length} | Guest episodes: ${withGuests.length}`);
    console.log(`Fan/staff: ${eps.filter((e) => e.isFanSegment || e.isStaffEpisode).length}`);

    const badNames = withGuests.filter((e) => e.guestName && /^p>|^[^A-Z]/.test(e.guestName));
    console.log(`Bad names: ${badNames.length}`);
    if (badNames.length) badNames.slice(0, 5).forEach((e) => console.log(' ', e.title, '→', e.guestName));

    console.log('\nSample cold opens:');
    withGuests.filter((e) => e.coldOpenWord).slice(0, 8).forEach((e) => {
      console.log(`  ${e.guestName}: "${e.coldOpenWord}" (${e.coldOpenSentiment})`);
    });

    console.log('\nSample URLs:');
    withGuests.slice(0, 3).forEach((e) => console.log(`  ${e.title} → ${e.link}`));
  });
}
