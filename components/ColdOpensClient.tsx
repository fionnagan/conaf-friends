"use client";

import { useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { ColdOpenSentiment } from "@/lib/types";
import { formatDate } from "@/lib/data";
import GuestAvatar from "./GuestAvatar";
import { usePlayer } from "@/lib/PlayerContext";

interface ColdOpen {
  guestId: string;
  guestName: string;
  guestPhotoUrl: string | null;
  word: string;
  sentiment?: ColdOpenSentiment;
  date: string;
  episodeTitle?: string;
  episodeUrl?: string;
  audioUrl?: string;
  youtubeVideoId?: string | null;
  artworkUrl?: string;
}

interface Props {
  coldOpens: ColdOpen[];
}

const SENTIMENT_COLORS: Record<ColdOpenSentiment, string> = {
  warm: "#3AAFA9",
  "affectionate-absurd": "#7F77DD",
  neutral: "#9A9590",
  deflecting: "#D4A847",
  anxious: "#E85D24",
  callback: "#6B63CC",
};

const SENTIMENT_LABELS: Record<ColdOpenSentiment, string> = {
  warm: "Warm",
  "affectionate-absurd": "Affectionate & Absurd",
  neutral: "Neutral",
  deflecting: "Deflecting",
  anxious: "Anxious",
  callback: "Callback",
};

function WordCloudArt() {
  return (
    <div className="rounded-2xl overflow-hidden border border-[var(--border)] mb-8">
      <div className="bg-[var(--bg2)] px-6 pt-6 pb-2">
        <h2 className="text-xl font-semibold mb-1">How Conan&apos;s friends feel</h2>
        <p className="text-xs text-[var(--text-muted)]">Cold open words shaped like the man himself</p>
      </div>
      {/* Dark bg so the transparent outer mask area recedes, making silhouette pop */}
      <div style={{ background: "var(--bg)", lineHeight: 0 }}>
        <Image
          src="/conan-wordcloud.png"
          alt="Word cloud of cold open emotional descriptors shaped like Conan O'Brien's head"
          width={512}
          height={512}
          style={{ width: "100%", height: "auto", display: "block" }}
          priority
          unoptimized
        />
      </div>
    </div>
  );
}

/** sessionStorage key for saving scroll position for a given page URL */
const scrollKey = (url: string) => `navScroll:${url}`;

export default function ColdOpensClient({ coldOpens }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { play } = usePlayer();

  // ── Filter state lives in URL params ──────────────────────────────────────
  const search = searchParams.get("q") ?? "";
  const sentimentFilter = (searchParams.get("sentiment") as ColdOpenSentiment | "all") ?? "all";

  // Local input state for debouncing the URL update (avoids URL churn per keystroke)
  const inputRef = useRef(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  /** Build the full URL string including current params — used as the `from` value */
  function currentPageUrl(): string {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  /** Update a single URL param without scrolling or adding history */
  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    inputRef.current = v;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParam("q", v || null), 300);
  }

  function handleSentimentChange(s: ColdOpenSentiment | "all") {
    updateParam("sentiment", s === "all" ? null : s);
  }

  // ── Scroll save — called just before navigating to a guest profile ─────────
  function saveScroll() {
    try {
      sessionStorage.setItem(scrollKey(currentPageUrl()), String(window.scrollY));
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — no-op
    }
  }

  // ── Scroll restore — runs once on mount (e.g. when returning from a profile) ─
  useEffect(() => {
    const url = currentPageUrl();
    try {
      const saved = sessionStorage.getItem(scrollKey(url));
      if (saved) {
        sessionStorage.removeItem(scrollKey(url));
        const y = parseInt(saved, 10);
        if (!isNaN(y)) {
          // rAF ensures the DOM has settled after hydration
          requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — run once on mount only

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return coldOpens.filter((co) => {
      if (
        search &&
        !co.word.toLowerCase().includes(search.toLowerCase()) &&
        !co.guestName.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (sentimentFilter !== "all" && co.sentiment !== sentimentFilter) return false;
      return true;
    });
  }, [coldOpens, search, sentimentFilter]);

  return (
    <div>
      <WordCloudArt />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="search"
          placeholder="Search by word or guest…"
          defaultValue={search}
          onChange={handleSearchChange}
          className="flex-1 min-w-48 px-3 py-2 bg-[var(--bg2)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--orange)]"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleSentimentChange("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              sentimentFilter === "all"
                ? "bg-[var(--text)] text-white"
                : "bg-[var(--bg2)] border border-[var(--border)] hover:bg-[var(--bg3)]"
            }`}
          >
            All
          </button>
          {(Object.keys(SENTIMENT_LABELS) as ColdOpenSentiment[]).map((s) => (
            <button
              key={s}
              onClick={() => handleSentimentChange(sentimentFilter === s ? "all" : s)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={
                sentimentFilter === s
                  ? { background: SENTIMENT_COLORS[s], color: "white" }
                  : { background: "var(--bg2)", border: `1px solid ${SENTIMENT_COLORS[s]}`, color: SENTIMENT_COLORS[s] }
              }
            >
              {SENTIMENT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-[var(--text-muted)] mb-4">{filtered.length} cold opens</p>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((co, i) => {
          const from = currentPageUrl();
          const guestHref = `/guest/${co.guestId}?from=${encodeURIComponent(from)}`;

          return (
            <div
              key={i}
              className="bg-[var(--bg2)] rounded-xl border border-[var(--border)] p-4 flex flex-col gap-3"
            >
              {/* Guest */}
              <Link
                href={guestHref}
                onClick={saveScroll}
                className="flex items-center gap-2 hover:opacity-80"
              >
                <GuestAvatar name={co.guestName} photoUrl={co.guestPhotoUrl} size={28} />
                <span className="text-sm font-medium">{co.guestName}</span>
              </Link>

              {/* Word — sans-serif, no italic */}
              <p
                className="text-2xl font-bold leading-tight tracking-tight"
                style={{ color: co.sentiment ? SENTIMENT_COLORS[co.sentiment] : "#7F77DD" }}
              >
                {co.word}
              </p>

              {/* Metadata */}
              <div className="text-xs text-[var(--text-muted)]">
                <span>{formatDate(co.date)}</span>
                {co.sentiment && (
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      background: SENTIMENT_COLORS[co.sentiment] + "20",
                      color: SENTIMENT_COLORS[co.sentiment],
                    }}
                  >
                    {SENTIMENT_LABELS[co.sentiment]}
                  </span>
                )}
              </div>

              {/* YouTube embed */}
              {co.youtubeVideoId && (
                <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", maxWidth: "720px", marginTop: "4px", marginBottom: "4px" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${co.youtubeVideoId}`}
                    title={co.episodeTitle || `${co.guestName} on Conan O'Brien Needs a Friend`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", borderRadius: "8px" }}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-auto">
                {(co.audioUrl || co.youtubeVideoId) && (
                  <button
                    onClick={() =>
                      play(
                        {
                          era: "podcast",
                          date: co.date,
                          episodeTitle: co.episodeTitle,
                          episodeUrl: co.episodeUrl,
                          audioUrl: co.audioUrl,
                          youtubeVideoId: co.youtubeVideoId ?? null,
                          promoVisit: false,
                          coldOpenWord: co.word,
                          artworkUrl: co.artworkUrl,
                        },
                        co.guestName
                      )
                    }
                    className="text-xs px-2.5 py-1.5 bg-[var(--orange)] text-white rounded-lg hover:opacity-90"
                  >
                    ▶ Listen
                  </button>
                )}
                {co.episodeUrl && (
                  <a
                    href={co.episodeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2.5 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)]"
                  >
                    Open ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-[var(--text-muted)] py-16">
          No cold opens found. Try a different filter.
        </p>
      )}
    </div>
  );
}
