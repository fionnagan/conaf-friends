/**
 * fetch-conan-activity.ts
 * Step 1 of the "Crossed Paths" pipeline: tracks Conan's OWN recent activity
 * (hosting gigs, film/TV roles, podcast guest spots) — the thing nothing in
 * this codebase does today, since every other script tracks guests, never
 * the host himself.
 *
 * Unlike a guest's bio, Conan's own Wikipedia lead paragraph is not enough —
 * something like hosting the Oscars or a Toy Story role is far more likely
 * to live in a "Filmography"/"Awards" section than the intro. So this fetches
 * the FULL plain-text article (Action API, not the truncated REST summary
 * enrich-bios.ts uses for guests), pulls out the intro plus any section whose
 * heading looks activity-relevant, and asks Claude to extract only RECENT
 * (last ~3 years) activity — that's what's actionable for booking; a 2009
 * film cameo isn't.
 *
 * Usage:
 *   npx tsx scripts/ingest/fetch-conan-activity.ts
 * Writes scripts/cache/conan-activity.json
 */
import axios from 'axios';
import { writeCache, USER_AGENT } from './utils';

const WIKI_TITLE = 'Conan_O%27Brien';
const CURRENT_YEAR = new Date().getFullYear();
const RECENT_CUTOFF = CURRENT_YEAR - 3;

// Section headings worth keeping alongside the intro — everything else in a
// biography this long (childhood, early career, past shows already fully
// modeled elsewhere in this repo) is noise for THIS purpose.
const RELEVANT_HEADING_RE = /\b(film|television|filmography|award|host|podcast|guest appearance)/i;

interface ConanActivity {
  title: string;
  type: 'film' | 'tv' | 'hosting' | 'podcast_guest' | 'other';
  year: string;
  role: string;
}

async function fetchFullArticleText(): Promise<string> {
  const res = await axios.get('https://en.wikipedia.org/w/api.php', {
    headers: { 'User-Agent': USER_AGENT },
    params: {
      action: 'query',
      prop: 'extracts',
      explaintext: 1,
      titles: WIKI_TITLE,
      format: 'json',
      redirects: 1,
    },
    timeout: 20000,
  });
  const pages = res.data?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  return page?.extract ?? '';
}

// Plain-text extracts mark section headings as "== Heading ==" (or "===" for
// subsections). Keep the intro (everything before the first heading) plus any
// section whose heading matches RELEVANT_HEADING_RE.
function extractRelevantSections(fullText: string): string {
  const headingRe = /^(={2,4})\s*(.+?)\s*\1\s*$/gm;
  const matches = [...fullText.matchAll(headingRe)];

  if (matches.length === 0) return fullText.slice(0, 12000);

  const intro = fullText.slice(0, matches[0].index).trim();
  const kept: string[] = [intro];

  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][2];
    if (!RELEVANT_HEADING_RE.test(heading)) continue;
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
    kept.push(`== ${heading} ==\n${fullText.slice(start, end).trim()}`);
  }

  return kept.join('\n\n').slice(0, 14000);
}

async function extractActivity(client: any, text: string): Promise<ConanActivity[]> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: `Extract structured data from a Wikipedia article. Output valid JSON only. No markdown. Today: ${new Date().toISOString().slice(0, 10)}.`,
    messages: [{
      role: 'user',
      content: `Wikipedia article text about Conan O'Brien (intro + filmography/hosting/award sections):
${text}

Return JSON: { "activity": [{"title":"","type":"film|tv|hosting|podcast_guest|other","year":"","role":""}] }

Rules:
- Only activity from ${RECENT_CUTOFF} or later — this is a "what's he been doing lately" signal, not a full career filmography
- "hosting" = ceremonies/shows he hosted (e.g. an awards show), not his own long-running programs
- "podcast_guest" = him appearing as a guest on someone ELSE's podcast
- role: his role/capacity (e.g. "voice role", "host", "guest"), short
- year: 4-digit string; if a range, use the most recent year
- Empty array if nothing in that window is stated — never infer or guess an activity`,
    }],
  });

  try {
    const parsed = JSON.parse(msg.content[0].text.trim());
    return parsed.activity ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY — cannot extract structured activity. Set it and re-run.');
    process.exit(1);
  }

  console.log('Fetching full Conan O\'Brien Wikipedia article...');
  const fullText = await fetchFullArticleText();
  if (!fullText) {
    console.log('Could not fetch article text.');
    process.exit(1);
  }
  console.log(`  Full article: ${fullText.length} chars`);

  const relevant = extractRelevantSections(fullText);
  console.log(`  Relevant sections (intro + filmography/hosting/award/podcast headings): ${relevant.length} chars`);

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const activity = await extractActivity(client, relevant);
  console.log(`\n${activity.length} recent (${RECENT_CUTOFF}+) activity item(s) found:\n`);
  for (const a of activity) {
    console.log(`  - ${a.title} (${a.type}, ${a.year}) — ${a.role}`);
  }

  writeCache('conan-activity.json', { generatedAt: new Date().toISOString(), activity });
  console.log('\nWrote scripts/cache/conan-activity.json');
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
