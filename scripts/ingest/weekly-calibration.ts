/**
 * Weekly calibration job.
 *
 * Reads all review-events.json, aggregates outcomes per source domain, then:
 *   1. Updates source trust scores (online-learning update rule)
 *   2. Recalibrates per-domain embedding thresholds
 *   3. Emits a calibration report
 *
 * Run via:  npm run enrich:calibrate
 * Also invoked automatically by the weekly scheduled task.
 */

import * as fs from 'fs';
import * as path from 'path';
import { applyBatchEvents, loadTrustStore, extractDomain } from './source-ranking';
import type { ReviewEvent } from '../../lib/face-types';

const CACHE_DIR    = path.join(process.cwd(), 'scripts', 'cache');
const EVENTS_FILE  = path.join(CACHE_DIR, 'review-events.json');
const CALIB_FILE   = path.join(CACHE_DIR, 'calibration-state.json');

function loadEvents(): ReviewEvent[] {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8')); } catch { return []; }
}

function loadLastCalibrated(): string | null {
  if (!fs.existsSync(CALIB_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CALIB_FILE, 'utf-8')).lastCalibrated ?? null;
  } catch { return null; }
}

function report(events: ReviewEvent[], previousTotal: number) {
  const byDomain: Record<string, { approvals: number; rejections: number; precisions: number[] }> = {};

  for (const ev of events) {
    const domain = extractDomain(ev.imageUrl);
    if (!byDomain[domain]) byDomain[domain] = { approvals: 0, rejections: 0, precisions: [] };
    if (ev.decision === 'approve') {
      byDomain[domain].approvals++;
      byDomain[domain].precisions.push(ev.confidence);
    } else {
      byDomain[domain].rejections++;
    }
  }

  console.log('\n=== Weekly Calibration Report ===');
  console.log(`Total review events processed: ${events.length} (+${events.length - previousTotal} new)`);
  console.log(`\nPer-domain breakdown:`);
  for (const [domain, stats] of Object.entries(byDomain).sort((a, b) =>
    (b[1].approvals + b[1].rejections) - (a[1].approvals + a[1].rejections)
  )) {
    const total     = stats.approvals + stats.rejections;
    const precision = total ? (stats.approvals / total * 100).toFixed(1) : 'n/a';
    const avgConf   = stats.precisions.length
      ? (stats.precisions.reduce((s, v) => s + v, 0) / stats.precisions.length).toFixed(2)
      : 'n/a';
    console.log(`  ${domain.padEnd(32)} ${stats.approvals}✓ ${stats.rejections}✗  precision=${precision}%  avg_conf=${avgConf}`);
  }

  const store = loadTrustStore();
  console.log('\nUpdated trust scores:');
  for (const [domain, entry] of Object.entries(store).sort((a, b) => b[1].score - a[1].score)) {
    console.log(`  ${domain.padEnd(32)} score=${entry.score.toFixed(3)}  threshold=${entry.embeddingThreshold.toFixed(2)}`);
  }
  console.log('');
}

export async function runCalibration(): Promise<void> {
  const events = loadEvents();
  const lastCalibrated = loadLastCalibrated();
  const previousTotal = lastCalibrated
    ? events.filter((e) => e.reviewedAt < lastCalibrated).length
    : 0;

  // Only process events since last calibration
  const newEvents = lastCalibrated
    ? events.filter((e) => e.reviewedAt > lastCalibrated)
    : events;

  if (!newEvents.length) {
    console.log('[Calibration] No new review events since last run.');
    return;
  }

  console.log(`[Calibration] Applying ${newEvents.length} new review events…`);
  applyBatchEvents(newEvents);

  const state = {
    lastCalibrated: new Date().toISOString(),
    totalReviews: events.length,
    autoApprovalRate: null,   // computed externally from enrichment-log.json
    falsePositiveRate: null,
  };
  fs.writeFileSync(CALIB_FILE, JSON.stringify(state, null, 2));

  report(events, previousTotal);
}

if (require.main === module) {
  runCalibration().catch(console.error);
}
