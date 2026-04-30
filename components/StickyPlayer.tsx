"use client";

import { usePlayer } from "@/lib/PlayerContext";
import EpisodePlayer from "./EpisodePlayer";

export default function StickyPlayer() {
  const { player, dismiss } = usePlayer();

  return (
    <>
      <div className={`sticky-player ${player.isVisible ? "visible" : ""}`}>
        <div className="bg-[var(--bg)] border-t border-[var(--border)] px-4 py-3">
          <div className="max-w-3xl mx-auto relative">
            <button
              onClick={dismiss}
              className="absolute -top-8 right-0 bg-[var(--bg)] border border-[var(--border)] rounded-t-lg px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              ✕ Close player
            </button>
            {player.appearance && (
              <EpisodePlayer
                appearance={player.appearance}
                guestName={player.guestName}
                compact
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
