"use client";

import { useEffect, useState, useCallback } from "react";
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

const PAGE_SIZE = 10;

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
  // allEntries holds everything fetched so far (page 1 onwards)
  // we slice it client-side for the current page view
  const [allEntries, setAllEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetching, setFetching]     = useState(false);
  const [hasMore, setHasMore]       = useState(true);
  const [page, setPage]             = useState(1); // 1-indexed display page

  // cursors[i] = `before` timestamp for page i+2 (i.e. fetched after page i+1 loaded)
  const [cursors, setCursors]       = useState<string[]>([]);

  // Initial load — page 1
  useEffect(() => {
    fetch(`/api/i-feel/feed?limit=${PAGE_SIZE}`)
      .then((r) => r.json())
      .then((data: FeedEntry[]) => {
        setAllEntries(data);
        setHasMore(data.length === PAGE_SIZE);
        if (data.length > 0) {
          setCursors([data[data.length - 1].created_at]);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch next batch when we need page > allEntries.length / PAGE_SIZE
  const fetchNextBatch = useCallback(async () => {
    const cursor = cursors[cursors.length - 1];
    if (!cursor || !hasMore || fetching) return;
    setFetching(true);
    const res  = await fetch(`/api/i-feel/feed?limit=${PAGE_SIZE}&before=${encodeURIComponent(cursor)}`);
    const more: FeedEntry[] = await res.json();
    setAllEntries((prev) => {
      const merged = [...prev, ...more];
      return merged;
    });
    setHasMore(more.length === PAGE_SIZE);
    if (more.length > 0) {
      setCursors((prev) => [...prev, more[more.length - 1].created_at]);
    }
    setFetching(false);
  }, [cursors, hasMore, fetching]);

  const totalLoaded = allEntries.length;
  const maxPage = Math.ceil(totalLoaded / PAGE_SIZE) + (hasMore ? 1 : 0);

  const goNext = async () => {
    const nextPage = page + 1;
    const neededEntries = nextPage * PAGE_SIZE;
    if (neededEntries > totalLoaded && hasMore) {
      await fetchNextBatch();
    }
    setPage(nextPage);
  };

  const goPrev = () => {
    setPage((p) => Math.max(1, p - 1));
  };

  // Slice for the current page
  const pageEntries = allEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Realtime subscription — prepend new entries to the front of allEntries
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
          setAllEntries((prev) => [row, ...prev]);
        }
      )
      .subscribe();

    return () => { client.removeChannel(channel); };
  }, []);

  if (!supabaseAvailable && !loading && allEntries.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--text-muted)] opacity-60">
        Live feed requires Supabase setup.
      </div>
    );
  }

  const canPrev = page > 1;
  const canNext = page * PAGE_SIZE < totalLoaded || hasMore;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--orange)] animate-pulse" />
          <h2 className="font-serif text-xl font-semibold">How the world feels</h2>
        </div>
        {!loading && allEntries.length > 0 && (
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            Page {page}
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-5">
        Real-time submissions from Conan fans everywhere.
      </p>

      <div className="space-y-2">
        {loading && allEntries.length === 0 && (
          <>
            {[...Array(PAGE_SIZE)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[var(--bg2)] border border-[var(--border)] animate-pulse" />
            ))}
          </>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-2"
          >
            {pageEntries.map((e) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
          </motion.div>
        </AnimatePresence>

        {fetching && (
          <div className="flex justify-center py-2">
            <span className="w-4 h-4 border-2 border-[var(--orange)]/30 border-t-[var(--orange)] rounded-full animate-spin" />
          </div>
        )}

        {!loading && allEntries.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm text-[var(--text-muted)]">No submissions yet. Be the first!</p>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {!loading && allEntries.length > 0 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)]">
          <button
            onClick={goPrev}
            disabled={!canPrev}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--orange)]/60 hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            ← Newer
          </button>

          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalLoaded)} of {totalLoaded}{hasMore ? "+" : ""}
          </span>

          <button
            onClick={goNext}
            disabled={!canNext || fetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--orange)]/60 hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Older →
          </button>
        </div>
      )}

      {!hasMore && page === maxPage && allEntries.length > 0 && (
        <p className="text-center text-xs text-[var(--text-muted)] py-3">
          You&apos;ve reached the beginning ✦
        </p>
      )}
    </section>
  );
}
