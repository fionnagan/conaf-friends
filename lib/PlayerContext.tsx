"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import type { Appearance } from "./types";

interface PlayerState {
  appearance: Appearance | null;
  guestName: string;
  isVisible: boolean;
}

interface PlayerContextValue {
  player: PlayerState;
  play: (appearance: Appearance, guestName: string) => void;
  dismiss: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<PlayerState>({
    appearance: null,
    guestName: "",
    isVisible: false,
  });

  const play = useCallback((appearance: Appearance, guestName: string) => {
    setPlayer({ appearance, guestName, isVisible: true });
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
