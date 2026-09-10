"use client";

import { useMemo, useState } from "react";
import { ERA_LABELS, getEraTextColor } from "@/lib/data";
import type { Era } from "@/lib/types";

interface Props {
  eras: Era[];
  eraTotals: Record<Era, number>;
  crossover: number[][];
  professionByGuest: { eras: Era[]; bucket: string }[];
  professionCategoryOrder: string[];
  generationByGuest: { eras: Era[]; bucket: string }[];
  generationCategoryOrder: string[];
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

// Single-hue sequential ramp (brand orange, blended over the card surface)
// for the heatmap — magnitude reads by lightness/chroma alone, low to high.
const SEQUENTIAL_RAMP = ["#2c2226", "#543026", "#803f25", "#b04f24", "#e05f22"];

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

function StackedBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  const [tableView, setTableView] = useState(false);
  if (total === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No data for this selection.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: s.color }} />
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
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <tr key={s.label} className="border-b border-[var(--border)]/50">
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
        <div className="flex w-full h-8 rounded-md overflow-hidden" role="img" aria-label={`${segments.map((s) => `${s.label} ${formatPct(s.value, total)}`).join(", ")}`}>
          {segments
            .filter((s) => s.value > 0)
            .map((s, i) => (
              <div
                key={s.label}
                title={`${s.label}: ${s.value} (${formatPct(s.value, total)})`}
                style={{
                  width: `${(s.value / total) * 100}%`,
                  background: s.color,
                  marginLeft: i === 0 ? 0 : "2px",
                }}
                className="h-full first:rounded-l-md last:rounded-r-md"
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function RoundupClient({
  eras,
  eraTotals,
  crossover,
  professionByGuest,
  professionCategoryOrder,
  generationByGuest,
  generationCategoryOrder,
}: Props) {
  const [selected, setSelected] = useState<Set<Era>>(new Set(eras));
  const [heatmapTable, setHeatmapTable] = useState(false);

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

  const maxOffDiagonal = useMemo(() => {
    let max = 0;
    crossover.forEach((row, i) =>
      row.forEach((v, j) => {
        if (i !== j) max = Math.max(max, v);
      })
    );
    return max || 1;
  }, [crossover]);

  const rampIndex = (value: number) => {
    const frac = value / maxOffDiagonal;
    return Math.min(SEQUENTIAL_RAMP.length - 1, Math.floor(frac * SEQUENTIAL_RAMP.length));
  };

  // Raw overlap counts are dominated by whichever era ran longer and simply
  // had more guests to begin with — 161 reads as thin next to Late Night
  // NBC's 2,440 guests, but it's 66% of every guest Tonight Show ever had.
  // Expressing overlap as a share of the smaller (shorter-running) era's
  // total surfaces that instead of leaving it to be misread from the count.
  const pctOfSmallerEra = (rowEra: Era, colEra: Era, value: number) => {
    const smaller = Math.min(eraTotals[rowEra], eraTotals[colEra]);
    return smaller > 0 ? Math.round((value / smaller) * 100) : 0;
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
        do when they&apos;re not on the couch.
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
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="font-serif text-2xl font-semibold">Generation</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg2)] border border-[var(--border)] text-[var(--text-muted)]">
            {generationSegments.illustrative
              ? "Illustrative"
              : `${generationSegments.total} indexed`}
          </span>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {generationSegments.illustrative
            ? "A placeholder, not a live number — no one in this selection has an indexed birth year yet, so this is roughly what the real split should look like once that data's in."
            : "Based on the birth years we've tracked down so far — most of the roster at this point, with a few stragglers still missing."}
        </p>
        <StackedBar segments={generationSegments.segments} total={generationSegments.total} />
      </section>

      {/* Profession breakdown */}
      <section className="mb-12">
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="font-serif text-2xl font-semibold">Profession</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg2)] border border-[var(--border)] text-[var(--text-muted)]">
            {professionSegments.total} enriched bios
          </span>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Based on real, enriched bios — we&apos;ve got most of the roster covered at this point,
          with a handful still to go.
        </p>
        <StackedBar segments={professionSegments.segments} total={professionSegments.total} />
      </section>

      {/* Era Crossover heatmap */}
      <section>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-serif text-2xl font-semibold">Era Crossover</h2>
          <button
            onClick={() => setHeatmapTable((v) => !v)}
            className="text-xs text-[var(--text-muted)] underline hover:text-[var(--orange)]"
          >
            {heatmapTable ? "View as chart" : "View as table"}
          </button>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          How many guests stuck around across two eras, not just one — each pair counted once,
          regardless of order. (An era&apos;s own total is already up in its filter chip.)
        </p>

        {heatmapTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm max-w-md">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="py-1.5 font-medium">Pair</th>
                  <th className="py-1.5 font-medium text-right">Both</th>
                  <th className="py-1.5 font-medium text-right">% of smaller era</th>
                </tr>
              </thead>
              <tbody>
                {eras.map((rowEra, i) =>
                  eras.map((colEra, j) => {
                    if (j >= i) return null;
                    const value = crossover[i][j];
                    return (
                      <tr key={`${rowEra}-${colEra}`} className="border-b border-[var(--border)]/50">
                        <td className="py-1.5">
                          {ERA_LABELS[rowEra]} &amp; {ERA_LABELS[colEra]}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{value}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {pctOfSmallerEra(rowEra, colEra, value)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid gap-[3px] max-w-md"
              style={{ gridTemplateColumns: `88px repeat(${eras.length - 1}, 72px)` }}
            >
              <div />
              {eras.slice(0, -1).map((e) => (
                <div
                  key={e}
                  className="text-[11px] font-medium text-center pb-1.5 flex items-end justify-center leading-tight"
                  style={{ color: getEraTextColor(e) }}
                >
                  {ERA_LABELS[e]}
                </div>
              ))}
              {eras.slice(1).map((rowEra, ri) => {
                const i = ri + 1;
                return (
                  <div key={rowEra} className="contents">
                    <div
                      className="text-[11px] font-medium flex items-center pr-2 leading-tight"
                      style={{ color: getEraTextColor(rowEra) }}
                    >
                      {ERA_LABELS[rowEra]}
                    </div>
                    {eras.slice(0, -1).map((colEra, j) => {
                      if (j >= i) {
                        return <div key={colEra} />;
                      }
                      const value = crossover[i][j];
                      const dimmed = !selected.has(rowEra) || !selected.has(colEra);
                      return (
                        <div
                          key={colEra}
                          title={`${ERA_LABELS[rowEra]} & ${ERA_LABELS[colEra]}: ${value} guests appeared in both (${pctOfSmallerEra(rowEra, colEra, value)}% of ${eraTotals[rowEra] < eraTotals[colEra] ? ERA_LABELS[rowEra] : ERA_LABELS[colEra]}'s total)`}
                          className="aspect-square rounded-md flex items-center justify-center text-xs font-medium tabular-nums transition-opacity"
                          style={{
                            background: SEQUENTIAL_RAMP[rampIndex(value)],
                            color: "#fff",
                            opacity: dimmed ? 0.35 : 1,
                          }}
                        >
                          {value}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
