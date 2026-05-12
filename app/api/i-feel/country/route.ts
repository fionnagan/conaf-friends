import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase";
import { normalizeCountry } from "@/lib/submissions";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!name.trim()) {
    return NextResponse.json({ topFeelings: [], fans: [] });
  }

  const canonical = normalizeCountry(name.trim());

  const client = getServerClient();
  if (!client) return NextResponse.json({ topFeelings: [], fans: [] });

  const { data, error } = await client
    .from("submissions")
    .select("name,feeling_normalized")
    .eq("country", canonical)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return NextResponse.json({ topFeelings: [], fans: [] });

  // Each submission is one atomic entry — never split into individual words.
  // Count how many times each full feeling phrase was submitted.
  const feelingCounts: Record<string, number> = {};
  const fans: { name: string; feeling: string }[] = [];

  for (const row of data) {
    const phrase = (row.feeling_normalized ?? "").trim();
    if (!phrase) continue;

    fans.push({ name: row.name, feeling: phrase });
    feelingCounts[phrase] = (feelingCounts[phrase] ?? 0) + 1;
  }

  const topFeelings = Object.entries(feelingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([feeling, count]) => ({ feeling, count }));

  return NextResponse.json({
    topFeelings,
    fans: fans.slice(0, 15),
  });
}
