import * as fs from 'fs';
import * as path from 'path';
import type { Metadata } from 'next';
import PhotoReviewQueue from '@/components/PhotoReviewQueue';
import type { ReviewQueueItem } from '@/lib/face-types';

export const metadata: Metadata = {
  title: 'Photo Review — The Friend Registry',
  description: 'Human review queue for guest photo enrichment',
};

// Force dynamic so it reads the queue fresh on each load
export const dynamic = 'force-dynamic';

function loadQueue(): ReviewQueueItem[] {
  const queueFile = path.join(process.cwd(), 'scripts', 'cache', 'review-queue.json');
  if (!fs.existsSync(queueFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(queueFile, 'utf-8')) as ReviewQueueItem[];
  } catch {
    return [];
  }
}

export default function ReviewPage() {
  const queue = loadQueue();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-4xl font-semibold mb-2">
          Photo Review Queue
        </h1>
        <p className="text-[var(--text-muted)]">
          Images the enrichment engine flagged for human verification.
          Select the best candidate and approve or reject.
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 mb-8 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg2)] text-sm">
        <div>
          <span className="text-[var(--text-muted)]">Pending</span>
          <p className="font-semibold text-lg mt-0.5">{queue.length}</p>
        </div>
        <div className="border-l border-[var(--border)] pl-6">
          <span className="text-[var(--text-muted)]">System</span>
          <p className="font-semibold text-lg mt-0.5 text-[var(--teal)]">Active</p>
        </div>
        <div className="border-l border-[var(--border)] pl-6 ml-auto text-right">
          <span className="text-[var(--text-muted)]">Run enrichment</span>
          <p className="font-mono text-xs mt-1 text-[var(--text-muted)]">
            npm run enrich:photos
          </p>
        </div>
      </div>

      <PhotoReviewQueue initialQueue={queue} />
    </div>
  );
}
