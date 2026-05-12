/**
 * Submission persistence helpers.
 * All operations gracefully no-op when Supabase is not configured.
 */
import { getServerClient } from "./supabase";

export interface SubmissionInsert {
  name: string;
  country: string;
  feeling_raw: string;
  feeling_normalized: string;
  embedding?: number[];
  generated_image_url?: string;
  session_id?: string;
  is_public?: boolean;
}

export interface SubmissionRow {
  id: string;
  name: string;
  country: string;
  feeling_raw: string;
  feeling_normalized: string;
  generated_image_url: string | null;
  created_at: string;
}

export async function persistSubmission(data: SubmissionInsert): Promise<string | null> {
  const client = getServerClient();
  if (!client) return null;

  const { data: row, error } = await client
    .from("submissions")
    .insert({
      name: data.name,
      country: data.country,
      feeling_raw: data.feeling_raw,
      feeling_normalized: data.feeling_normalized,
      generated_image_url: data.generated_image_url ?? null,
      session_id: data.session_id ?? null,
      is_public: data.is_public ?? true,
    })
    .select("id")
    .single();

  if (error) { console.error("[submissions] insert error:", error.message); return null; }
  return row?.id ?? null;
}

export async function getPublicFeed(limit = 30, before?: string): Promise<SubmissionRow[]> {
  const client = getServerClient();
  if (!client) return [];

  let q = client
    .from("submissions")
    .select("id,name,country,feeling_raw,feeling_normalized,generated_image_url,created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) q = q.lt("created_at", before);

  const { data, error } = await q;
  if (error) { console.error("[submissions] feed error:", error.message); return []; }
  return (data ?? []) as SubmissionRow[];
}

/* ── Country name normalisation ─────────────────────────────────────────────── */
const US_VARIANTS = new Set(["usa", "us", "u.s.", "u.s.a.", "united states of america"]);

export function normalizeCountry(raw: string): string {
  if (!raw) return raw;
  const lower = raw.toLowerCase().trim();
  if (US_VARIANTS.has(lower)) return "United States";
  // Normalise common alternate spellings / casing by returning trimmed original
  return raw.trim();
}

export async function getCountryStats(): Promise<Record<string, number>> {
  const client = getServerClient();
  if (!client) return {};

  const { data, error } = await client
    .from("submissions")
    .select("country")
    .eq("is_public", true);

  if (error || !data) return {};

  const counts: Record<string, number> = {};
  for (const { country } of data) {
    const canonical = normalizeCountry(country);
    if (!canonical) continue;
    counts[canonical] = (counts[canonical] ?? 0) + 1;
  }
  return counts;
}

export async function getTrendingFeelings(topN = 10): Promise<{ feeling: string; count: number }[]> {
  const client = getServerClient();
  if (!client) return [];

  const { data, error } = await client
    .from("submissions")
    .select("feeling_normalized")
    .eq("is_public", true)
    .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error || !data) return [];

  // Filler/stop words stripped before counting — multi-word phrases kept as a unit
  const STOP = new Set(["a","an","the","and","or","but","so","yet","for","nor","as","at","by","if","in","of","on","to","up","via","its","it","is","be","am","are","was","were","has","had","have","do","did","not","no","my","i","me","like","feel","feeling","felt","really","very","just","quite","pretty","kinda","kind","sorta","super","totally","honestly","actually","literally","bit","little","lot","lots","about","being","getting","having"]);
  const counts: Record<string, number> = {};
  for (const { feeling_normalized } of data) {
    // Keep multi-word entries as a unit (e.g. "cautiously optimistic" stays together)
    const filtered = feeling_normalized.trim().split(/\s+/).filter((w: string) => w && !STOP.has(w)).join(" ");
    if (filtered) counts[filtered] = (counts[filtered] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([feeling, count]) => ({ feeling, count }));
}
