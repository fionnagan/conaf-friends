"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import type { Era, ColdOpenSentiment } from "./types";

/** The handful of fields the player actually needs to render — resolved
 * from an Episode (for podcast appearances) or passed inline (late-night,
 * which has no media to play). Decoupled from Appearance/Episode's own
 * shapes so callers don't need to reconstruct a full one just to play. */
export interface PlayableMedia {
  era: Era;
  date: string;
  episodeTitle?: string;
  episodeUrl?: string;
  audioUrl?: string;
  youtubeVideoId?: string | null;
  artworkUrl?: string;
  coldOpenWord?: string;
  coldOpenSentiment?: ColdOpenSentiment;
}

interface PlayerState {
  media: PlayableMedia | null;
  guestName: string;
  isVisible: boolean;
}

interface PlayerContextValue {
  player: PlayerState;
  play: (media: PlayableMedia, guestName: string) => void;
  dismiss: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<PlayerState>({
    media: null,
    guestName: "",
    isVisible: false,
  });

  const play = useCallback((media: PlayableMedia, guestName: string) => {
    setPlayer({ media, guestName, isVisible: true });
  }, []);

  const dismiss = useCallback(() => {
    setPlayer((prev) => ({ ...prev, isVisible: false }));
  }, []);

  return (
    <PlayerContext.Provider value={{ player, play, dismiss }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
