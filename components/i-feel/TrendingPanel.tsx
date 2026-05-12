"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useMotionConfig } from "@/lib/use-reduced-motion";

interface TopWord { word: string; count: number; }
interface CountryRank { country: string; count: number; topFeeling: string; }

interface Analytics {
  topWords: TopWord[];
  countryRankings: CountryRank[];
  totalSubmissions: number;
  topCountry: { country: string; count: number } | null;
}


export default function TrendingPanel() {
  const [data, setData]       = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const { t, stagger }        = useMotionConfig(); // must be before any early return

  useEffect(() => {
    fetch("/api/i-feel/analytics")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 rounded-lg bg-[var(--bg2)] border border-[var(--border)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const maxCount = data.topWords[0]?.count ?? 1;

  return (
    <section className="space-y-8">
      {/* Stats bar */}
      {data.totalSubmissions > 0 && (
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[120px] p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)] text-center">
            <p className="text-2xl font-serif font-semibold text-[var(--orange)]">
              {data.totalSubmissions.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Total feelings shared</p>
          </div>
          {data.topCountry && (
            <div className="flex-1 min-w-[120px] p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)] text-center">
              <p className="text-2xl font-serif font-semibold">{data.topCountry.country}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Most active country</p>
            </div>
          )}
        </div>
      )}

      {/* Top words from guest cold opens */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3">
          How guests describe the friendship
        </h3>
        <div className="space-y-2">
          {data.topWords.map((w, i) => (
            <motion.div
              key={w.word}
              initial={{ scaleX: 0, originX: 0 }}
              animate={{ scaleX: 1 }}
              transition={t({ delay: stagger(i, 0.07), duration: 0.5, ease: "easeOut" })}
              className="flex items-center gap-3"
            >
              <span className="text-xs text-[var(--text-muted)] font-mono w-4 text-right">{i + 1}</span>
              <div className="flex-1 relative h-7 bg-[var(--bg2)] rounded-lg overflow-hidden border border-[var(--border)]">
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--orange)]/15 rounded-lg transition-all"
                  style={{ width: `${(w.count / maxCount) * 100}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-3">
                  <span className="text-sm font-medium capitalize">{w.word}</span>
                  <span className="text-xs text-[var(--text-muted)]">×{w.count}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Country rankings */}
      {data.countryRankings?.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3">
            🌍 Top countries this week
          </h3>
          <div className="space-y-1.5">
            {data.countryRankings.map((c, i) => (
              <motion.div
                key={c.country}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={t({ delay: stagger(i, 0.05), duration: 0.3, ease: "easeOut" })}
                className="flex items-center justify-between px-3 py-2 bg-[var(--bg2)] rounded-lg border border-[var(--border)]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] font-mono w-4">{i + 1}</span>
                  <span className="text-sm font-medium">{c.country}</span>
                  {c.topFeeling && (
                    <span className="text-xs text-[var(--text-muted)] italic capitalize hidden sm:inline">
                      — top: &quot;{c.topFeeling}&quot;
                    </span>
                  )}
                </div>
                <span className="text-xs text-[var(--orange)] font-semibold">×{c.count}</span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
