"use client";
import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import Nav from "@/components/Nav";
import { COUNTRIES } from "@/lib/countries";

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface GuestMatch {
  guest_id: string;
  guest_name: string;
  episode_id: string;
  episode_url: string;
  profile_url: string;
  cold_open_text: string;
  feeling_phrase_raw: string;
  feeling_phrase_normalized: string;
}
interface TopWord {
  word: string;
  count: number;
  guest_ids: string[];
  episode_ids: string[];
}
interface Fan {
  fan_id: string;
  fan_name: string;
  country_full_name: string;
  episode_url: string;
  profile_url: string;
}
interface Results {
  matches: GuestMatch[];
  topWords: TopWord[];
  fans: Fan[];
}

/* ── Component ──────────────────────────────────────────────────────────────── */
export default function IFeelPage() {
  const [name, setName]       = useState("");
  const [country, setCountry] = useState("");
  const [feeling, setFeeling] = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [pngUrl, setPngUrl]   = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const wordCount = feeling.trim().split(/\s+/).filter(Boolean).length;
  const tooManyWords = wordCount > 4;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError("Name is required."); return; }
    if (!country)     { setError("Please select your country."); return; }
    if (!feeling.trim()) { setError("Please describe how you feel."); return; }
    if (tooManyWords)    { setError("Keep it to 4 words or fewer."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/i-feel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), country, feeling: feeling.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setResults(data);

      // Build PNG URL (deterministic — no server call yet, computed on demand)
      const params = new URLSearchParams({
        name: name.trim(), country, feeling: feeling.trim(),
      });
      setPngUrl(`/api/i-feel/png?${params}`);

      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [name, country, feeling, tooManyWords]);

  return (
    <>
      <Nav />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-14">

        {/* Hero */}
        <div className="mb-10 text-center">
          <Image
            src="/logos/era-podcast.jpg"
            alt="Conan O'Brien Needs a Friend"
            width={72} height={72}
            className="rounded-xl mx-auto mb-4"
          />
          <h1 className="font-serif text-4xl font-semibold mb-2">I Feel…</h1>
          <p className="text-[var(--text-muted)] text-sm">
            Tell us how you feel about being Conan O'Brien's friend.
            We'll find the guests who felt the same way.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jordan"
              className="w-full px-4 py-3 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--orange)] transition-colors"
              maxLength={60}
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Country
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[var(--bg2)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--orange)] transition-colors appearance-none"
            >
              <option value="" disabled>Select your country…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Feeling */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              How do you feel? <span className="normal-case font-normal">(up to 4 words)</span>
            </label>
            <input
              type="text"
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g. genuinely honored and confused"
              className={`w-full px-4 py-3 rounded-xl bg-[var(--bg2)] border transition-colors text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none ${
                tooManyWords
                  ? "border-red-500 focus:border-red-500"
                  : "border-[var(--border)] focus:border-[var(--orange)]"
              }`}
              maxLength={80}
            />
            <p className={`mt-1 text-xs ${tooManyWords ? "text-red-400" : "text-[var(--text-muted)]"}`}>
              {wordCount}/4 words{tooManyWords ? " — too many" : ""}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 px-4 py-2 rounded-lg">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || tooManyWords || !name.trim() || !country || !feeling.trim()}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-[var(--orange)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? "Finding your feeling…" : "Find my feeling →"}
          </button>
        </form>

        {/* Results */}
        {results && pngUrl && (
          <div ref={resultsRef} className="mt-14 space-y-10">

            {/* ── 1. PNG card ── */}
            <section>
              <h2 className="font-serif text-xl font-semibold mb-4">Your card</h2>
              {/* Preview */}
              <div className="rounded-2xl overflow-hidden border border-[var(--border)] mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pngUrl} alt="Your shareable card" className="w-full" />
              </div>
              <a
                href={pngUrl}
                download="conan-friend-card.png"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--orange)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                ↓ Download PNG
              </a>
            </section>

            {/* ── 2. Guest matches ── */}
            <section>
              <h2 className="font-serif text-xl font-semibold mb-1">
                Guests with similar feelings
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                These guests described Conan's friendship in a similar way.
              </p>
              <div className="space-y-3">
                {results.matches.map((m) => (
                  <a
                    key={m.guest_id + m.episode_id}
                    href={m.profile_url}
                    className="flex items-start gap-4 p-4 bg-[var(--bg2)] rounded-2xl border border-[var(--border)] hover:border-[var(--orange)] transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm group-hover:text-[var(--orange)] transition-colors">
                        {m.guest_name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Conan described the friendship as{" "}
                        <span className="text-[var(--text)] font-medium italic">
                          "{m.cold_open_text}"
                        </span>
                      </p>
                    </div>
                    <span className="text-[var(--text-muted)] text-xs mt-0.5 shrink-0">
                      View profile →
                    </span>
                  </a>
                ))}
              </div>
            </section>

            {/* ── 3. Top words ── */}
            <section>
              <h2 className="font-serif text-xl font-semibold mb-1">
                How guests describe Conan's friendship
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                The most common words across all cold opens.
              </p>
              <div className="flex flex-wrap gap-2">
                {results.topWords.map((w, i) => (
                  <div
                    key={w.word}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg2)] border border-[var(--border)]"
                  >
                    <span className="text-xs text-[var(--text-muted)] font-mono w-3">{i+1}</span>
                    <span className="text-sm font-medium capitalize">{w.word}</span>
                    <span className="text-xs text-[var(--text-muted)]">×{w.count}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── 4. Fans from country ── */}
            <section>
              <h2 className="font-serif text-xl font-semibold mb-1">
                Fans from {country}
              </h2>
              {results.fans.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
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
            </section>

          </div>
        )}
      </main>
    </>
  );
}
