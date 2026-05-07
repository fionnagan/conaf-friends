import { NextResponse } from "next/server";
import topWordsData from "@/data/top-words.json";
import { getCountryStats, getTrendingFeelings } from "@/lib/submissions";

// Cache analytics for 5 minutes on the edge
export const revalidate = 300;

export async function GET() {
  const [countryStats, trending] = await Promise.all([
    getCountryStats(),
    getTrendingFeelings(10),
  ]);

  const totalSubmissions = Object.values(countryStats).reduce((s, c) => s + c, 0);

  const topCountryEntry = Object.entries(countryStats).sort((a, b) => b[1] - a[1])[0];
  const topCountry = topCountryEntry
    ? { country: topCountryEntry[0], count: topCountryEntry[1] }
    : null;

  return NextResponse.json({
    topWords: topWordsData,
    trending,
    totalSubmissions,
    topCountry,
    countryCounts: countryStats,
  });
}
