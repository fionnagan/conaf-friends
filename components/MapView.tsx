"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import type { Guest, OriginType, Era, FriendshipLabel } from "@/lib/types";
import { TIER_COLORS, ORIGIN_LABELS } from "@/lib/data";
import GuestPanel from "./GuestPanel";
import GuestAvatar from "./GuestAvatar";

interface Props {
  guests: Guest[];
}

interface NodeDatum extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  score: number;
  label: FriendshipLabel;
  origin: OriginType;
  photoUrl: string | null;
  appearanceCount: number;
  radius: number;
  color: string;
}

const ORIGIN_GROUP_POSITIONS: Record<OriginType, { x: number; y: number }> = {
  "snl-simpsons": { x: 0.2, y: 0.3 },
  "harvard-lampoon": { x: 0.15, y: 0.6 },
  "comedy-peer": { x: 0.5, y: 0.25 },
  "late-night-regular": { x: 0.5, y: 0.7 },
  "second-degree": { x: 0.75, y: 0.35 },
  "cold-booking": { x: 0.8, y: 0.65 },
};

const ERA_OPTIONS: { value: Era | "all"; label: string }[] = [
  { value: "all", label: "All eras" },
  { value: "late-night-nbc", label: "Late Night NBC" },
  { value: "tonight-show", label: "Tonight Show" },
  { value: "tbs-conan", label: "Conan (TBS)" },
  { value: "podcast", label: "Podcast" },
  { value: "conan-must-go", label: "Conan Must Go" },
];

export default function MapView({ guests }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<NodeDatum, undefined> | null>(null);

  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [eraFilter, setEraFilter] = useState<Era | "all">("all");
  const [minScore, setMinScore] = useState(0);
  const [originFilter, setOriginFilter] = useState<OriginType | "all">("all");
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    name: string;
    score: number;
    label: string;
  } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const filteredGuests = useMemo(() => {
    return guests.filter((g) => {
      if (search && !g.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (eraFilter !== "all" && !g.appearances.some((a) => a.era === eraFilter))
        return false;
      if (originFilter !== "all" && g.origin.type !== originFilter) return false;
      if (g.friendshipScore < minScore) return false;
      return true;
    });
  }, [guests, search, eraFilter, originFilter, minScore]);

  const nodes: NodeDatum[] = useMemo(
    () =>
      filteredGuests.map((g) => ({
        id: g.id,
        name: g.name,
        score: g.friendshipScore,
        label: g.friendshipLabel,
        origin: g.origin.type,
        photoUrl: g.photoUrl,
        appearanceCount: g.appearances.length,
        radius: Math.max(6, Math.min(24, 4 + g.appearances.length * 3)),
        color: TIER_COLORS[g.friendshipLabel],
      })),
    [filteredGuests]
  );

  const runSimulation = useCallback(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container || nodes.length === 0) return;

    const W = container.clientWidth;
    const H = container.clientHeight;

    d3.select(svg).selectAll("*").remove();
    d3.select(svg).attr("width", W).attr("height", H);

    const g = d3.select(svg).append("g");

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => g.attr("transform", event.transform));
    d3.select(svg).call(zoom);

    // Simulation
    const simulation = d3
      .forceSimulation<NodeDatum>(nodes)
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force(
        "collision",
        d3.forceCollide<NodeDatum>().radius((d) => d.radius + 4)
      )
      .force(
        "x",
        d3.forceX<NodeDatum>((d) => {
          const pos = ORIGIN_GROUP_POSITIONS[d.origin];
          return pos ? pos.x * W : W / 2;
        }).strength(0.08)
      )
      .force(
        "y",
        d3.forceY<NodeDatum>((d) => {
          const pos = ORIGIN_GROUP_POSITIONS[d.origin];
          return pos ? pos.y * H : H / 2;
        }).strength(0.08)
      );

    simRef.current = simulation;

    // Origin cluster labels (background)
    const originLabelGroup = g.append("g").attr("class", "origin-labels");
    const drawnOrigins = new Set<OriginType>();
    nodes.forEach((n) => {
      if (!drawnOrigins.has(n.origin)) {
        drawnOrigins.add(n.origin);
        const pos = ORIGIN_GROUP_POSITIONS[n.origin];
        if (pos) {
          originLabelGroup
            .append("text")
            .attr("x", pos.x * W)
            .attr("y", pos.y * H - 30)
            .attr("text-anchor", "middle")
            .attr("font-size", 11)
            .attr("font-family", "Fraunces, Georgia, serif")
            .attr("fill", "#C8C4BC")
            .attr("pointer-events", "none")
            .text(ORIGIN_LABELS[n.origin]);
        }
      }
    });

    // Nodes
    const node = g
      .append("g")
      .selectAll<SVGCircleElement, NodeDatum>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .on("click", (_event, d) => {
        setSelectedGuest(d.id);
      })
      .on("mouseover", (event, d) => {
        const rect = svg.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 12,
          name: d.name,
          score: d.score,
          label: d.label,
        });
        d3.select(event.target as SVGCircleElement)
          .attr("stroke", "#2A2724")
          .attr("stroke-width", 2.5);
      })
      .on("mousemove", (event) => {
        const rect = svg.getBoundingClientRect();
        setTooltip((prev) =>
          prev
            ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top - 12 }
            : prev
        );
      })
      .on("mouseout", (event) => {
        setTooltip(null);
        d3.select(event.target as SVGCircleElement)
          .attr("stroke", "white")
          .attr("stroke-width", 2);
      })
      .call(
        d3
          .drag<SVGCircleElement, NodeDatum>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    simulation.on("tick", () => {
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
    });
  }, [nodes]);

  useEffect(() => {
    if (isMobile) return;
    runSimulation();
    const handleResize = () => runSimulation();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      simRef.current?.stop();
    };
  }, [runSimulation, isMobile]);

  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <MobileFilters
          search={search}
          setSearch={setSearch}
          eraFilter={eraFilter}
          setEraFilter={setEraFilter}
        />
        <GuestList
          guests={filteredGuests}
          onSelect={setSelectedGuest}
          total={guests.length}
        />
        <GuestPanel guestId={selectedGuest} onClose={() => setSelectedGuest(null)} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-[var(--border)] flex flex-col bg-[var(--bg)] overflow-y-auto">
        <div className="p-4 border-b border-[var(--border)]">
          <input
            type="search"
            placeholder="Search guests…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg2)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--orange)]"
          />
        </div>

        <div className="p-4 border-b border-[var(--border)] space-y-3">
          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
              Era
            </label>
            <select
              value={eraFilter}
              onChange={(e) => setEraFilter(e.target.value as Era | "all")}
              className="w-full text-sm border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg2)] focus:outline-none"
            >
              {ERA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] block mb-1">
              Origin
            </label>
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as OriginType | "all")}
              className="w-full text-sm border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg2)] focus:outline-none"
            >
              <option value="all">All origins</option>
              {Object.entries(ORIGIN_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-[var(--text-muted)] flex justify-between mb-1">
              <span>Min score</span>
              <span className="text-[var(--orange)]">{minScore}+</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full accent-[var(--orange)]"
            />
          </div>
        </div>

        <div className="p-3 text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
          {filteredGuests.length} of {guests.length} guests
        </div>

        {/* Tier legend */}
        <div className="p-4">
          <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">
            Friendship tiers
          </p>
          {Object.entries(TIER_COLORS).map(([label, color]) => (
            <div key={label} className="flex items-center gap-2 mb-1">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
              <span className="text-xs">{label}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* D3 canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ background: "var(--bg)" }}
        />

        {/* Tooltip */}
        {tooltip?.visible && (
          <div
            className="tooltip pointer-events-none"
            style={{ left: tooltip.x + 10, top: tooltip.y }}
          >
            <div className="font-semibold">{tooltip.name}</div>
            <div className="text-xs opacity-75">
              {tooltip.score} · {tooltip.label}
            </div>
          </div>
        )}

        {/* Hint */}
        <div className="absolute bottom-4 right-4 text-xs text-[var(--text-muted)] bg-[var(--bg2)]/80 px-2 py-1 rounded-lg border border-[var(--border)]">
          Click a node · Drag to rearrange · Scroll to zoom
        </div>
      </div>

      {/* Guest panel */}
      <GuestPanel
        guestId={selectedGuest}
        onClose={() => setSelectedGuest(null)}
      />
    </div>
  );
}

function MobileFilters({
  search,
  setSearch,
  eraFilter,
  setEraFilter,
}: {
  search: string;
  setSearch: (s: string) => void;
  eraFilter: Era | "all";
  setEraFilter: (e: Era | "all") => void;
}) {
  return (
    <div className="flex gap-2 p-3 border-b border-[var(--border)] bg-[var(--bg)]">
      <input
        type="search"
        placeholder="Search guests…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="flex-1 px-3 py-2 bg-[var(--bg2)] border border-[var(--border)] rounded-lg text-sm focus:outline-none"
      />
      <select
        value={eraFilter}
        onChange={(e) => setEraFilter(e.target.value as Era | "all")}
        className="text-sm border border-[var(--border)] rounded-lg px-2 bg-[var(--bg2)]"
      >
        {ERA_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function GuestList({
  guests,
  onSelect,
  total,
}: {
  guests: Guest[];
  onSelect: (id: string) => void;
  total: number;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-3 text-xs text-[var(--text-muted)]">
        {guests.length} of {total} guests
      </div>
      {guests.map((g) => (
        <button
          key={g.id}
          onClick={() => onSelect(g.id)}
          className="w-full flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] hover:bg-[var(--bg2)] text-left"
        >
          <GuestAvatar name={g.name} photoUrl={g.photoUrl} size={36} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{g.name}</p>
            <p
              className="text-xs font-semibold"
              style={{ color: TIER_COLORS[g.friendshipLabel] }}
            >
              {g.friendshipScore} · {g.friendshipLabel}
            </p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--text-muted)]">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
          </svg>
        </button>
      ))}
    </div>
  );
}
