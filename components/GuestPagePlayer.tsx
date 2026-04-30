"use client";

import { useState } from "react";
import type { Appearance } from "@/lib/types";
import { ERA_LABELS, formatDate } from "@/lib/data";
import EraBadge from "./EraBadge";
import EpisodePlayer from "./EpisodePlayer";
import { usePlayer } from "@/lib/PlayerContext";

interface Props {
  appearance: Appearance;
  guestName: string;
}

export default function GuestPagePlayer({ appearance, guestName }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { play } = usePlayer();

  const hasMedia = !!(appearance.audioUrl || appearance.youtubeVideoId);

  return (
    <div className="p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)]">
      <div className="flex items-start gap-3">
        <EraBadge era={appearance.era} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {appearance.episodeTitle || ERA_LABELS[appearance.era]}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {formatDate(appearance.date)}
            {appearance.promoVisit && (
              <span className="ml-2 text-[var(--amber)]">· promo visit</span>
            )}
            {appearance.coldOpenWord && (
              <span className="ml-2 italic text-[var(--purple)]">
                · &ldquo;{appearance.coldOpenWord}&rdquo;
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {hasMedia && (
            <button
              onClick={() => {
                setExpanded((v) => !v);
                if (!expanded) play(appearance, guestName);
              }}
              className="text-xs px-2.5 py-1.5 bg-[var(--orange)] text-white rounded-lg hover:opacity-90"
            >
              {expanded ? "▼" : "▶"} Play
            </button>
          )}
          {appearance.episodeUrl && (
            <a
              href={appearance.episodeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2.5 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)]"
            >
              Open ↗
            </a>
          )}
        </div>
      </div>

      {expanded && hasMedia && (
        <div className="mt-4">
          <EpisodePlayer appearance={appearance} guestName={guestName} />
        </div>
      )}
    </div>
  );
}
