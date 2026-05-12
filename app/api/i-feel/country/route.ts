import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { normalizeCountry } from "@/lib/submissions";

// Filler/stop words stripped before word-frequency counting
const STOP = new Set(["a","an","the","and","or","but","so","yet","for","nor","as","at","by","if","in","of","on","to","up","via","its","it","is","be","am","are","was","were","has","had","have","do","did","not","no","my","i","me","like","feel","feeling","felt","really","very","just","quite","pretty","kinda","kind","sorta","super","totally","honestly","actually","literally","bit","little","lot","lots","about","being","getting","having"]);

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!name.trim()) {
    return NextResponse.json({ topWords: [], fans: [] });
  }

  const canonical = normalizeCountry(name.trim());

  const client = getServerClient();
  if (!client) return NextResponse.json({ topWords: [], fans: [] });

  const { data, error } = await client
    .from("submissions")
    .select("name,feeling_normalized")
    .eq("country", canonical)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return NextResponse.json({ topWords: [], fans: [] });

  // Aggregate word frequencies from fan submissions for this country
  const wordCounts: Record<string, number> = {};
  const fans: { name: string; feeling: string }[] = [];

  for (const row of data) {
    fans.push({ name: row.name, feeling: row.feeling_normalized });

    const words = (row.feeling_normalized ?? "")
      .toLowerCase()
      .replace(/[^a-z ]/g, "")
      .split(/\s+/)
      .filter((w: string) => w && !STOP.has(w));

    for (const w of words) {
      wordCounts[w] = (wordCounts[w] ?? 0) + 1;
    }
  }

  const topWords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word, count]) => ({ word, count }));

  return NextResponse.json({
    topWords,
    fans: fans.slice(0, 15),
  });
}
