"use client";

import { useState } from "react";
import Image from "next/image";
import type { ReviewQueueItem, ScoredCandidate } from "@/lib/face-types";

interface Props {
  initialQueue: ReviewQueueItem[];
}

const REASONS = [
  "correct_person",
  "wrong_person",
  "group_photo",
  "low_quality",
  "logo_or_graphic",
  "other",
];

function ConfidenceBadge({ score }: { score: number }) {
  const pct  = Math.round(score * 100);
  const color = pct >= 75 ? "var(--teal)" : pct >= 60 ? "var(--amber)" : "var(--orange)";
  return (
    <span
      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
      style={{ background: color + "22", color }}
    >
      {pct}%
    </span>
  );
}

function CandidateCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ScoredCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="relative rounded-xl overflow-hidden border-2 transition-all"
      style={{
        borderColor: selected ? "var(--orange)" : "var(--border)",
        background: "var(--bg3)",
      }}
    >
      <div className="relative w-full aspect-square">
        <Image
          src={candidate.url}
          alt="candidate"
          fill
          className="object-cover"
          unoptimized
        />
      </div>
      <div className="p-2 text-left space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <ConfidenceBadge score={candidate.finalScore} />
          {candidate.faceDetected && (
            <span className="text-[10px] px-1 py-0.5 rounded-full bg-[var(--teal)]22 text-[var(--teal)]">
              face ✓
            </span>
          )}
        </div>
        <p
          className="text-[10px] text-[var(--text-muted)] truncate"
          title={candidate.sourceDomain}
        >
          {candidate.sourceDomain}
        </p>
        <div className="text-[10px] text-[var(--text-muted)] space-y-0.5">
          <div>face: {(candidate.faceScore * 100).toFixed(0)}%</div>
          <div>emb: {(candidate.embeddingScore * 100).toFixed(0)}%</div>
          <div>trust: {(candidate.sourceTrust * 100).toFixed(0)}%</div>
        </div>
      </div>
      {selected && (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs"
          style={{ background: "var(--orange)" }}
        >
          ✓
        </div>
      )}
    </button>
  );
}

function ReviewCard({
  item,
  onDecision,
}: {
  item: ReviewQueueItem;
  onDecision: (itemId: string, decision: "approve" | "reject", imageUrl: string, reason?: string) => void;
}) {
  const [selectedUrl, setSelectedUrl] = useState(item.bestCandidate.url);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const consistencyPct = Math.round(item.consistencyScore * 100);
  const consistencyColor =
    item.consistencyScore >= 0.75
      ? "var(--teal)"
      : item.consistencyScore >= 0.6
      ? "var(--amber)"
      : "var(--orange)";

  async function submit(decision: "approve" | "reject") {
    setSubmitting(true);
    await onDecision(item.id, decision, selectedUrl, reason || undefined);
  }

  return (
    <div
      className="rounded-2xl border p-5 space-y-4"
      style={{ background: "var(--bg2)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{item.guestName}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[var(--text-muted)]">
              consistency:
            </span>
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: consistencyColor + "22", color: consistencyColor }}
            >
              {consistencyPct}%
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {item.candidates.length} candidates
            </span>
          </div>
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Candidate grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {item.candidates.map((c) => (
          <CandidateCard
            key={c.url}
            candidate={c}
            selected={c.url === selectedUrl}
            onSelect={() => setSelectedUrl(c.url)}
          />
        ))}
      </div>

      {/* Reason + actions */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-lg border bg-[var(--bg3)] border-[var(--border)] flex-1 min-w-32"
        >
          <option value="">Reason (optional)</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button
          disabled={submitting}
          onClick={() => submit("reject")}
          className="px-4 py-1.5 rounded-lg text-sm border border-[var(--border)] hover:bg-[var(--bg3)] disabled:opacity-50"
        >
          Reject
        </button>
        <button
          disabled={submitting}
          onClick={() => submit("approve")}
          className="px-4 py-1.5 rounded-lg text-sm text-white disabled:opacity-50"
          style={{ background: "var(--orange)" }}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

export default function PhotoReviewQueue({ initialQueue }: Props) {
  const [queue, setQueue] = useState<ReviewQueueItem[]>(initialQueue);
  const [done, setDone]   = useState(0);

  async function handleDecision(
    itemId: string,
    decision: "approve" | "reject",
    imageUrl: string,
    reason?: string
  ) {
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, decision, imageUrl, reason }),
    });
    if (res.ok) {
      setQueue((q) => q.filter((i) => i.id !== itemId));
      setDone((d) => d + 1);
    }
  }

  if (!queue.length) {
    return (
      <div className="text-center py-24">
        <p className="text-4xl mb-3">✓</p>
        <p className="font-semibold text-lg mb-1">Review queue empty</p>
        <p className="text-sm text-[var(--text-muted)]">
          {done > 0 ? `${done} item${done > 1 ? "s" : ""} reviewed this session.` : "Nothing pending."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-muted)]">
        {queue.length} item{queue.length > 1 ? "s" : ""} pending
        {done > 0 ? ` · ${done} reviewed` : ""}
      </p>
      {queue.map((item) => (
        <ReviewCard key={item.id} item={item} onDecision={handleDecision} />
      ))}
    </div>
  );
}
