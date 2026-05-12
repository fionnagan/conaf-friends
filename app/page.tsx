"use client";

import { useState, useRef, useCallback, useEffect, useId } from "react";
import confetti from "canvas-confetti";
import Image from "next/image";
import { motion, AnimatePresence, useMotionValue, useTransform, useReducedMotion } from "framer-motion";
import CountryCombobox from "@/components/i-feel/CountryCombobox";
import MatchCards, { type GuestMatch } from "@/components/i-feel/MatchCards";
import LiveFeed from "@/components/i-feel/LiveFeed";
import { useSessionState } from "@/lib/use-session-state";
import { countryFlag } from "@/lib/country-flags";
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

/* ── PNG filename sanitiser ─────────────────────────────────────────────────── */
function buildFilename(name: string, feeling: string): string {
  const sanitize = (s: string) =>
    s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
  const n = sanitize(name);
  const f = sanitize(feeling);
  if (!n) return "CONAF-card.png";
  return `CONAF-${n}${f ? "-" + f : ""}.png`;
}

/* ── Share buttons (Web Share API + download) ───────────────────────────────── */
function ShareButtons({ pngUrl, feeling, name }: { pngUrl: string; feeling: string; name: string }) {
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
          const file = new File([blob], buildFilename(name, feeling), { type: "image/png" });
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
        download={buildFilename(name, feeling)}
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
      {count}/{max} words{over ? " (too many)" : ""}
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

/* ── Rotating placeholder copy ──────────────────────────────────────────────── */
const FEELING_EXAMPLES = [
  "delightfully confused",
  "honored and nervous",
  "genuinely baffled",
  "cautiously optimistic",
  "overwhelmingly ginger",
  "weirdly emotional",
  "aggressively grateful",
  "professionally bewildered",
  "softly chaotic",
  "inexplicably proud",
  "surprisingly touched",
  "deeply unqualified",
];

const NAME_EXAMPLES = [
  "Jordan", "Sam", "Alex", "Taylor", "Morgan", "Casey", "Drew",
  "Jamie", "Quinn", "Reese", "Avery", "Blake", "Charlie", "Dallas",
  "Emerson", "Finley", "Hayden", "Jesse", "Kendall", "Lane",
  "Micah", "Noel", "Parker", "Rowan", "Sage", "Sawyer", "Wren",
  "Conan", "Andy", "Sona",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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

  // Picked once on first client render — different for every visitor
  const [namePlaceholder]    = useState(() => `e.g. ${pick(NAME_EXAMPLES)}`);
  const [feelingPlaceholder] = useState(() => `e.g. ${pick(FEELING_EXAMPLES)}`);

  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const results = savedResults as Results | null;
  const pngUrl  = savedPngUrl;
  const [vizTab,  setVizTab]  = useState<VizTab>("map");
  const [analyticsData, setAnalyticsData] = useState<{
    countryCounts: Record<string, number>;
    topWords: TopWord[];
    constellationWords: { word: string; count: number; fans: { name: string; country: string }[] }[];
    totalSubmissions: number;
    countryCount: number;
    topCountry: { country: string; count: number } | null;
    topFeeling: { word: string; count: number } | null;
  } | null>(null);
  const [showChyron, setShowChyron] = useState(false);
  const chyronTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const sessionId  = useId();
  const reduced    = useReducedMotion();
  const et = (full: object) => (reduced ? { duration: 0.01 } : full); // entrance transition

  const wordCount   = feeling.trim().split(/\s+/).filter(Boolean).length;
  const tooMany     = wordCount > 3;
  const canSubmit   = !loading && !tooMany && name.trim() && country && feeling.trim();

  // Prefetch analytics for map/constellation
  useEffect(() => {
    fetch("/api/i-feel/analytics")
      .then((r) => r.json())
      .then((d) => setAnalyticsData({
          countryCounts: d.countryCounts ?? {},
          topWords: d.topWords ?? [],
          constellationWords: d.constellationWords ?? [],
          totalSubmissions: d.totalSubmissions ?? 0,
          countryCount: d.countryCount ?? 0,
          topCountry: d.topCountry ?? null,
          topFeeling: d.topFeeling ?? null,
        }))
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
    if (tooMany)         { setError("Keep it to 3 words or fewer."); return; }

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

      const guestIds = (data.matches as Array<{ guest_id: string }>)
        .map((m) => m.guest_id)
        .join(",");
      const params = new URLSearchParams({ name: name.trim(), country, feeling: feeling.trim(), g: guestIds });
      setPngUrl(`/api/i-feel/png?${params}`);
      setSelectedVariant(1);

      // 🎉 Celebration: chyron + confetti
      setShowChyron(true);
      if (chyronTimerRef.current) clearTimeout(chyronTimerRef.current);
      chyronTimerRef.current = setTimeout(() => setShowChyron(false), 4000);

      // Burst of orange + white confetti from top-center
      const fire = (particleRatio: number, opts: confetti.Options) =>
        confetti({ origin: { y: 0.4 }, colors: ["#F26519", "#ffffff", "#ffa559", "#ffcba4"], ...opts, particleCount: Math.floor(200 * particleRatio) });
      fire(0.25, { spread: 26, startVelocity: 55 });
      fire(0.2,  { spread: 60 });
      fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
      fire(0.1,  { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.1,  { spread: 120, startVelocity: 45 });

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
            How do you feel about being Conan O&apos;Brien&apos;s friend? Describe it in 3 words or fewer, and we&apos;ll match you with the guests who share your CoCo energy.
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
              placeholder={namePlaceholder}
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
                (up to 3 words)
              </span>
            </label>
            <motion.input
              type="text"
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder={feelingPlaceholder}
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
              <WordBadge count={wordCount} max={3} />
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
                  <ShareButtons pngUrl={`${pngUrl}&variant=${selectedVariant}`} feeling={feeling} name={name} />
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

            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Live Feed ── */}
        <LiveFeed />

        {/* ── Phase 3: Visualizations ── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[var(--orange)] text-lg">◎</span>
            <h2 className="font-serif text-xl font-semibold">Explore</h2>
          </div>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            See how the global feeling of being Conan&apos;s friend maps across the world and clusters into emotional constellations.
          </p>

          {/* Stats bar */}
          {analyticsData && analyticsData.totalSubmissions > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5 text-sm">
              {/* Total feelings */}
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-serif font-semibold text-[var(--orange)]">
                  {analyticsData.totalSubmissions.toLocaleString()}
                </span>
                <span className="text-[var(--text-muted)]">feelings shared</span>
              </div>

              <span className="text-[var(--border)] hidden sm:inline">·</span>

              {/* Country count */}
              {analyticsData.countryCount > 0 && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-serif font-semibold text-[var(--orange)]">
                    {analyticsData.countryCount}
                  </span>
                  <span className="text-[var(--text-muted)]">countries</span>
                </div>
              )}

              <span className="text-[var(--border)] hidden sm:inline">·</span>

              {/* Top country */}
              {analyticsData.topCountry && (
                <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                  <span className="text-base leading-none">{countryFlag(analyticsData.topCountry.country)}</span>
                  <span>
                    <span className="font-medium text-[var(--text)]">{analyticsData.topCountry.country}</span>
                    {" "}leads with{" "}
                    <span className="font-medium text-[var(--orange)]">{analyticsData.topCountry.count}</span>
                  </span>
                </div>
              )}

              {/* Most popular feeling */}
              {analyticsData.topFeeling && (
                <>
                  <span className="text-[var(--border)] hidden sm:inline">·</span>
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                    <span>most shared:</span>
                    <span className="font-medium text-[var(--text)] italic">&ldquo;{analyticsData.topFeeling.word}&rdquo;</span>
                    <span className="text-[var(--orange)] font-semibold">×{analyticsData.topFeeling.count}</span>
                  </div>
                </>
              )}
            </div>
          )}

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
                  words={(analyticsData?.constellationWords ?? []).map((w) => ({
                    word: w.word,
                    count: w.count,
                    fans: (w.fans ?? []) as { name: string; country: string }[],
                  }))}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ── CONAF Map plug ── */}
        <section>
          <a
            href="https://conafmap.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="group block"
            aria-label="Visit CONAF Map — Map of all fan callers"
          >
            <div
              className="relative overflow-hidden rounded-2xl border border-white/10 transition-all duration-300 group-hover:border-[var(--orange)]/40 group-hover:shadow-xl group-hover:shadow-[var(--orange)]/10"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(242,101,25,0.06) 100%)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
              }}
            >
              {/* Subtle glass sheen */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(242,101,25,0.04) 100%)",
                }}
              />

              <div className="relative flex items-center gap-4 p-5">
                {/* Favicon / icon */}
                <div
                  className="flex-shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://conafmap.vercel.app/favicon.ico"
                    alt="CONAF Map icon"
                    width={40}
                    height={40}
                    className="w-10 h-10 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-semibold text-base text-[var(--text)]">CONAF Map</p>
                    <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-[var(--orange)]/15 text-[var(--orange)] border border-[var(--orange)]/20">
                      Fan Project
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] leading-snug">
                    Every fan caller, mapped. Explore all the fans who&apos;ve connected with Conan from around the world.
                  </p>
                </div>

                {/* Arrow */}
                <div className="flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--orange)] group-hover:translate-x-1 transition-all duration-200">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7M17 7H7M17 7v10" />
                  </svg>
                </div>
              </div>
            </div>
          </a>
        </section>

      </main>

      {/* ── Chyron celebration ── */}
      <AnimatePresence>
        {showChyron && (
          <motion.div
            key="chyron"
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
          >
            <div className="bg-[#F26519] text-white px-6 py-4 flex items-center gap-4 shadow-2xl">
              {/* Left accent bar */}
              <div className="w-1.5 h-10 bg-white/40 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 leading-none mb-1">
                  Breaking News · The Friend Registry
                </p>
                <p className="text-base sm:text-lg font-bold uppercase tracking-wide leading-tight truncate">
                  {name.trim() || "YOU"}{country ? ` from ${country}` : ""} IS NOW A CERTIFIED FRIEND
                </p>
              </div>
              <span className="text-3xl flex-shrink-0">🧡</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
