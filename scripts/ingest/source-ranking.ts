/**
 * Dynamic source trust scoring engine.
 *
 * Each domain starts with a seed weight from INITIAL_TRUST.
 * After every human review the score shifts online:
 *   approve → score += 0.05 * confidence
 *   reject  → score -= 0.10 * (1 - confidence)
 * Scores are clamped to [0.1, 1.0].
 * New/unseen domains start at 0.5 and are capped at 0.6 until they
 * accumulate ≥2 approvals.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SourceTrustStore, SourceTrustEntry, ReviewEvent } from '../../lib/face-types';

const CACHE_DIR  = path.join(process.cwd(), 'scripts', 'cache');
const TRUST_FILE = path.join(CACHE_DIR, 'source-trust.json');

// Seed weights (domain substring → weight)
const INITIAL_TRUST: Record<string, number> = {
  'wikipedia.org':  1.0,
  'wikimedia.org':  0.95,
  'wikia.com':      0.7,
  'imdb.com':       0.85,
  'nytimes.com':    0.75,
  'theguardian.com':0.75,
  'rollingstone.com':0.7,
  'variety.com':    0.7,
  'hollywoodreporter.com': 0.7,
  'people.com':     0.65,
  'ew.com':         0.65,
  'vulture.com':    0.65,
};

// Default for unknown domains (capped at 0.6 until ≥2 approvals)
const UNKNOWN_SEED    = 0.5;
const UNKNOWN_CAP     = 0.6;
const MIN_APPROVALS_FOR_BOOST = 2;

// Default per-domain embedding similarity threshold
export const DEFAULT_THRESHOLD = 0.6;

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function loadTrustStore(): SourceTrustStore {
  ensureDir();
  if (!fs.existsSync(TRUST_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TRUST_FILE, 'utf-8')) as SourceTrustStore;
  } catch {
    return {};
  }
}

export function saveTrustStore(store: SourceTrustStore): void {
  ensureDir();
  fs.writeFileSync(TRUST_FILE, JSON.stringify(store, null, 2));
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function seedScore(domain: string): number {
  for (const [pattern, weight] of Object.entries(INITIAL_TRUST)) {
    if (domain.includes(pattern)) return weight;
  }
  return UNKNOWN_SEED;
}

export function getEntry(store: SourceTrustStore, domain: string): SourceTrustEntry {
  if (!store[domain]) {
    store[domain] = {
      domain,
      score: seedScore(domain),
      approvals: 0,
      rejections: 0,
      embeddingThreshold: DEFAULT_THRESHOLD,
      lastUpdated: new Date().toISOString(),
    };
  }
  return store[domain];
}

export function getTrust(store: SourceTrustStore, url: string): number {
  const domain = extractDomain(url);
  const entry  = getEntry(store, domain);
  // Cap unknown domains until enough approvals
  if (entry.approvals < MIN_APPROVALS_FOR_BOOST && seedScore(domain) === UNKNOWN_SEED) {
    return Math.min(entry.score, UNKNOWN_CAP);
  }
  return entry.score;
}

export function applyReviewOutcome(
  store: SourceTrustStore,
  event: ReviewEvent
): void {
  const domain = extractDomain(event.imageUrl);
  const entry  = getEntry(store, domain);

  if (event.decision === 'approve') {
    entry.score     += 0.05 * event.confidence;
    entry.approvals += 1;
  } else {
    entry.score     -= 0.10 * (1 - event.confidence);
    entry.rejections += 1;
  }

  // Clamp to [0.1, 1.0]
  entry.score = Math.max(0.1, Math.min(1.0, entry.score));
  entry.lastUpdated = new Date().toISOString();
  store[domain] = entry;
}

/**
 * Adaptive threshold: if a source has low precision, tighten its threshold.
 * Called by the weekly calibration job.
 */
export function recalibrateThresholds(store: SourceTrustStore): void {
  for (const entry of Object.values(store)) {
    const total = entry.approvals + entry.rejections;
    if (total < 5) continue; // not enough data
    const precision = entry.approvals / total;
    if (precision < 0.8) {
      entry.embeddingThreshold = Math.min(0.9, entry.embeddingThreshold + 0.05);
    } else if (precision >= 0.95) {
      // High precision — loosen slightly to improve recall
      entry.embeddingThreshold = Math.max(0.5, entry.embeddingThreshold - 0.02);
    }
  }
}

/** Apply a batch of review events (used by weekly calibration). */
export function applyBatchEvents(events: ReviewEvent[]): SourceTrustStore {
  const store = loadTrustStore();
  for (const ev of events) applyReviewOutcome(store, ev);
  recalibrateThresholds(store);
  saveTrustStore(store);
  return store;
}
