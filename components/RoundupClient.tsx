"use client";

import { useEffect, useMemo, useState } from "react";
import { ERA_LABELS, getEraTextColor } from "@/lib/data";
import RoundupFunFacts, { type GuestFact } from "./RoundupFunFacts";
import type { Era } from "@/lib/types";

interface Props {
  eras: Era[];
  eraTotals: Record<Era, number>;
  professionByGuest: { eras: Era[]; bucket: string }[];
  professionCategoryOrder: string[];
  generationByGuest: { eras: Era[]; bucket: string }[];
  generationCategoryOrder: string[];
  guestFacts: GuestFact[];
}

// Fixed-order categorical palette (dark-surface steps), validated with the
// dataviz skill's contrast/CVD-separation checker against this app's card
// surface (#161b27). Slots are drawn from in order — never reassigned per
// filter — so a category keeps its color no matter what's toggled off.
const CATEGORY_COLORS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];

// A category's color comes from its fixed position in the caller-supplied
// order, never from its rank in the current filter view — so Gen X (say) is
// always the same color whether it's the biggest slice or the smallest.
function colorForCategory(order: string[], label: string): string {
  const idx = order.indexOf(label);
  return CATEGORY_COLORS[(idx >= 0 ? idx : order.length) % CATEGORY_COLORS.length];
}

// Illustrative fallback only — used while zero guests in the selected eras
// have a backfilled birth_year. The moment even one does, RoundupClient
// switches to the real computed split (same bucket labels/ranges, so the
// chart doesn't visually jump when it flips from placeholder to real).
// Static across the era filter on purpose: filtering illustrative numbers
// would suggest a precision that isn't there.
const ILLUSTRATIVE_GENERATION_BUCKETS: { label: string; share: number }[] = [
  { label: "Boomer & earlier (born before 1965)", share: 0.21 },
  { label: "Gen X (1965–1980)", share: 0.34 },
  { label: "Millennial (1981–1996)", share: 0.37 },
  { label: "Gen Z (1997 & later)", share: 0.08 },
];

function formatPct(value: number, total: number): string {
  const pct = (value / total) * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

// Anchors a tooltip to the hovered/focused mark's own bounding box, not to
// the pointer — stable per-mark position that works identically for mouse,
// touch, and keyboard focus (which has no pointer coordinates at all).
function useMarkTooltip<T>() {
  const [tip, setTip] = useState<{ rect: DOMRect; content: T } | null>(null);
  const show = (e: React.SyntheticEvent<HTMLElement>, content: T) => {
    setTip({ rect: e.currentTarget.getBoundingClientRect(), content });
  };
  const hide = () => setTip(null);

  // A hovered mark can scroll out from under a stale rect — drop the
  // tooltip on scroll rather than let it float over the wrong element.
  useEffect(() => {
    if (!tip) return;
    const onScroll = () => setTip(null);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [tip]);

  return { tip, show, hide };
}

function MarkTooltip({ rect, children }: { rect: DOMRect; children: React.ReactNode }) {
  const width = 200;
  const half = width / 2;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const centerX = rect.left + rect.width / 2;
  const left = Math.min(Math.max(centerX, half + 8), vw - half - 8);
  const placeBelow = rect.top < 90;

  return (
    <div
      role="tooltip"
      className="fixed z-50 pointer-events-none rounded-lg border border-[var(--border)] bg-[var(--bg2)] shadow-lg px-3 py-2 text-xs animate-[tooltip-in_0.1s_ease-out]"
      style={{
        left,
        top: placeBelow ? rect.bottom + 10 : rect.top - 10,
        width,
        transform: placeBelow ? "translateX(-50%)" : "translate(-50%, -100%)",
      }}
    >
      {children}
    </div>
  );
}

function StackedBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  const [tableView, setTableView] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const { tip, show, hide } = useMarkTooltip<{ label: string; value: number; color: string }>();

  if (total === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No data for this selection.</p>;
  }

  const visible = segments.filter((s) => s.value > 0);

  const onEnter = (e: React.SyntheticEvent<HTMLElement>, s: { label: string; value: number; color: string }) => {
    setHovered(s.label);
    show(e, s);
  };
  const onLeave = () => {
    setHovered(null);
    hide();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-wrap gap-x-1 gap-y-1">
          {visible.map((s) => (
            <span
              key={s.label}
              tabIndex={0}
              role="img"
              aria-label={`${s.label}: ${s.value} guests, ${formatPct(s.value, total)}`}
              className="inline-flex items-center gap-1.5 text-xs rounded px-1.5 py-1 cursor-default transition-[background-color,opacity] outline-none focus-visible:ring-1 focus-visible:ring-[var(--orange)]"
              style={{
                color: hovered && hovered !== s.label ? "var(--text-muted)" : "var(--text-muted)",
                background: hovered === s.label ? "var(--bg2)" : "transparent",
                opacity: hovered && hovered !== s.label ? 0.5 : 1,
              }}
              onPointerEnter={(e) => onEnter(e, s)}
              onPointerLeave={onLeave}
              onFocus={(e) => onEnter(e, s)}
              onBlur={onLeave}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0 transition-transform"
                style={{
                  background: s.color,
                  transform: hovered === s.label ? "scale(1.15)" : undefined,
                }}
              />
              {s.label} · {formatPct(s.value, total)}
            </span>
          ))}
        </div>
        <button
          onClick={() => setTableView((v) => !v)}
          className="text-xs text-[var(--text-muted)] underline hover:text-[var(--orange)] flex-shrink-0 ml-3"
        >
          {tableView ? "View as chart" : "View as table"}
        </button>
      </div>

      {tableView ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="py-1.5 font-medium">Category</th>
              <th className="py-1.5 font-medium text-right">Count</th>
              <th className="py-1.5 font-medium text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr
                key={s.label}
                className="border-b border-[var(--border)]/50 transition-colors"
                style={{ background: hovered === s.label ? "var(--bg2)" : undefined }}
                onPointerEnter={(e) => onEnter(e, s)}
                onPointerLeave={onLeave}
              >
                <td className="py-1.5 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: s.color }} />
                  {s.label}
                </td>
                <td className="py-1.5 text-right tabular-nums">{s.value}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatPct(s.value, total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div
          className="flex w-full h-8 rounded-md overflow-hidden"
          role="img"
          aria-label={`${visible.map((s) => `${s.label} ${formatPct(s.value, total)}`).join(", ")}`}
        >
          {visible.map((s, i) => (
            <div
              key={s.label}
              tabIndex={0}
              role="img"
              aria-label={`${s.label}: ${s.value} guests, ${formatPct(s.value, total)}`}
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
                marginLeft: i === 0 ? 0 : "2px",
                opacity: hovered && hovered !== s.label ? 0.45 : 1,
                filter: hovered === s.label ? "brightness(1.18)" : undefined,
                outline: hovered === s.label ? "2px solid rgba(255,255,255,0.55)" : undefined,
                outlineOffset: hovered === s.label ? "-2px" : undefined,
              }}
              className="h-full first:rounded-l-md last:rounded-r-md cursor-default transition-[opacity,filter] outline-none"
              onPointerEnter={(e) => onEnter(e, s)}
              onPointerLeave={onLeave}
              onFocus={(e) => onEnter(e, s)}
              onBlur={onLeave}
            />
          ))}
        </div>
      )}

      {tip && (
        <MarkTooltip rect={tip.rect}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: tip.content.color }} />
            <span className="text-[var(--text-muted)]">{tip.content.label}</span>
          </div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {tip.content.value} guests · {formatPct(tip.content.value, total)}
          </div>
        </MarkTooltip>
      )}
    </div>
  );
}

export default function RoundupClient({
  eras,
  eraTotals,
  professionByGuest,
  professionCategoryOrder,
  generationByGuest,
  generationCategoryOrder,
  guestFacts,
}: Props) {
  const [selected, setSelected] = useState<Set<Era>>(new Set(eras));

  const toggleEra = (era: Era) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(era)) {
        if (next.size > 1) next.delete(era); // keep at least one era on
      } else {
        next.add(era);
      }
      return next;
    });
  };

  // Counts each guest once against the union of selected eras, not once per
  // era they happen to have appeared in — otherwise a guest who crossed
  // multiple selected eras gets counted (and weighted into the percentage
  // split) multiple times over.
  const professionSegments = useMemo(() => {
    const totals: Record<string, number> = {};
    let combinedTotal = 0;
    for (const entry of professionByGuest) {
      if (!entry.eras.some((e) => selected.has(e))) continue;
      totals[entry.bucket] = (totals[entry.bucket] ?? 0) + 1;
      combinedTotal += 1;
    }
    const labels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    return {
      total: combinedTotal,
      segments: labels.map((label) => ({
        label,
        value: totals[label],
        color: colorForCategory(professionCategoryOrder, label),
      })),
    };
  }, [professionByGuest, selected, professionCategoryOrder]);

  const generationSegments = useMemo(() => {
    const totals: Record<string, number> = {};
    let combinedTotal = 0;
    for (const entry of generationByGuest) {
      if (!entry.eras.some((e) => selected.has(e))) continue;
      totals[entry.bucket] = (totals[entry.bucket] ?? 0) + 1;
      combinedTotal += 1;
    }

    // Real data exists for at least one guest in the selected eras — use it.
    // Fixed chronological order (not sorted by size, unlike Profession) since
    // generation is ordinal, and so the bars read left-to-right by age.
    if (combinedTotal > 0) {
      return {
        illustrative: false,
        total: combinedTotal,
        segments: ILLUSTRATIVE_GENERATION_BUCKETS.map((b) => ({
          label: b.label,
          value: totals[b.label] ?? 0,
          color: colorForCategory(generationCategoryOrder, b.label),
        })),
      };
    }

    // No birth_year data yet for this selection — fall back to the
    // illustrative placeholder split.
    return {
      illustrative: true,
      total: 1000,
      segments: ILLUSTRATIVE_GENERATION_BUCKETS.map((b) => ({
        label: b.label,
        value: Math.round(b.share * 1000),
        color: colorForCategory(generationCategoryOrder, b.label),
      })),
    };
  }, [generationByGuest, selected, generationCategoryOrder]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold mb-2">The Roundup</h1>
      <p className="text-[var(--text-muted)] mb-8">
        Three decades, four sets, one very recurring cast of friends — who they are, and what they
        do when they&apos;re not in the chair.
      </p>

      {/* Era filter row */}
      <div className="flex flex-wrap gap-2 mb-10">
        {eras.map((era) => {
          const active = selected.has(era);
          const color = getEraTextColor(era);
          return (
            <button
              key={era}
              onClick={() => toggleEra(era)}
              aria-pressed={active}
              className="px-3 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-1.5"
              style={{
                borderColor: active ? color : "var(--border)",
                background: active ? `${color}26` : "transparent",
                color: active ? color : "var(--text-muted)",
              }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                style={{ background: active ? color : "var(--text-muted)" }}
              />
              {ERA_LABELS[era]}
              <span className="opacity-70 tabular-nums">· {eraTotals[era]}</span>
            </button>
          );
        })}
      </div>

      {/* Generation breakdown */}
      <section className="mb-12">
        <div className="flex items-baseline gap-2 mb-4">
          <h2 className="font-serif text-2xl font-semibold">Generation</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg2)] border border-[var(--border)] text-[var(--text-muted)]">
            {generationSegments.illustrative
              ? "Illustrative"
              : `${generationSegments.total} indexed`}
          </span>
        </div>
        <StackedBar segments={generationSegments.segments} total={generationSegments.total} />
      </section>

      {/* Profession breakdown */}
      <section className="mb-12">
        <div className="flex items-baseline gap-2 mb-4">
          <h2 className="font-serif text-2xl font-semibold">Profession</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg2)] border border-[var(--border)] text-[var(--text-muted)]">
            {professionSegments.total} enriched bios
          </span>
        </div>
        <StackedBar segments={professionSegments.segments} total={professionSegments.total} />
      </section>

      <RoundupFunFacts guests={guestFacts} selected={selected} allEras={eras} />
    </div>
  );
}
