# RAG for the Friends episodes — handoff + plan

Self-contained brief for a fresh session. Goal: a citation-backed RAG Q&A over
~500-600 hour-long **"Conan O'Brien Needs a Friend"** celebrity-interview episodes,
in THIS repo (`CONAN_FriendRegistry`, Next.js + TypeScript). It reuses the
*architecture and lessons* from a sibling project (`CONAN_CallerMap`, the fan-map
RAG) — not its code (different stack).

Suggested first move in the new session: `/office-hours` pointed at this doc, then
`/plan-eng-review`. Same flow that shipped the fan-map RAG.

---

## PART A — What we learned building the fan-map RAG (CONAN_CallerMap)

Shipped & live: contextual retrieval → hybrid (vector + BM25) → cross-episode host
profiles → validated episode+timestamp citations, on Vercel, no vector DB (brute-force
cosine over a committed int8 matrix). 195 short fan-segment transcripts, ~3,280 chunks.

**Offline pipeline (logic transfers; reimplement in TS for this repo):**
1. normalize transcripts → one `[HH:MM:SS]` + optional `Speaker N:` grammar
2. chunk on speaker turns, never split mid-turn, ~180-word target, carry metadata + `chunk_id = {slug}#{ts_start}`
3. (optional) contextualize: 1-line LLM blurb per chunk, full transcript prompt-cached
4. embed contextual_text → Voyage `voyage-3`, int8 unit vectors
5. BM25 inverted index over the same text
6. host/guest profiles via map-reduce over each recurring person's chunks
7. eval: vector-only vs hybrid, hit@k / MRR; timestamp-integrity check

**Request flow:** response-cache GET (key = cache_gen + corpus_hash + normalized-q) →
embed query (fail-open) → vector top-50 + BM25 top-50 → RRF → top-15 → inject host
profile if a recurring person is named → cheap LLM (Haiku) with stable instructions
cached, retrieved chunks UNcached → citation validation → cache SET.

**Hard-won lessons (these are the real value):**
- **Measure before building.** Don't add BM25, contextualization, or a reranker on a
  hunch. We almost skipped BM25 — then an expanded proper-noun eval found one query
  ("Wonder Woman at Comic-Con") ranked **180th** vector-only; BM25 fixed it to rank 6.
  The reranker was gated on a precision gap that never appeared (hit@15 = 100%) — so we
  never built it. Contextualization barely beat a free metadata-prefix baseline
  (MRR 0.944 vs 0.892) — on a bigger corpus we'd A/B on a sample and likely skip it.
- **Citations: the snippet is the trust anchor, not the timestamp.** Podcasts use
  **dynamic ad insertion (DAI)** — every listener's audio timeline differs, so a
  timestamp can never map to "the" audio. Validate that a cited (episode, timestamp)
  exists in a retrieved chunk; return a verbatim snippet; treat the timestamp as
  position context, not a seek. Don't promise audio-accurate seeking.
- **Low retrieval relevance must fall through to a facts/general answer, never hard-refuse**
  — or stats/meta questions get wrongly turned away. Let the model decline true off-topic.
- **Prompt caching:** cache the STABLE prefix (instructions/facts) in a system block;
  per-query retrieved chunks go in the uncached user message. (Provider min-token
  thresholds and block placement bit us — verify cache_read actually engages.)
- **int8 quantization is safe** (round-trip error ~0.004, cosine-preservation <0.012).
- **Deploy gotchas were ALL silent fail-opens** — instrument with a temporary `_diag`
  field, never guess. Env-var names can be non-canonical; sibling-module imports may not
  bundle on serverless. (These specifics are Python/Vercel; THIS repo is Next.js — it
  has its own deploy gotchas, but the "instrument, don't guess" rule stands.)
- **Cost (fan map):** embeddings free (Voyage 200M-token tier), contextualization ~$5,
  guest profiles ~$0.25, ~$0.006/novel query, repeats free via cache, $3 spend cap as
  backstop. The dominant cost was TIME gathering transcripts, not compute.

---

## PART B — The plan for THIS repo (Friends registry)

### Scale delta (why the fan-map architecture doesn't port directly)
| | Fan map (done) | Friends (this) |
|---|---|---|
| Episodes | 195 | ~550 |
| Length | ~2-3k words (segments) | ~10k words (full hour) |
| Corpus | ~640k tokens | **~7.5M tokens** (~12x) |
| Chunks | 3,280 | **~35,000-45,000** |
| Retrieval | brute-force cosine in the function | **managed vector store** |

At ~40k chunks, loading a ~150MB matrix + ~70MB metadata JSON on every serverless
cold start is the wall. Move to a managed store.

### Stack reality (important)
This repo is **Next.js + TypeScript**, with a **Supabase** instance — but that Supabase
powers a **separate, live, user-facing call-in feature**, NOT this RAG. So:
- **Do NOT co-locate the RAG store in the call-in Supabase.** Isolate blast radius: a
  40k-vector index + batch ingests + read-heavy queries shouldn't share resources with a
  live user feature.
- **Vector store options (both isolated):**
  - **Upstash Vector (lean recommendation)** — serverless, hybrid (dense+sparse) built in
    (may remove the need to hand-roll BM25), pay-per-use, matches existing Upstash use.
  - **A separate dedicated Supabase project** with pgvector — if you prefer SQL control;
    hybrid via pgvector + Postgres FTS + RRF in SQL. NOT the call-in project.

### Decisions (carried + adapted)
- **Embeddings: Voyage `voyage-3`** — ~7.5-10M tokens is still under the 200M free tier
  (add a payment method for rate limits). OpenAI `text-embedding-3-small` (~$2) is also
  fine in a TS stack.
- **Contextualization: A/B on ~20 episodes first, then almost certainly SKIP** — biggest
  cost/time lever (~$50-100 + days at this scale; the fan-map A/B showed marginal gain).
- **Diarization matters here** (it didn't on the fan map): 2-person hour-long interviews;
  "what did [guest] say about X" is the core query. Use source speaker turns or a
  diarization pass — unlocks guest-attributed retrieval + real per-guest profiles.
- **Recurring-guest profiles** = the host-profile pattern, scaled and more valuable
  (public figures appearing multiple times).
- **Extend the existing Ask-the-Registry agent** (`ASK_THE_REGISTRY_AGENT.md`), don't
  build a parallel path.

### Cost factoring
- One-time: embeddings ~free; contextualization $0 (skip) or ~$50-100; guest profiles
  ~$20-50; **transcripts = the real variable.** If transcripts exist online → mostly your
  time to fetch/normalize. **If you must transcribe audio: ~550 hrs × Deepgram/Whisper ≈
  $140-200** — decide this FIRST, it dwarfs compute.
- Recurring: ~$0.006-0.01/novel query (one embed + one cheap LLM answer), repeats cached;
  no cold-start matrix cost with a managed store. Set a hard spend cap.
- Infra: $0 new if Upstash Vector or a free dedicated Supabase project.

### Time / long pole
Compute and code are fast (pipeline logic is proven). Calendar time is **transcript
acquisition + normalization for 550 hour-long episodes** — exactly where the fan map
spent most of its effort. Budget there.

### Phasing (mirror what worked)
- **Phase 0 — gating decision:** transcript source, and scrape vs transcribe. Nothing
  else starts until this is settled.
- **Phase 1 — prove on ~20 episodes:** ingest → chunk → embed (metadata baseline) →
  managed-store hybrid search → wire into the existing agent → ~30-question eval. Ship.
- **Phase 2 — scale to 550:** add contextualization only if the Phase 1 eval showed it
  helps.
- **Phase 3 — guest profiles + diarization-aware attribution.**

### Open questions for /office-hours
1. Transcript source(s) for the main show, and scrape-vs-transcribe (cost gate).
2. Vector store: Upstash Vector vs dedicated Supabase pgvector.
3. What does the existing Ask-the-Registry agent already do — how does RAG plug in?
4. How much does guest-level attribution (diarization) matter vs episode-level for v1?
