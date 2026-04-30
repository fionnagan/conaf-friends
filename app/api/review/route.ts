/**
 * Review decision API.
 *
 * POST /api/review  { itemId, decision, reason?, imageUrl }
 * GET  /api/review  → current queue + count
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { ReviewEvent, ReviewQueueItem, SourceTrustStore } from '@/lib/face-types';
import type { PhotoCache } from '@/lib/types';

const CACHE_DIR   = path.join(process.cwd(), 'scripts', 'cache');
const QUEUE_FILE  = path.join(CACHE_DIR, 'review-queue.json');
const EVENTS_FILE = path.join(CACHE_DIR, 'review-events.json');
const PHOTO_FILE  = path.join(CACHE_DIR, 'photos.json');
const TRUST_FILE  = path.join(CACHE_DIR, 'source-trust.json');

function readJSON<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

function writeJSON(file: string, data: unknown): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}

function applyTrustUpdate(
  store: SourceTrustStore,
  domain: string,
  decision: 'approve' | 'reject',
  confidence: number
): void {
  const entry = store[domain] ?? {
    domain, score: 0.5, approvals: 0, rejections: 0,
    embeddingThreshold: 0.6, lastUpdated: '',
  };
  if (decision === 'approve') {
    entry.score     = Math.min(1.0, entry.score + 0.05 * confidence);
    entry.approvals += 1;
  } else {
    entry.score     = Math.max(0.1, entry.score - 0.10 * (1 - confidence));
    entry.rejections += 1;
  }
  entry.lastUpdated = new Date().toISOString();
  store[domain] = entry;
}

export async function GET() {
  const queue = readJSON<ReviewQueueItem[]>(QUEUE_FILE, []);
  return NextResponse.json({ queue, count: queue.length });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { itemId, decision, reason, imageUrl } = body as {
    itemId: string;
    decision: 'approve' | 'reject';
    reason?: string;
    imageUrl: string;
  };

  if (!itemId || !decision || !imageUrl) {
    return NextResponse.json(
      { error: 'itemId, decision, imageUrl required' }, { status: 400 }
    );
  }

  const queue = readJSON<ReviewQueueItem[]>(QUEUE_FILE, []);
  const itemIdx = queue.findIndex((q) => q.id === itemId);
  if (itemIdx === -1) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }
  const item = queue[itemIdx];
  const candidate = item.candidates.find((c) => c.url === imageUrl) ?? item.bestCandidate;

  // Persist review event
  const event: ReviewEvent = {
    id: `${itemId}-${Date.now()}`,
    guestId: item.guestId,
    guestName: item.guestName,
    imageUrl,
    decision,
    reason,
    faceScore: candidate.faceScore,
    embeddingScore: candidate.embeddingScore,
    source: extractDomain(imageUrl),
    confidence: candidate.finalScore,
    reviewedAt: new Date().toISOString(),
  };
  const events = readJSON<ReviewEvent[]>(EVENTS_FILE, []);
  events.push(event);
  writeJSON(EVENTS_FILE, events);

  // Update source trust
  const trustStore = readJSON<SourceTrustStore>(TRUST_FILE, {});
  applyTrustUpdate(trustStore, extractDomain(imageUrl), decision, candidate.finalScore);
  writeJSON(TRUST_FILE, trustStore);

  // Update photo cache
  const photoCache = readJSON<PhotoCache>(PHOTO_FILE, {});
  photoCache[item.guestName] = {
    url: decision === 'approve' ? imageUrl : null,
    fetchedAt: new Date().toISOString(),
  };
  writeJSON(PHOTO_FILE, photoCache);

  // Remove from queue
  queue.splice(itemIdx, 1);
  writeJSON(QUEUE_FILE, queue);

  return NextResponse.json({ ok: true, remaining: queue.length });
}
