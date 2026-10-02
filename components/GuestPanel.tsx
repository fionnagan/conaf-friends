"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Guest, Episode } from "@/lib/types";
import { ORIGIN_LABELS, getGuestsData, resolveEpisode, getCoGuests } from "@/lib/data";
import GuestAvatar from "./GuestAvatar";
import FriendshipBadge from "./FriendshipBadge";
import FriendshipArc from "./FriendshipArc";
import GuestPagePlayer from "./GuestPagePlayer";
import type { PlayableMedia } from "@/lib/PlayerContext";

interface Props {
  guestId: string | null;
  onClose: () => void;
}

const SCORE_FACTOR_LABELS = {
  appearances: "Total appearances",
  coldOpenSentiment: "Cold open sentiment",
  originDepth: "Origin depth",
  gapResilience: "Gap resilience",
};
const SCORE_FACTOR_MAX = {
  appearances: 35,
  coldOpenSentiment: 30,
  originDepth: 23,
  gapResilience: 12,
};

export default function GuestPanel({ guestId, onClose }: Props) {
  const isOpen = !!guestId;
  const [guest, setGuest] = useState<Guest | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [allGuests, setAllGuests] = useState<Guest[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!guestId) { setGuest(null); return; }
    const data = getGuestsData();
    const found = data.guests.find((g) => g.id === guestId) || null;
    setGuest(found);
    setEpisodes(data.episodes);
    setAllGuests(data.guests);
  }, [guestId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const relatedGuests = guest?.relatedGuests
    ?.map((id) => getGuestsData().guests.find((g) => g.id === id))
    .filter(Boolean) as Guest[] | undefined;

  return (
    <>
      {/* Overlay */}
      <div
        className={`panel-overlay ${isOpen ? "open" : ""}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div ref={panelRef} className={`slide-panel ${isOpen ? "open" : ""}`}>
        {!guest ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            Loading…
          </div>
        ) : (
          <div className="pb-16">
            {/* Header */}
            <div className="sticky top-0 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-3 flex items-center justify-between z-10">
              <span className="text-sm text-[var(--text-muted)]">Guest profile</span>
              <div className="flex gap-2">
                <Link
                  href={`/guest/${guest.id}`}
                  className="text-xs px-3 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)]"
                >
                  Full page ↗
                </Link>
                <button
                  onClick={onClose}
                  className="text-xs px-3 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)]"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Hero */}
            <div className="px-6 pt-8 pb-6 flex gap-6 items-start">
              <GuestAvatar name={guest.name} photoUrl={guest.photoUrl} size={80} />
              <div className="flex-1">
                <h2 className="font-serif text-3xl font-semibold text-[var(--text)]">
                  {guest.name}
                </h2>
                <div className="mt-1 flex flex-wrap gap-2 items-center">
                  <span className="text-sm text-[var(--text-muted)]">
                    {ORIGIN_LABELS[guest.origin.type] || guest.origin.label}
                  </span>
                  <span className="text-[var(--border)]">·</span>
                  <span className="text-sm text-[var(--text-muted)]">
                    {guest.appearances.length} appearance
                    {guest.appearances.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="mt-3">
                  <FriendshipBadge
                    score={guest.friendshipScore}
                    label={guest.friendshipLabel}
                    size="sm"
                  />
                </div>
              </div>
            </div>

            {/* Score breakdown */}
            <div className="px-6 mb-6">
              <h3 className="font-serif text-lg font-semibold mb-3">
                Score breakdown
              </h3>
              <div className="space-y-2">
                {(
                  Object.entries(guest.scoreBreakdown) as [
                    keyof typeof SCORE_FACTOR_LABELS,
                    number
                  ][]
                ).map(([key, val]) => {
                  const max = SCORE_FACTOR_MAX[key];
                  const pct = Math.round((val / max) * 100);
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--text-muted)]">
                          {SCORE_FACTOR_LABELS[key]}
                        </span>
                        <span className="font-semibold">
                          {val}/{max}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--purple)] rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-3 text-center">
                A fan-made score, made with love ♥
              </p>
            </div>

            {/* Friendship Arc */}
            <div className="px-6 mb-6">
              <h3 className="font-serif text-lg font-semibold mb-3">
                Friendship Arc
              </h3>
              <div className="bg-[var(--bg2)] rounded-xl border border-[var(--border)] p-4 overflow-x-auto">
                <FriendshipArc guest={guest} episodes={episodes} />
              </div>
            </div>

            {/* Appearances */}
            <div className="px-6 mb-6">
              <h3 className="font-serif text-lg font-semibold mb-3">
                All appearances
              </h3>
              <div className="space-y-3">
                {guest.appearances.map((app, i) => {
                  const episode = resolveEpisode(app, episodes);
                  const media: PlayableMedia | null = episode
                    ? {
                        era: app.era,
                        date: app.date,
                        episodeTitle: episode.title,
                        episodeUrl: episode.url,
                        audioUrl: episode.audioUrl,
                        youtubeVideoId: episode.youtubeVideoId,
                        artworkUrl: episode.artworkUrl,
                        coldOpenWord: app.coldOpenWord,
                        coldOpenSentiment: app.coldOpenSentiment,
                      }
                    : null;
                  const coGuests = getCoGuests(guest.id, app, allGuests);
                  return (
                    <GuestPagePlayer
                      key={i}
                      appearance={app}
                      guestName={guest.name}
                      media={media}
                      coGuests={coGuests}
                    />
                  );
                })}
              </div>
            </div>

            {/* Related guests */}
            {relatedGuests && relatedGuests.length > 0 && (
              <div className="px-6">
                <h3 className="font-serif text-lg font-semibold mb-3">
                  Similar friends
                </h3>
                <div className="flex flex-wrap gap-2">
                  {relatedGuests.map((rg) => (
                    <button
                      key={rg.id}
                      className="flex items-center gap-2 p-2 bg-[var(--bg2)] border border-[var(--border)] rounded-xl hover:border-[var(--purple)] transition-colors"
                      onClick={() => {
                        // Navigate to related guest — caller handles this
                        window.location.href = `/guest/${rg.id}`;
                      }}
                    >
                      <GuestAvatar name={rg.name} photoUrl={rg.photoUrl} size={28} />
                      <span className="text-sm">{rg.name}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {rg.friendshipScore}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
