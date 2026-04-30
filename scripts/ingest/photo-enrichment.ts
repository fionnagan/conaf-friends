/**
 * Photo enrichment orchestrator.
 *
 * For each guest:
 *   1. Collect up to 5 candidate image URLs
 *   2. Extract face embeddings via Python (graceful no-op if unavailable)
 *   3. Cluster faces — reject if ≥2 distinct clusters (similarity < threshold)
 *   4. Compute identity consistency score (avg pairwise cosine similarity)
 *   5. Score each candidate with the composite formula
 *   6. Emit: auto_approved | needs_review | rejected
 *
 * Results feed into:
 *   - photos.json (PhotoCache) for approved images
 *   - review-queue.json for items needing human review
 *   - enrichment-log.json for audit trail
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { readCache, writeCache, slugify } from './utils';
import { fetchCandidates } from './photo-candidates';
import {
  loadTrustStore, saveTrustStore, getTrust, extractDomain, DEFAULT_THRESHOLD,
} from './source-ranking';
import type { PhotoCache } from '../../lib/types';
import type {
  FaceEmbeddingResult, PhotoCandidate, ScoredCandidate,
  IdentityConfirmation, EnrichmentDecision, ReviewQueueItem,
} from '../../lib/face-types';

const CACHE_DIR      = path.join(process.cwd(), 'scripts', 'cache');
const PHOTO_FILE     = 'photos.json';
const QUEUE_FILE     = path.join(CACHE_DIR, 'review-queue.json');
const LOG_FILE       = path.join(CACHE_DIR, 'enrichment-log.json');
const PY_SCRIPT      = path.join(process.cwd(), 'scripts', 'face', 'extract_embedding.py');

// Decision thresholds (spec §B)
const CONSISTENCY_AUTO   = 0.75;   // ≥ this → auto_approved
const CONSISTENCY_REVIEW = 0.60;   // 0.60–0.75 → needs_review
// < CONSISTENCY_REVIEW → rejected
const FACE_SCORE_MIN     = 0.5;    // reject if best face score < this
const EMBEDDING_MIN      = 0.70;   // guardrail: never auto-approve below this
const CLUSTER_SPLIT      = 0.60;   // two clusters are distinct if sim < this

// ── Cosine similarity ─────────────────────────────────────────────────────────
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function avgPairwiseSim(embeddings: number[][]): number {
  if (embeddings.length < 2) return 1.0;
  let total = 0, count = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      total += cosineSim(embeddings[i], embeddings[j]);
      count++;
    }
  }
  return count ? total / count : 1.0;
}

function centroid(embeddings: number[][]): number[] {
  if (!embeddings.length) return [];
  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);
  for (const emb of embeddings) for (let i = 0; i < dim; i++) sum[i] += emb[i];
  return sum.map((v) => v / embeddings.length);
}

// ── Python face extractor ─────────────────────────────────────────────────────
function runPythonExtractor(urls: string[]): FaceEmbeddingResult[] {
  if (!fs.existsSync(PY_SCRIPT)) return urls.map((u) => nullResult(u));
  try {
    const input  = JSON.stringify({ urls });
    const result = child_process.spawnSync(
      'python3', [PY_SCRIPT, input],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
    );
    if (result.status !== 0) return urls.map((u) => nullResult(u));
    const parsed = JSON.parse(result.stdout.toString());
    return parsed.results as FaceEmbeddingResult[];
  } catch {
    return urls.map((u) => nullResult(u));
  }
}

function nullResult(url: string): FaceEmbeddingResult {
  return { url, faceDetected: false, faceCount: 0, embedding: null, error: null };
}

// ── Identity confirmation (face clustering) ───────────────────────────────────
function confirmIdentity(embeddings: number[][]): IdentityConfirmation {
  if (!embeddings.length) {
    return { consistencyScore: 0, dominantCluster: false, clusterCount: 0, centroidEmbedding: null };
  }
  if (embeddings.length === 1) {
    return { consistencyScore: 1, dominantCluster: true, clusterCount: 1,
             centroidEmbedding: embeddings[0] };
  }

  const consistency = avgPairwiseSim(embeddings);

  // Detect if there are 2+ distinct clusters: any pair with sim < CLUSTER_SPLIT
  let hasDistinctClusters = false;
  outer: for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      if (cosineSim(embeddings[i], embeddings[j]) < CLUSTER_SPLIT) {
        hasDistinctClusters = true; break outer;
      }
    }
  }

  return {
    consistencyScore: consistency,
    dominantCluster: !hasDistinctClusters,
    clusterCount: hasDistinctClusters ? 2 : 1,
    centroidEmbedding: centroid(embeddings),
  };
}

// ── Candidate scoring (spec §C) ───────────────────────────────────────────────
function scoreName(url: string, name: string): number {
  const parts = name.toLowerCase().split(/\s+/);
  const u = url.toLowerCase();
  const matches = parts.filter((p) => u.includes(p)).length;
  return matches / parts.length;
}

function scoreCandidate(
  candidate: PhotoCandidate,
  centroidEmb: number[] | null,
  identity: IdentityConfirmation
): ScoredCandidate {
  // faceScore: 1.0 if single face detected, 0.5 if multi-face, 0 if none
  const faceScore = candidate.faceDetected
    ? candidate.faceCount === 1 ? 1.0 : 0.5
    : 0.0;

  // embeddingScore: similarity to cluster centroid (or 0.5 if no embeddings available)
  let embeddingScore = 0.5;
  if (candidate.faceEmbedding && centroidEmb && centroidEmb.length) {
    embeddingScore = Math.max(0, cosineSim(candidate.faceEmbedding, centroidEmb));
  } else if (!centroidEmb) {
    // No face backend — use source trust as proxy
    embeddingScore = candidate.sourceTrust;
  }

  const nameMatchScore = scoreName(candidate.url, '');  // filled by caller with guestName

  // Final score (spec §C)
  const finalScore =
    faceScore        * 0.4 +
    embeddingScore   * 0.3 +
    nameMatchScore   * 0.1 +
    candidate.sourceTrust * 0.2;

  return { ...candidate, faceScore, embeddingScore, nameMatchScore, finalScore };
}

// ── Review queue I/O ──────────────────────────────────────────────────────────
function loadQueue(): ReviewQueueItem[] {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')); } catch { return []; }
}

function saveQueue(items: ReviewQueueItem[]): void {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2));
}

function appendLog(decisions: EnrichmentDecision[]): void {
  const existing: EnrichmentDecision[] = fs.existsSync(LOG_FILE)
    ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'))
    : [];
  fs.writeFileSync(LOG_FILE, JSON.stringify([...existing, ...decisions], null, 2));
}

// ── Main enrichment function ──────────────────────────────────────────────────
export async function enrichPhotos(
  guestNames: string[],
  maxSearches = 200
): Promise<PhotoCache> {
  const photoCache = readCache<PhotoCache>(PHOTO_FILE) || {};
  const trustStore = loadTrustStore();
  const queue      = loadQueue();
  const queueIds   = new Set(queue.map((q) => q.guestId));
  const newDecisions: EnrichmentDecision[] = [];

  const toProcess = guestNames
    .filter((n) => !photoCache[n])          // skip already-resolved
    .filter((n) => !queueIds.has(slugify(n))) // skip already queued
    .slice(0, maxSearches);

  console.log(`[Enrich] ${toProcess.length} guests to process`);
  let autoApproved = 0, queued = 0, rejected = 0;

  for (const name of toProcess) {
    const guestId = slugify(name);

    // 1. Collect candidate URLs
    const urls = await fetchCandidates(name);
    if (!urls.length) {
      photoCache[name] = { url: null, fetchedAt: new Date().toISOString() };
      continue;
    }

    // 2. Extract face embeddings (Python)
    const embedResults = runPythonExtractor(urls);
    const embedMap = new Map(embedResults.map((r) => [r.url, r]));

    // 3. Build PhotoCandidate list
    const candidates: PhotoCandidate[] = urls.map((url) => {
      const emb = embedMap.get(url);
      return {
        url,
        sourceDomain: extractDomain(url),
        sourceTrust: getTrust(trustStore, url),
        faceEmbedding: emb?.embedding ?? null,
        faceDetected: emb?.faceDetected ?? false,
        faceCount: emb?.faceCount ?? 0,
      };
    });

    // 4. Identity confirmation
    const validEmbeddings = candidates
      .map((c) => c.faceEmbedding)
      .filter((e): e is number[] => e !== null);
    const identity = confirmIdentity(validEmbeddings);

    // 5. Score candidates
    const scored = candidates.map((c) => {
      const s = scoreCandidate(c, identity.centroidEmbedding, identity);
      // Patch nameMatchScore with actual guest name
      s.nameMatchScore = scoreName(c.url, name);
      s.finalScore =
        s.faceScore * 0.4 + s.embeddingScore * 0.3 +
        s.nameMatchScore * 0.1 + c.sourceTrust * 0.2;
      return s;
    });
    scored.sort((a, b) => b.finalScore - a.finalScore);
    const best = scored[0];

    // 6. Decision engine
    let decision: 'auto_approved' | 'needs_review' | 'rejected';
    let rejectedReason: string | undefined;

    // Guardrails (spec §H)
    const hasFaceBackend = validEmbeddings.length > 0;
    const clusterOk = identity.dominantCluster;
    const embOk = !hasFaceBackend || best.embeddingScore >= EMBEDDING_MIN;

    if (!clusterOk) {
      decision = 'rejected';
      rejectedReason = 'multiple_face_clusters';
    } else if (!embOk) {
      decision = 'rejected';
      rejectedReason = 'embedding_below_guardrail';
    } else if (identity.consistencyScore >= CONSISTENCY_AUTO && best.faceScore >= FACE_SCORE_MIN) {
      decision = 'auto_approved';
    } else if (identity.consistencyScore >= CONSISTENCY_REVIEW) {
      decision = 'needs_review';
    } else if (!hasFaceBackend && best.sourceTrust >= 0.85) {
      // No face backend but highly trusted source → auto-approve
      decision = 'auto_approved';
    } else {
      decision = 'rejected';
      rejectedReason = 'consistency_below_threshold';
    }

    const enrichDecision: EnrichmentDecision = {
      guestId, guestName: name, decision,
      selectedUrl: decision === 'auto_approved' ? best.url : null,
      confidence: best.finalScore,
      consistencyScore: identity.consistencyScore,
      candidates: scored,
      rejectedReason,
      decidedAt: new Date().toISOString(),
    };
    newDecisions.push(enrichDecision);

    if (decision === 'auto_approved') {
      photoCache[name] = { url: best.url, fetchedAt: new Date().toISOString() };
      autoApproved++;
    } else if (decision === 'needs_review') {
      queue.push({
        id: `${guestId}-${Date.now()}`,
        guestId, guestName: name,
        candidates: scored,
        bestCandidate: best,
        consistencyScore: identity.consistencyScore,
        createdAt: new Date().toISOString(),
      });
      queued++;
    } else {
      photoCache[name] = { url: null, fetchedAt: new Date().toISOString() };
      rejected++;
    }
  }

  // Persist
  writeCache(PHOTO_FILE, photoCache);
  saveQueue(queue);
  saveTrustStore(trustStore);
  appendLog(newDecisions);

  const withPhoto = Object.values(photoCache).filter((v) => v.url).length;
  console.log(
    `[Enrich] Done — auto:${autoApproved} review:${queued} rejected:${rejected}` +
    ` | total photos: ${withPhoto}/${Object.keys(photoCache).length}`
  );
  return photoCache;
}

// CLI entry point
if (require.main === module) {
  import('fs').then(async ({ default: fs }) => {
    import('path').then(async ({ default: path }) => {
      const guestsPath = path.join(process.cwd(), 'data', 'guests.json');
      const data = JSON.parse(fs.readFileSync(guestsPath, 'utf-8'));
      const names = data.guests.map((g: { name: string }) => g.name);
      await enrichPhotos(names);
    });
  });
}
