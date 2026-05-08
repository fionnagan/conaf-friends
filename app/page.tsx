"use client";

import { useState, useRef, useCallback, useEffect, useId } from "react";
import Image from "next/image";
import { motion, AnimatePresence, useMotionValue, useTransform, useReducedMotion } from "framer-motion";
import CountryCombobox from "@/components/i-feel/CountryCombobox";
import MatchCards, { type GuestMatch } from "@/components/i-feel/MatchCards";
import LiveFeed from "@/components/i-feel/LiveFeed";
import TrendingPanel from "@/components/i-feel/TrendingPanel";
import { useSessionState } from "@/lib/use-session-state";
import wordGuests from "@/data/word-guests.json";
import dynamic from "next/dynamic";

// Lazy-load heavy visualizations
const WorldMap    = dynamic(() => import("@/components/i-feel/WorldMap"),    { ssr: false, loading: () => <MapSkeleton /> });
const Constellation = dynamic(() => import("@/components/i-feel/Constellation"), { ssr: false, loading: () => <MapSkeleton /> });

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface TopWord { word: string; count: number; }
interface Fan {
  fan_id: string; fan_name: string; country_full_name: string;
  episode_url: string; profile_url: string;
}
interface Results {
  matches: GuestMatch[];
  topWords: TopWord[];
  fans: Fan[];
}

type VizTab = "map" | "constellation";

function MapSkeleton() {
  return <div className="h-[380px] rounded-2xl bg-[var(--bg2)] border border-[var(--border)] animate-pulse" />;
}

/* ── Share buttons (Web Share API + download) ───────────────────────────────── */
function ShareButtons({ pngUrl, feeling }: { pngUrl: string; feeling: string }) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const shareText = `I feel ${feeling} about being Conan O'Brien's friend.\n\nWhat kind of friend are you?\nconaf.vercel.app`;
  const shareUrl  = "https://conaf.vercel.app";

  async function handleShare() {
    setSharing(true);
    try {
      // Try file share (mobile with file support)
      if (typeof navigator !== "undefined" && "share" in navigator) {
        try {
          const res = await fetch(pngUrl);
          const blob = await res.blob();
          const file = new File([blob], "conan-friend-card.png", { type: "image/png" });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], text: shareText, url: shareUrl });
            return;
          }
        } catch { /* fall through */ }
        // Share URL only
        try {
          await navigator.share({ text: shareText, url: shareUrl });
          return;
        } catch { /* fall through */ }
      }
      // Desktop fallback: copy link
      await navigator.clipboard.writeText(`${shareText}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } finally {
      setSharing(false);
    }
  }

  const canNativeShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={handleShare}
        disabled={sharing}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--orange)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {sharing ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Sharing…
          </>
        ) : canNativeShare ? (
          <>↗ Share Your Friendship</>
        ) : (
          <>{copied ? "✓ Link copied!" : "⧉ Copy link"}</>
        )}
      </button>
      <a
        href={pngUrl}
        download="conan-friend-card.png"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-[var(--text)] text-sm font-semibold hover:border-[var(--orange)] transition-colors"
      >
        ↓ Download PNG
      </a>
    </div>
  );
}

/* ── Share card with parallax hover ─────────────────────────────────────────── */
function ShareCard({ pngUrl }: { pngUrl: string }) {
  const ref     = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const mx   = useMotionValue(0);
  const my   = useMotionValue(0);
  const rotX = useTransform(my, [-0.5, 0.5], reduced ? [0, 0] : [3, -3]);
  const rotY = useTransform(mx, [-0.5, 0.5], reduced ? [0, 0] : [-4, 4]);

  const [loaded, setLoaded] = useState(false);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!ref.current) return;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    mx.set((e.clientX - left) / width - 0.5);
    my.set((e.clientY - top)  / height - 0.5);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { mx.set(0); my.set(0); }}
      style={{ perspective: 800, rotateX: rotX, rotateY: rotY }}
      className="rounded-2xl overflow-hidden border border-[var(--border)] mb-4 cursor-default"
    >
      {!loaded && (
        <div className="w-full aspect-square bg-[var(--bg2)] animate-pulse rounded-2xl" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pngUrl}
        alt="Your shareable card"
        className={`w-full transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0 absolute"}`}
        onLoad={() => setLoaded(true)}
      />
    </motion.div>
  );
}

/* ── Animated word-count badge ──────────────────────────────────────────────── */
function WordBadge({ count, max }: { count: number; max: number }) {
  const over = count > max;
  return (
    <motion.span
      key={count}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={`text-xs font-mono tabular-nums ${over ? "text-red-400" : "text-[var(--text-muted)]"}`}
    >
      {count}/{max} words{over ? " — too many" : ""}
    </motion.span>
  );
}

/* ── Loading skeleton for match cards ──────────────────────────────────────── */
function MatchSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 bg-[var(--bg2)] rounded-2xl border border-[var(--border)] animate-pulse">
          <div className="w-14 h-14 rounded-full bg-white/5 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-white/5 rounded w-32" />
            <div className="h-2 bg-white/5 rounded w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */
export default function IFeelPage() {
  // Persisted state — survives guest profile nav + back button
  const {
    name, setName, country, setCountry, feeling, setFeeling,
    results: savedResults, setResults,
    pngUrl: savedPngUrl, setPngUrl,
    selectedVariant, setSelectedVariant,
  } = useSessionState();

  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const results = savedResults as Results | null;
  const pngUrl  = savedPngUrl;
  const [vizTab,  setVizTab]  = useState<VizTab>("map");
  const [analyticsData, setAnalyticsData] = useState<{ countryCounts: Record<string, number>; topWords: TopWord[] } | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const sessionId  = useId();
  const reduced    = useReducedMotion();
  const et = (full: object) => (reduced ? { duration: 0.01 } : full); // entrance transition

  const wordCount   = feeling.trim().split(/\s+/).filter(Boolean).length;
  const tooMany     = wordCount > 5;
  const canSubmit   = !loading && !tooMany && name.trim() && country && feeling.trim();

  // Prefetch analytics for map/constellation
  useEffect(() => {
    fetch("/api/i-feel/analytics")
      .then((r) => r.json())
      .then((d) => setAnalyticsData({ countryCounts: d.countryCounts ?? {}, topWords: d.topWords ?? [] }))
      .catch(() => {});
  }, []);

  // Restore scroll position when returning from guest profile nav
  useEffect(() => {
    if (results && resultsRef.current) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "instant", block: "start" }), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim())    { setError("Name is required."); return; }
    if (!country)        { setError("Please select your country."); return; }
    if (!feeling.trim()) { setError("Please describe how you feel."); return; }
    if (tooMany)         { setError("Keep it to 5 words or fewer."); return; }

    setLoading(true);
    setResults(null);
    setPngUrl(null);

    try {
      const res = await fetch("/api/i-feel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), country, feeling: feeling.trim(), sessionId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setResults(data);

      const params = new URLSearchParams({ name: name.trim(), country, feeling: feeling.trim() });
      setPngUrl(`/api/i-feel/png?${params}`);
      setSelectedVariant(1);

      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [name, country, feeling, tooMany, sessionId, setResults, setPngUrl]);

  return (
    <>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-14 space-y-16">

        {/* ── Hero ── */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={et({ duration: 0.6, ease: "easeOut" })}
        >
          <motion.div
            whileHover={reduced ? {} : { scale: 1.06, rotate: -1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="inline-block mb-5"
          >
            <Image
              src="/logos/era-podcast.jpg"
              alt="Conan O'Brien Needs a Friend"
              width={80} height={80}
              className="rounded-2xl shadow-xl shadow-black/30"
            />
          </motion.div>

          <h1 className="font-serif text-4xl sm:text-5xl font-semibold mb-3">I Feel…</h1>
          <p className="text-[var(--text-muted)] text-base leading-relaxed max-w-md mx-auto">
            How do you feel about being Conan O&apos;Brien&apos;s friend?
            Describe it in five words or fewer — we&apos;ll find the guests who felt exactly the same way.
          </p>
        </motion.div>

        {/* ── Form ── */}
        <motion.form
          onSubmit={handleSubmit}
          className="space-y-5"
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
              Your name
            </label>
            <motion.input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jordan"
              maxLength={60}
              whileFocus={{ scale: 1.008 }}
              transition={{ duration: 0.15 }}
              className="w-full px-4 py-3 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--orange)] transition-colors"
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
              Country
            </label>
            <CountryCombobox value={country} onChange={setCountry} disabled={loading} />
          </div>

          {/* Feeling */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
              How do you feel?{" "}
              <span className="normal-case font-normal">
                (up to 5 words)
              </span>
            </label>
            <motion.input
              type="text"
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g. genuinely honored and confused"
              maxLength={80}
              whileFocus={{ scale: 1.008 }}
              transition={{ duration: 0.15 }}
              className={`w-full px-4 py-3 rounded-xl bg-[var(--bg2)] border transition-colors text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none ${
                tooMany
                  ? "border-red-500 focus:border-red-500"
                  : "border-[var(--border)] focus:border-[var(--orange)]"
              }`}
            />
            <div className="mt-1.5 flex justify-end">
              <WordBadge count={wordCount} max={5} />
            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="text-sm text-red-400 bg-red-400/10 px-4 py-2.5 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Submit */}
          <motion.button
            type="submit"
            disabled={!canSubmit}
            whileHover={canSubmit ? { scale: 1.02 } : {}}
            whileTap={canSubmit ? { scale: 0.97 } : {}}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="w-full py-3.5 rounded-xl font-semibold text-sm bg-[var(--orange)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Finding your feeling…
              </span>
            ) : (
              "Find my feeling →"
            )}
          </motion.button>
        </motion.form>

        {/* ── Results ── */}
        <AnimatePresence>
          {(results || loading) && (
            <motion.div
              ref={resultsRef}
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-12"
            >

              {/* 1. Variant picker + share card */}
              {pngUrl && (
                <motion.section
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <h2 className="font-serif text-xl font-semibold mb-3">Your card</h2>

                  {/* Variant thumbnail grid */}
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[1, 2, 3, 4].map((v) => {
                      const vUrl = `${pngUrl}&variant=${v}`;
                      const active = selectedVariant === v;
                      return (
                        <button
                          key={v}
                          onClick={() => setSelectedVariant(v)}
                          className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                            active
                              ? "border-[var(--orange)] shadow-lg shadow-[var(--orange)]/20"
                              : "border-[var(--border)] hover:border-[var(--orange)]/50"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={vUrl} alt={`Variant ${v}`} className="w-full block" />
                          {active && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--orange)] flex items-center justify-center text-white text-[10px] font-bold shadow">
                              ✓
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Full-size selected card */}
                  <ShareCard pngUrl={`${pngUrl}&variant=${selectedVariant}`} />
                  <ShareButtons pngUrl={`${pngUrl}&variant=${selectedVariant}`} feeling={feeling} />
                </motion.section>
              )}

              {/* 2. Match cards */}
              <section>
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.div key="skeleton" exit={{ opacity: 0 }}>
                      <div className="h-5 bg-[var(--bg2)] rounded w-48 mb-4 animate-pulse" />
                      <MatchSkeleton />
                    </motion.div>
                  ) : results?.matches.length ? (
                    <motion.div key="matches" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                      <MatchCards matches={results.matches} feeling={feeling} />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </section>

              {/* 3. Country fans */}
              {results && (
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <h2 className="font-serif text-xl font-semibold mb-1">
                    Fans from {country}
                  </h2>
                  {results.fans.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] mt-2">
                      No fans from {country} in our map yet. Be the first!
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-[var(--text-muted)] mb-4">
                        {results.fans.length} fan{results.fans.length !== 1 ? "s" : ""} from your country have appeared on the show.
                      </p>
                      <div className="space-y-2">
                        {results.fans.map((f) => (
                          <a
                            key={f.fan_id}
                            href={f.episode_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-3 bg-[var(--bg2)] rounded-xl border border-[var(--border)] hover:border-[var(--orange)] transition-colors group"
                          >
                            <span className="text-sm font-medium group-hover:text-[var(--orange)] transition-colors">
                              {f.fan_name}
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">Listen ↗</span>
                          </a>
                        ))}
                      </div>
                    </>
                  )}
                </motion.section>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Trending + Analytics ── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[var(--orange)] text-lg">✦</span>
            <h2 className="font-serif text-xl font-semibold">The feeling landscape</h2>
          </div>
          <TrendingPanel />
        </section>

        {/* ── Live Feed ── */}
        <LiveFeed />

        {/* ── Phase 3: Visualizations ── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[var(--orange)] text-lg">◎</span>
            <h2 className="font-serif text-xl font-semibold">Explore</h2>
          </div>
          <p className="text-sm text-[var(--text-muted)] mb-5">
            See how the global feeling of being Conan&apos;s friend maps across the world and clusters into emotional constellations.
          </p>

          {/* Tab switcher */}
          <div className="flex gap-1 p-1 bg-[var(--bg2)] rounded-xl border border-[var(--border)] mb-5 w-fit">
            {(["map", "constellation"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setVizTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  vizTab === tab
                    ? "bg-[var(--orange)] text-white shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {tab === "map" ? "🌍 World Map" : "✦ Constellation"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {vizTab === "map" ? (
              <motion.div
                key="map"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <WorldMap countryCounts={analyticsData?.countryCounts ?? {}} />
              </motion.div>
            ) : (
              <motion.div
                key="constellation"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <Constellation
                  words={(analyticsData?.topWords ?? []).map((w) => ({
                    word: w.word,
                    count: w.count,
                    guests: ((wordGuests as Record<string, { guest_id: string; guest_name: string; profile_url: string; cold_open_text: string }[]>)[w.word] ?? []),
                  }))}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

      </main>
    </>
  );
}
