"use client";

import { useState } from "react";
import Link from "next/link";
import type { Appearance, Guest } from "@/lib/types";
import { ERA_LABELS, formatDate } from "@/lib/data";
import EraBadge from "./EraBadge";
import EpisodePlayer from "./EpisodePlayer";
import type { PlayableMedia } from "@/lib/PlayerContext";
import { usePlayer } from "@/lib/PlayerContext";

interface Props {
  appearance: Appearance;
  guestName: string;
  /** Resolved from the shared Episode this appearance references — null for
   * appearances with no episodeId (e.g. late-night, which has no media). */
  media: PlayableMedia | null;
  /** Other guests who share this same episode, if any. */
  coGuests: Guest[];
}

export default function GuestPagePlayer({ appearance, guestName, media, coGuests }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { play } = usePlayer();

  const hasMedia = !!(media?.audioUrl || media?.youtubeVideoId);

  return (
    <div className="p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)]">
      <div className="flex items-start gap-3">
        <EraBadge era={appearance.era} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {media?.episodeTitle || appearance.episodeTitle || ERA_LABELS[appearance.era]}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {formatDate(appearance.date)}
            {appearance.coldOpenWord && (
              <span className="ml-2 italic text-[var(--purple)]">
                · &ldquo;{appearance.coldOpenWord}&rdquo;
              </span>
            )}
          </p>
          {coGuests.length > 0 && (
            <p className="text-xs mt-1">
              {coGuests.map((cg, i) => (
                <span key={cg.id}>
                  {i > 0 && ", "}
                  <Link href={`/guest/${cg.id}`} className="text-[var(--purple)] hover:underline">
                    with {cg.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {hasMedia && media && (
            <button
              onClick={() => {
                setExpanded((v) => !v);
                if (!expanded) play(media, guestName);
              }}
              className="text-xs px-2.5 py-1.5 bg-[var(--orange)] text-white rounded-lg hover:opacity-90"
            >
              {expanded ? "▼" : "▶"} Play
            </button>
          )}
          {media?.episodeUrl && (
            <a
              href={media.episodeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2.5 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)]"
            >
              Open ↗
            </a>
          )}
        </div>
      </div>

      {expanded && hasMedia && media && (
        <div className="mt-4">
          <EpisodePlayer media={media} guestName={guestName} />
        </div>
      )}
    </div>
  );
}
