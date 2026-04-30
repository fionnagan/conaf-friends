"use client";

import { useState } from "react";
import Link from "next/link";
import type { Guest } from "@/lib/types";
import { TIER_COLORS } from "@/lib/data";
import GuestAvatar from "./GuestAvatar";
import FriendshipArc from "./FriendshipArc";

interface Props {
  guests: Guest[];
}

export default function ArcListClient({ guests }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = guests.filter((g) =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search guests…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 bg-[var(--bg2)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--orange)]"
        />
        <span className="ml-3 text-sm text-[var(--text-muted)]">
          {filtered.length} guests
        </span>
      </div>

      <div className="space-y-3">
        {filtered.map((g) => {
          const isExpanded = expanded.has(g.id);
          return (
            <div
              key={g.id}
              className="bg-[var(--bg2)] rounded-2xl border border-[var(--border)] overflow-hidden"
            >
              {/* Header row */}
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-[var(--bg)]"
                onClick={() => toggleExpand(g.id)}
              >
                <GuestAvatar name={g.name} photoUrl={g.photoUrl} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{g.name}</p>
                  <p
                    className="text-sm font-medium"
                    style={{ color: TIER_COLORS[g.friendshipLabel] }}
                  >
                    {g.friendshipScore} · {g.friendshipLabel}
                  </p>
                </div>
                <div className="text-xs text-[var(--text-muted)] hidden sm:block">
                  {g.appearances.length} appearance{g.appearances.length !== 1 ? "s" : ""} ·{" "}
                  {[...new Set(g.appearances.map((a) => a.era))].length} era(s)
                </div>
                <Link
                  href={`/guest/${g.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs px-2.5 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)] flex-shrink-0"
                >
                  Profile ↗
                </Link>
                <span className="text-[var(--text-muted)] flex-shrink-0">
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>

              {/* Compact arc (always visible) */}
              <div className="px-5 pb-2">
                <FriendshipArc guest={g} compact={!isExpanded} />
              </div>

              {/* Expanded: cold open words */}
              {isExpanded && g.appearances.some((a) => a.coldOpenWord) && (
                <div className="px-5 pb-4 border-t border-[var(--border)] pt-3">
                  <p className="text-xs text-[var(--text-muted)] mb-2">Cold open words</p>
                  <div className="flex flex-wrap gap-2">
                    {g.appearances
                      .filter((a) => a.coldOpenWord)
                      .map((a, i) => (
                        <span
                          key={i}
                          className="italic text-sm text-[var(--purple)] bg-[rgba(127,119,221,0.12)] px-2 py-0.5 rounded-full"
                        >
                          &ldquo;{a.coldOpenWord}&rdquo;
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-[var(--text-muted)] py-16">
          No friends found here yet — try widening your search.
        </p>
      )}
    </div>
  );
}
