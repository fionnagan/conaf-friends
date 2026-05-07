"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface TopWord { word: string; count: number; }
interface TrendingWord { feeling: string; count: number; }

interface Analytics {
  topWords: TopWord[];
  trending: TrendingWord[];
  totalSubmissions: number;
  topCountry: { country: string; count: number } | null;
}

const barVariants = {
  hidden: { scaleX: 0, originX: 0 },
  visible: (i: number) => ({
    scaleX: 1,
    transition: { delay: i * 0.07, duration: 0.5, ease: "easeOut" as const },
  }),
};

export default function TrendingPanel() {
  const [data, setData]     = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

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
              custom={i}
              variants={barVariants}
              initial="hidden"
              animate="visible"
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

      {/* Trending from user submissions */}
      {data.trending.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3">
            Trending this week
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.trending.map((t, i) => (
              <motion.span
                key={t.feeling}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg2)] border border-[var(--border)] text-sm"
              >
                <span className="font-medium capitalize">{t.feeling}</span>
                <span className="text-xs text-[var(--text-muted)] bg-[var(--orange)]/10 px-1.5 py-0.5 rounded-full">
                  {t.count}
                </span>
              </motion.span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
