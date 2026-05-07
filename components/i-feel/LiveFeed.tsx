"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, supabaseAvailable } from "@/lib/supabase";
import { countryFlag } from "@/lib/country-flags";

interface FeedEntry {
  id: string;
  name: string;
  country: string;
  feeling_raw: string;
  created_at: string;
}

const MAX_FEED = 50;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function LiveFeed() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setPage]       = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  // Initial load
  useEffect(() => {
    fetch(`/api/i-feel/feed?limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((data: FeedEntry[]) => {
        setEntries(data);
        setHasMore(data.length === PAGE_SIZE);
      })
      .finally(() => setLoading(false));
  }, []);

  // Infinite scroll: load more
  const loadMore = async () => {
    if (!hasMore || loading) return;
    const before = entries[entries.length - 1]?.created_at;
    const res  = await fetch(`/api/i-feel/feed?limit=${PAGE_SIZE}&before=${encodeURIComponent(before ?? "")}`);
    const more: FeedEntry[] = await res.json();
    setEntries((prev) => [...prev, ...more]);
    setHasMore(more.length === PAGE_SIZE);
    setPage((p) => p + 1);
  };

  // Realtime subscription
  useEffect(() => {
    if (!supabaseAvailable || !supabase) return;
    const client = supabase;

    const channel = client
      .channel("i-feel-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "submissions", filter: "is_public=eq.true" },
        (payload) => {
          const row = payload.new as FeedEntry;
          setEntries((prev) => [row, ...prev].slice(0, MAX_FEED));
        }
      )
      .subscribe();

    return () => { client.removeChannel(channel); };
  }, []);

  // Intersection observer for infinite scroll trigger
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadMore(); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, hasMore]);

  if (!supabaseAvailable && !loading && entries.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--text-muted)] opacity-60">
        Live feed requires Supabase setup.
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-[var(--orange)] animate-pulse" />
        <h2 className="font-serif text-xl font-semibold">How the world feels</h2>
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-5">
        Real-time submissions from Conan fans everywhere.
      </p>

      <div className="space-y-2">
        {loading && entries.length === 0 && (
          <>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[var(--bg2)] border border-[var(--border)] animate-pulse" />
            ))}
          </>
        )}

        <AnimatePresence initial={false}>
          {entries.map((e) => (
            <motion.div
              key={e.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-3 px-4 py-3 bg-[var(--bg2)] rounded-xl border border-[var(--border)] hover:border-[var(--orange)]/40 transition-colors group"
            >
              <span className="text-2xl flex-shrink-0">{countryFlag(e.country)}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold">{e.name}</span>
                <span className="text-[var(--text-muted)] text-sm"> feels </span>
                <span className="text-sm text-[var(--orange)] font-medium italic">&quot;{e.feeling_raw}&quot;</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] flex-shrink-0 text-right">
                <div>{e.country}</div>
                <div className="opacity-60">{timeAgo(e.created_at)}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Infinite scroll sentinel */}
        {hasMore && <div ref={sentinelRef} className="h-8" />}

        {!hasMore && entries.length > 0 && (
          <p className="text-center text-xs text-[var(--text-muted)] py-4">
            You&apos;ve reached the beginning ✦
          </p>
        )}

        {!loading && entries.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">No submissions yet. Be the first!</p>
          </div>
        )}
      </div>
    </section>
  );
}
