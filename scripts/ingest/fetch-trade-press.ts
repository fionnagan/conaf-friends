/**
 * fetch-trade-press.ts
 * Pulls recent articles from trade/entertainment-press RSS feeds — the
 * candidate pool for detecting a guest's "upcoming work" (a project explicitly
 * described as forthcoming), since Wikipedia intros are backward-looking and
 * rarely mention unreleased projects.
 *
 * Each outlet is fetched independently and failures are non-fatal — a broken
 * feed URL for one outlet must never block the others. Feed URLs are current
 * best-effort guesses; this script's own per-outlet success/failure log is
 * the way to find out which ones are actually right.
 *
 * Usage:
 *   npx tsx scripts/ingest/fetch-trade-press.ts
 * Writes scripts/cache/trade-press.json
 */
import Parser from 'rss-parser';
import { writeCache, USER_AGENT } from './utils';

export interface TradePressArticle {
  source: string;
  title: string;
  link: string;
  pubDate: string;
  snippet: string;
}

interface Outlet {
  name: string;
  feedUrl: string;
}

// Public RSS feeds for outlets most likely to carry "X is set to star in Y" /
// "X's new album drops [date]" style announcements. Chosen to span the guest
// mix on the show (film/TV trades + music trades), not just one vertical.
const OUTLETS: Outlet[] = [
  { name: 'Variety', feedUrl: 'https://variety.com/feed/' },
  { name: 'The Hollywood Reporter', feedUrl: 'https://www.hollywoodreporter.com/feed/' },
  { name: 'Deadline', feedUrl: 'https://deadline.com/feed/' },
  { name: 'Entertainment Weekly', feedUrl: 'https://ew.com/feed/' },
  { name: 'IndieWire', feedUrl: 'https://www.indiewire.com/feed/' },
  { name: 'Collider', feedUrl: 'https://collider.com/feed/' },
  { name: 'TVLine', feedUrl: 'https://tvline.com/feed/' },
  { name: 'Rolling Stone', feedUrl: 'https://www.rollingstone.com/feed/' },
  { name: 'Billboard', feedUrl: 'https://www.billboard.com/feed/' },
];

async function fetchOutlet(parser: Parser, outlet: Outlet): Promise<TradePressArticle[]> {
  const feed = await parser.parseURL(outlet.feedUrl);
  return (feed.items || []).map((item) => ({
    source: outlet.name,
    title: (item.title || '').trim(),
    link: item.link || '',
    pubDate: item.pubDate || item.isoDate || '',
    snippet: (item.contentSnippet || item.content || '').slice(0, 500).trim(),
  }));
}

export async function fetchTradePress(): Promise<TradePressArticle[]> {
  const parser = new Parser({ headers: { 'User-Agent': USER_AGENT } });
  const all: TradePressArticle[] = [];

  for (const outlet of OUTLETS) {
    try {
      const articles = await fetchOutlet(parser, outlet);
      console.log(`  ${outlet.name}: ${articles.length} articles`);
      all.push(...articles);
    } catch (e: any) {
      console.warn(`  ${outlet.name}: FAILED (${e?.message?.slice(0, 100) ?? 'unknown error'}) — feed URL may need updating`);
    }
  }

  return all;
}

if (require.main === module) {
  fetchTradePress().then((articles) => {
    console.log(`\nTotal: ${articles.length} articles from ${OUTLETS.length} outlets attempted`);
    writeCache('trade-press.json', articles);
    console.log('Wrote scripts/cache/trade-press.json');
  });
}
