/**
 * Rebuild data/cold-opens.json from data/guests.json.
 *
 * Extracts every appearance that has a coldOpenWord, normalises the phrase,
 * builds a TF-IDF vocabulary, and writes the full cold-opens.json that the
 * i-feel matching API reads at runtime.
 *
 * Called automatically by index.ts after writeOutput().
 * Can also be run standalone:  npx tsx scripts/ingest/build-cold-opens.ts
 */
import * as fs   from 'fs';
import * as path from 'path';
import type { GuestsData } from '../../lib/types';

const DATA_FILE = path.join(process.cwd(), 'data', 'guests.json');
const OUT_FILE  = path.join(process.cwd(), 'data', 'cold-opens.json');

// ── Normalise (must match the runtime normalize() in app/api/i-feel/route.ts) ──
function normalize(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z ]/g, '').trim();
}

// ── Derive a stable episode_id from the episode URL ───────────────────────────
function episodeIdFromUrl(url: string): string {
  return url.split('/').filter(Boolean).pop() ?? '';
}

// ── Build & export ─────────────────────────────────────────────────────────────
export function buildColdOpens(data: GuestsData): void {
  type RawRecord = {
    guest_id: string;
    guest_name: string;
    episode_id: string;
    episode_url: string;
    profile_url: string;
    cold_open_text: string;
    feeling_phrase_raw: string;
    feeling_phrase_normalized: string;
    _tokens: string[];           // internal; stripped before write
  };

  const rawRecords: RawRecord[] = [];

  for (const guest of data.guests) {
    for (const app of guest.appearances) {
      if (!app.coldOpenWord || !app.episodeUrl) continue;

      // Strip surrounding quotes that sometimes appear in RSS data
      const raw        = app.coldOpenWord.replace(/^["'""]|["'""]$/g, '').trim();
      const normalized = normalize(raw);
      if (!normalized) continue;

      rawRecords.push({
        guest_id:                 guest.id,
        guest_name:               guest.name,
        episode_id:               episodeIdFromUrl(app.episodeUrl),
        episode_url:              app.episodeUrl,
        profile_url:              `/guest/${guest.id}`,
        cold_open_text:           raw,
        feeling_phrase_raw:       raw,
        feeling_phrase_normalized: normalized,
        _tokens: [...new Set(normalized.split(/\s+/).filter(Boolean))],
      });
    }
  }

  // ── Vocabulary: all unique tokens across all phrases ────────────────────────
  const vocabSet = new Set<string>();
  for (const r of rawRecords) r._tokens.forEach((t) => vocabSet.add(t));
  const vocab      = Array.from(vocabSet).sort();
  const vocabIndex = new Map(vocab.map((w, i) => [w, i]));

  // ── IDF: log-smoothed ─────────────────────────────────────────────────────
  const df = new Map<string, number>();
  for (const r of rawRecords) {
    const unique = new Set(r._tokens);
    for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N   = rawRecords.length;
  const idf = new Map(vocab.map((w) => [
    w,
    Math.log((N + 1) / ((df.get(w) ?? 0) + 1)) + 1,
  ]));

  // ── TF-IDF vectors (L2-normalised) ───────────────────────────────────────
  const records = rawRecords.map(({ _tokens, ...r }) => {
    const tf     = new Map<string, number>();
    for (const t of _tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    const vec = new Array<number>(vocab.length).fill(0);
    for (const [t, count] of tf) {
      const idx = vocabIndex.get(t);
      if (idx !== undefined) vec[idx] = (count / _tokens.length) * (idf.get(t) ?? 1);
    }

    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    const embedding_vector = norm > 0
      ? vec.map((v) => Math.round((v / norm) * 1e6) / 1e6)
      : vec;

    return { ...r, embedding_vector };
  });

  // ── Write ─────────────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ vocab, records }, null, 2));
  console.log(`[ColdOpens] ${records.length} records, vocab size ${vocab.length} → data/cold-opens.json`);
}

// ── Standalone runner ─────────────────────────────────────────────────────────
if (require.main === module) {
  const data: GuestsData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  buildColdOpens(data);
}
