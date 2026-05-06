import { NextRequest, NextResponse } from "next/server";
import coldOpensData from "@/data/cold-opens.json";
import fansData from "@/data/fans.json";
import topWordsData from "@/data/top-words.json";
import { COUNTRIES } from "@/lib/countries";

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface ColdOpenRecord {
  guest_id: string;
  guest_name: string;
  episode_id: string;
  episode_url: string;
  profile_url: string;
  cold_open_text: string;
  feeling_phrase_raw: string;
  feeling_phrase_normalized: string;
  embedding_vector: number[];
}

interface FanRecord {
  fan_id: string;
  fan_name: string;
  country_full_name: string;
  episode_id: string;
  episode_url: string;
  profile_url: string;
}

const { vocab, records } = coldOpensData as {
  vocab: string[];
  records: ColdOpenRecord[];
};
const fans = fansData as FanRecord[];

/* ── TF-IDF vectorise ───────────────────────────────────────────────────────── */
function normalize(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

function vectorize(phrase: string): number[] {
  const words = normalize(phrase).split(/\s+/).filter(Boolean);
  const tf: Record<string, number> = {};
  for (const w of words) tf[w] = (tf[w] ?? 0) + 1;
  const total = Math.max(words.length, 1);

  // IDF is already baked into stored vectors — recompute consistently
  const N = records.length;
  const df: Record<string, number> = {};
  for (const r of records) {
    const seen = new Set(r.feeling_phrase_normalized.split(/\s+/));
    for (const w of seen) df[w] = (df[w] ?? 0) + 1;
  }

  const vec = new Array(vocab.length).fill(0);
  for (const [w, count] of Object.entries(tf)) {
    const idx = vocab.indexOf(w);
    if (idx === -1) continue;
    const idf = Math.log((N + 1) / ((df[w] ?? 0) + 1));
    vec[idx] = (count / total) * idf;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both unit-normalised
}

/* ── Semantic matching ──────────────────────────────────────────────────────── */
function findMatches(feeling: string) {
  const queryVec = vectorize(feeling);

  const scored = records
    .filter((r) => r.embedding_vector.length > 0)
    .map((r) => ({
      ...r,
      score: cosineSimilarity(queryVec, r.embedding_vector),
    }))
    .sort((a, b) => b.score - a.score || a.episode_id.localeCompare(b.episode_id));

  // Deduplicate by guest_id, return top 3
  const seen = new Set<string>();
  const top: typeof scored = [];
  for (const r of scored) {
    if (seen.has(r.guest_id)) continue;
    seen.add(r.guest_id);
    top.push(r);
    if (top.length === 3) break;
  }
  return top.map(({ score: _s, embedding_vector: _e, ...rest }) => rest);
}

/* ── POST /api/i-feel ───────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, country, feeling } = body as {
    name: string;
    country: string;
    feeling: string;
  };

  // Validation
  const wordCount = feeling?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!feeling?.trim()) return NextResponse.json({ error: "Feeling is required" }, { status: 400 });
  if (wordCount > 4) return NextResponse.json({ error: "Feeling must be 4 words or fewer" }, { status: 400 });
  if (!COUNTRIES.includes(country)) return NextResponse.json({ error: "Invalid country" }, { status: 400 });

  const matches = findMatches(feeling);
  const countryFans = fans.filter((f) => f.country_full_name === country);

  return NextResponse.json({
    matches,
    topWords: topWordsData,
    fans: countryFans,
  });
}
