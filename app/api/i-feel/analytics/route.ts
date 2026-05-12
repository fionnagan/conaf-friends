import { NextResponse } from "next/server";
import topWordsData from "@/data/top-words.json";
import coldOpensData from "@/data/cold-opens.json";
import { getCountryStats, getTrendingFeelings } from "@/lib/submissions";
import { getServerClient } from "@/lib/supabase";

// Cache analytics for 5 minutes
export const revalidate = 300;

const { records } = coldOpensData as {
  vocab: string[];
  records: { guest_id: string; guest_name: string; profile_url: string; cold_open_text: string }[];
};

// Filler/stop words stripped before counting — multi-word phrases kept as a unit
const STOP = new Set(["a","an","the","and","or","but","so","yet","for","nor","as","at","by","if","in","of","on","to","up","via","its","it","is","be","am","are","was","were","has","had","have","do","did","not","no","my","i","me","like","feel","feeling","felt","really","very","just","quite","pretty","kinda","kind","sorta","super","totally","honestly","actually","literally","bit","little","lot","lots","about","being","getting","having"]);

async function getFastestRising(): Promise<{ feeling: string; count: number; prevCount: number }[]> {
  const client = getServerClient();
  if (!client) return [];

  const now = new Date();
  const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: recent }, { data: prev }] = await Promise.all([
    client.from("submissions").select("feeling_normalized").gte("created_at", dayAgo).eq("is_public", true),
    client.from("submissions").select("feeling_normalized").gte("created_at", weekAgo).lt("created_at", dayAgo).eq("is_public", true),
  ]);

  const count = (rows: { feeling_normalized: string }[] | null) => {
    const c: Record<string, number> = {};
    for (const r of rows ?? []) {
      const filtered = r.feeling_normalized.trim().split(/\s+/).filter((w: string) => w && !STOP.has(w)).join(" ");
      if (filtered) c[filtered] = (c[filtered] ?? 0) + 1;
    }
    return c;
  };

  const recentCounts = count(recent);
  const prevCounts   = count(prev);

  return Object.entries(recentCounts)
    .map(([feeling, cnt]) => ({
      feeling,
      count: cnt,
      prevCount: prevCounts[feeling] ?? 0,
      // velocity: growth ratio (new words score high)
      velocity: cnt / Math.max(prevCounts[feeling] ?? 0, 0.5),
    }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 5)
    .map(({ feeling, count, prevCount }) => ({ feeling, count, prevCount }));
}

async function getMostMatchedGuest(): Promise<{ guest_name: string; profile_url: string; cold_open_text: string; matches: number } | null> {
  const client = getServerClient();
  if (!client) return null;

  // Not stored yet — use top word overlap as proxy:
  // Guest whose feeling_phrase words appear most in recent submissions
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client.from("submissions").select("feeling_normalized").gte("created_at", weekAgo).eq("is_public", true);
  if (!data?.length) return null;

  const submissionWords = new Set(
    data.flatMap((r) => r.feeling_normalized.split(/\s+/).filter((w: string) => !STOP.has(w)))
  );

  const scored = records
    .filter((r, i, arr) => arr.findIndex((x) => x.guest_id === r.guest_id) === i) // dedupe by guest
    .map((r) => {
      const words = r.cold_open_text.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
      const matches = words.filter((w) => submissionWords.has(w)).length;
      return { ...r, matches };
    })
    .filter((r) => r.matches > 0)
    .sort((a, b) => b.matches - a.matches);

  return scored[0] ?? null;
}

async function getCountryRankings(): Promise<{ country: string; count: number; topFeeling: string }[]> {
  const client = getServerClient();
  if (!client) return [];

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("submissions")
    .select("country,feeling_normalized")
    .gte("created_at", weekAgo)
    .eq("is_public", true);

  if (!data?.length) return [];

  const byCountry: Record<string, { count: number; words: Record<string, number> }> = {};
  for (const { country, feeling_normalized } of data) {
    if (!byCountry[country]) byCountry[country] = { count: 0, words: {} };
    byCountry[country].count++;
    const filtered = feeling_normalized.trim().split(/\s+/).filter((w: string) => w && !STOP.has(w)).join(" ");
    if (filtered) byCountry[country].words[filtered] = (byCountry[country].words[filtered] ?? 0) + 1;
  }

  return Object.entries(byCountry)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([country, { count, words }]) => ({
      country,
      count,
      topFeeling: Object.entries(words).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }));
}

async function getConstellationWords(): Promise<{ word: string; count: number; fans: string[] }[]> {
  const client = getServerClient();
  if (!client) return [];

  const weekAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // last 30 days
  const { data } = await client
    .from("submissions")
    .select("feeling_normalized,name")
    .gte("created_at", weekAgo)
    .eq("is_public", true);

  if (!data?.length) return [];

  // Each feeling submission is one atomic entry — never split into individual words.
  const wordFans: Record<string, { count: number; fans: Set<string> }> = {};
  for (const { feeling_normalized, name } of data) {
    const phrase = (feeling_normalized ?? "").trim();
    if (!phrase) continue;
    if (!wordFans[phrase]) wordFans[phrase] = { count: 0, fans: new Set() };
    wordFans[phrase].count++;
    if (name) wordFans[phrase].fans.add(name);
  }

  return Object.entries(wordFans)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 24)
    .map(([word, { count, fans }]) => ({ word, count, fans: [...fans].slice(0, 10) }));
}

export async function GET() {
  const [countryStats, trending, fastestRising, mostMatchedGuest, countryRankings, constellationWords] = await Promise.all([
    getCountryStats(),
    getTrendingFeelings(10),
    getFastestRising(),
    getMostMatchedGuest(),
    getCountryRankings(),
    getConstellationWords(),
  ]);

  const totalSubmissions = Object.values(countryStats).reduce((s, c) => s + c, 0);
  const topCountryEntry  = Object.entries(countryStats).sort((a, b) => b[1] - a[1])[0];
  const topCountry       = topCountryEntry ? { country: topCountryEntry[0], count: topCountryEntry[1] } : null;

  return NextResponse.json({
    topWords: topWordsData,
    trending,
    fastestRising,
    mostMatchedGuest,
    countryRankings,
    totalSubmissions,
    topCountry,
    countryCounts: countryStats,
    constellationWords,
  });
}
