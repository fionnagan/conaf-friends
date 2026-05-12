import { NextRequest, NextResponse } from "next/server";
import coldOpensData from "@/data/cold-opens.json";
import fansData from "@/data/fans.json";
import topWordsData from "@/data/top-words.json";
import guestPhotos from "@/data/guest-photos.json";
import { COUNTRIES } from "@/lib/countries";
import { persistSubmission } from "@/lib/submissions";

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

const { records } = coldOpensData as {
  vocab: string[];
  records: ColdOpenRecord[];
};
const fans = fansData as FanRecord[];
const photos = guestPhotos as Record<string, string | null>;

/* ── Normalise ──────────────────────────────────────────────────────────────── */
function normalize(phrase: string): string {
  // Lowercase, remove punctuation (keep letters and spaces only)
  return phrase.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

/* ── Exact word token matching ──────────────────────────────────────────────── */
function findMatches(feeling: string) {
  if (!feeling.trim()) {
    console.log("[match] empty feeling — returning no matches");
    return [];
  }

  const normalized = normalize(feeling);
  // Deduplicated token set — each submitted word counted once per submission (req 2)
  const tokens = [...new Set(normalized.split(/\s+/).filter(Boolean))];

  console.log("[match] normalized tokens:", tokens);

  if (tokens.length === 0) return [];

  // Per-guest accumulation: track unique matched words and total episode frequency
  const guestMap = new Map<
    string,
    { record: ColdOpenRecord; matchedWords: Set<string>; freq: number }
  >();

  for (const r of records) {
    // Normalise phrase — remove punctuation, lowercase
    const phraseWords = new Set(
      normalize(r.feeling_phrase_normalized).split(/\s+/).filter(Boolean)
    );

    // Exact token match only — no stemming, no fuzzy, no embeddings
    const hits = tokens.filter((t) => phraseWords.has(t));
    if (hits.length === 0) continue;

    const existing = guestMap.get(r.guest_id);
    if (existing) {
      existing.freq++;
      for (const w of hits) existing.matchedWords.add(w);
    } else {
      guestMap.set(r.guest_id, {
        record: r,
        matchedWords: new Set(hits),
        freq: 1,
      });
    }
  }

  // Sort: overlap count desc, then total freq desc
  const ranked = [...guestMap.values()]
    .sort(
      (a, b) =>
        b.matchedWords.size - a.matchedWords.size ||
        b.freq - a.freq
    )
    .slice(0, 3);

  console.log(
    "[match] results:",
    ranked.map((r) => ({
      guest: r.record.guest_name,
      overlap: r.matchedWords.size,
      matched: [...r.matchedWords],
      freq: r.freq,
    }))
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return ranked.map(({ record, matchedWords: _m, freq: _f }) => ({
    guest_id: record.guest_id,
    guest_name: record.guest_name,
    episode_id: record.episode_id,
    episode_url: record.episode_url,
    profile_url: record.profile_url,
    cold_open_text: record.cold_open_text,
    feeling_phrase_raw: record.feeling_phrase_raw,
    feeling_phrase_normalized: record.feeling_phrase_normalized,
    photo_url: photos[record.guest_id] || null,
  }));
}

/* ── POST /api/i-feel ───────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, country, feeling, sessionId } = body as {
    name: string;
    country: string;
    feeling: string;
    sessionId?: string;
  };

  // Validation
  const wordCount = feeling?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (!name?.trim())    return NextResponse.json({ error: "Name is required" },               { status: 400 });
  if (!feeling?.trim()) return NextResponse.json({ error: "Feeling is required" },            { status: 400 });
  if (wordCount > 5)    return NextResponse.json({ error: "Feeling must be 5 words or fewer" }, { status: 400 });
  if (!COUNTRIES.includes(country)) return NextResponse.json({ error: "Invalid country" },   { status: 400 });

  const feelingNorm = normalize(feeling.trim());
  const matches     = findMatches(feeling);
  const countryFans = fans.filter((f) => f.country_full_name === country);

  // Persist submission to Supabase (non-blocking — fire and forget)
  persistSubmission({
    name: name.trim(),
    country,
    feeling_raw:        feeling.trim(),
    feeling_normalized: feelingNorm,
    session_id: sessionId,
  }).catch(console.error);

  return NextResponse.json({
    matches,
    topWords: topWordsData,
    fans: countryFans,
  });
}
