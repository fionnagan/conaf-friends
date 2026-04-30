"use client";

import { useState, useRef, useEffect } from "react";
import type { Appearance } from "@/lib/types";

interface Props {
  appearance: Appearance;
  guestName: string;
  compact?: boolean;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function AudioPlayer({
  audioUrl,
  artworkUrl,
  title,
  guestName,
}: {
  audioUrl: string;
  artworkUrl?: string;
  title?: string;
  guestName: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play(); setPlaying(true); }
  }

  function skipBack() {
    if (audioRef.current) audioRef.current.currentTime -= 15;
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
    setCurrent(audio.currentTime);
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-[var(--bg2)] rounded-xl border border-[var(--border)]">
      {/* Artwork */}
      {artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt={guestName}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-[var(--purple)] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">
            {guestName.split(" ").map((p) => p[0]).join("").slice(0, 2)}
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate text-[var(--text)]">{guestName}</p>
        <p className="text-xs text-[var(--text-muted)] truncate">{title || "Episode"}</p>

        {/* Progress */}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-[var(--text-muted)] w-8">{formatTime(current)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={current}
            onChange={seek}
            className="flex-1 h-1 accent-[var(--orange)]"
          />
          <span className="text-xs text-[var(--text-muted)] w-8">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={skipBack}
          className="p-1.5 rounded-full hover:bg-[var(--bg3)] text-[var(--text-muted)] hover:text-[var(--text)]"
          title="Back 15s"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
            <text x="9" y="16" fontSize="6" fontFamily="Arial" fill="currentColor">15</text>
          </svg>
        </button>
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full bg-[var(--orange)] text-white flex items-center justify-center hover:opacity-90"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>
      </div>

      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Attribution */}
      <div className="ml-1 text-[10px] text-[var(--text-muted)] flex-shrink-0 text-right hidden sm:block">
        <div>Audio via</div>
        <div className="font-semibold">Team Coco</div>
      </div>
    </div>
  );
}

function YouTubePlayer({ videoId, title }: { videoId: string; title?: string }) {
  return (
    <div className="space-y-1">
      <div className="relative w-full rounded-xl overflow-hidden" style={{ paddingTop: "56.25%" }}>
        <iframe
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube.com/embed/${videoId}?rel=0`}
          title={title || "Conan O'Brien Needs a Friend episode"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <p className="text-[10px] text-[var(--text-muted)] text-right">
        Video via{" "}
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold hover:text-[var(--orange)]"
        >
          Team Coco YouTube ↗
        </a>
      </p>
    </div>
  );
}

function FallbackLinks({ episodeUrl, episodeTitle }: { episodeUrl?: string; episodeTitle?: string }) {
  return (
    <div className="p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)] text-center space-y-3">
      <p className="text-sm text-[var(--text-muted)]">Listen to this episode:</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {episodeUrl && (
          <a
            href={episodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-[var(--orange)] text-white text-sm rounded-lg hover:opacity-90"
          >
            Open Episode ↗
          </a>
        )}
        <a
          href="https://podcasts.apple.com/us/podcast/conan-obrien-needs-a-friend/id1438054347"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 bg-[var(--border)] text-[var(--text)] text-sm rounded-lg hover:bg-[var(--text-muted)] hover:text-white"
        >
          Apple Podcasts
        </a>
        <a
          href="https://open.spotify.com/show/4xdKuRUEDhPi3ORJEo9mJ4"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 bg-[var(--border)] text-[var(--text)] text-sm rounded-lg hover:bg-[var(--text-muted)] hover:text-white"
        >
          Spotify
        </a>
      </div>
      {episodeTitle && (
        <p className="text-xs text-[var(--text-muted)]">&ldquo;{episodeTitle}&rdquo;</p>
      )}
    </div>
  );
}

export default function EpisodePlayer({ appearance, guestName, compact = false }: Props) {
  if (appearance.youtubeVideoId && !compact) {
    return (
      <YouTubePlayer
        videoId={appearance.youtubeVideoId}
        title={appearance.episodeTitle}
      />
    );
  }

  if (appearance.audioUrl) {
    return (
      <AudioPlayer
        audioUrl={appearance.audioUrl}
        artworkUrl={appearance.artworkUrl}
        title={appearance.episodeTitle}
        guestName={guestName}
      />
    );
  }

  return (
    <FallbackLinks
      episodeUrl={appearance.episodeUrl}
      episodeTitle={appearance.episodeTitle}
    />
  );
}
