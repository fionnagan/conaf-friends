"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Node {
  id: string;
  label: string;
  count: number;
  guests: string[];
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link {
  source: string;
  target: string;
  strength: number;
}

interface Props {
  words: { word: string; count: number; guests?: string[] }[];
  onNodeClick?: (word: string) => void;
}

const ORANGE = "#F26519";
const LINE   = "rgba(242,101,25,0.15)";

export default function Constellation({ words, onNodeClick }: Props) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const nodesRef      = useRef<Node[]>([]);
  const linksRef      = useRef<Link[]>([]);
  const rafRef        = useRef<number>(0);
  const hoveredRef    = useRef<Node | null>(null);
  const [selected, setSelected] = useState<Node | null>(null);
  const [, setHoveredLabel] = useState<string | null>(null);
  const W = 700, H = 420;

  // Build nodes + links from top words
  useEffect(() => {
    if (!words.length) return;

    nodesRef.current = words.map((w, i) => ({
      id: w.word,
      label: w.word,
      count: w.count,
      guests: w.guests ?? [],
      // Scatter initial positions in a circle
      x: W / 2 + (W * 0.35) * Math.cos((2 * Math.PI * i) / words.length),
      y: H / 2 + (H * 0.35) * Math.sin((2 * Math.PI * i) / words.length),
      vx: 0, vy: 0,
    }));

    // Link nodes with count similarity
    const links: Link[] = [];
    const sorted = [...words].sort((a, b) => b.count - a.count);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < Math.min(i + 3, sorted.length); j++) {
        links.push({ source: sorted[i].word, target: sorted[j].word, strength: 0.5 });
      }
    }
    linksRef.current = links;
  }, [words]);

  // Force simulation loop (pure JS — no d3-force to avoid SSR issues)
  useEffect(() => {
    const canvas  = canvasRef.current;
    if (!canvas || !nodesRef.current.length) return;
    const ctx     = canvas.getContext("2d")!;
    if (!ctx) return;

    const REPEL   = 3500;
    const ATTRACT = 0.03;
    const DAMPING = 0.88;
    const CENTER_X = W / 2, CENTER_Y = H / 2;

    function tick() {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const maxCount = Math.max(...nodes.map((n) => n.count), 1);

      // Repulsion between all node pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = (nodes[j].x ?? 0) - (nodes[i].x ?? 0);
          const dy = (nodes[j].y ?? 0) - (nodes[i].y ?? 0);
          const d2 = dx * dx + dy * dy + 1;
          const f  = REPEL / d2;
          const fx = dx / Math.sqrt(d2) * f;
          const fy = dy / Math.sqrt(d2) * f;
          if (nodes[i].fx == null) { nodes[i].vx! -= fx; nodes[i].vy! -= fy; }
          if (nodes[j].fx == null) { nodes[j].vx! += fx; nodes[j].vy! += fy; }
        }
      }

      // Spring attraction along links
      for (const link of links) {
        const src = nodes.find((n) => n.id === link.source);
        const tgt = nodes.find((n) => n.id === link.target);
        if (!src || !tgt) continue;
        const dx = (tgt.x ?? 0) - (src.x ?? 0);
        const dy = (tgt.y ?? 0) - (src.y ?? 0);
        const d  = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const idealDist = 140;
        const f  = (d - idealDist) * ATTRACT * link.strength;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (src.fx == null) { src.vx! += fx; src.vy! += fy; }
        if (tgt.fx == null) { tgt.vx! -= fx; tgt.vy! -= fy; }
      }

      // Gravity toward center
      for (const n of nodes) {
        if (n.fx != null) continue;
        n.vx! += ((CENTER_X - (n.x ?? 0)) * 0.004);
        n.vy! += ((CENTER_Y - (n.y ?? 0)) * 0.004);
        n.vx! *= DAMPING;
        n.vy! *= DAMPING;
        n.x = (n.x ?? 0) + n.vx!;
        n.y = (n.y ?? 0) + n.vy!;
        // Bound within canvas
        const r = 12 + (n.count / maxCount) * 22;
        n.x = Math.max(r, Math.min(W - r, n.x));
        n.y = Math.max(r, Math.min(H - r, n.y));
      }

      // Draw
      ctx.clearRect(0, 0, W, H);

      // Links
      for (const link of links) {
        const src = nodes.find((n) => n.id === link.source);
        const tgt = nodes.find((n) => n.id === link.target);
        if (!src || !tgt) continue;
        ctx.beginPath();
        ctx.moveTo(src.x!, src.y!);
        ctx.lineTo(tgt.x!, tgt.y!);
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        const r        = 12 + (n.count / maxCount) * 22;
        const isHover  = hoveredRef.current?.id === n.id;
        const isSel    = selected?.id === n.id;

        // Glow
        if (isHover || isSel) {
          const grad = ctx.createRadialGradient(n.x!, n.y!, 0, n.x!, n.y!, r * 2.2);
          grad.addColorStop(0, "rgba(242,101,25,0.25)");
          grad.addColorStop(1, "rgba(242,101,25,0)");
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Circle
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fillStyle = isHover || isSel ? ORANGE : "rgba(242,101,25,0.3)";
        ctx.fill();
        ctx.strokeStyle = isHover || isSel ? ORANGE : "rgba(242,101,25,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = isHover || isSel ? "#ffffff" : "rgba(255,255,255,0.7)";
        ctx.font = `${isHover ? 600 : 500} ${Math.max(10, 10 + (n.count / maxCount) * 4)}px system-ui,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.label, n.x!, n.y!);

        // Count badge
        if (n.count > 1) {
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.font = "400 9px system-ui,sans-serif";
          ctx.fillText(`×${n.count}`, n.x!, n.y! + r + 8);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, selected]);

  // Mouse interaction
  const hitTest = useCallback((cx: number, cy: number): Node | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx = (cx - rect.left) * scaleX;
    const my = (cy - rect.top)  * scaleY;
    const nodes = nodesRef.current;
    const maxCount = Math.max(...nodes.map((n) => n.count), 1);
    for (const n of nodes) {
      const r = 12 + (n.count / maxCount) * 22 + 6; // 6px hit-box margin
      const dx = (n.x ?? 0) - mx;
      const dy = (n.y ?? 0) - my;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    hoveredRef.current = hit;
    setHoveredLabel(hit?.label ?? null);
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? "pointer" : "default";
  }, [hitTest]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) {
      setSelected((prev) => prev?.id === hit.id ? null : hit);
      onNodeClick?.(hit.id);
    } else {
      setSelected(null);
    }
  }, [hitTest, onNodeClick]);

  // Drag support
  const draggingRef = useRef<Node | null>(null);
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) { draggingRef.current = hit; hit.fx = hit.x; hit.fy = hit.y; }
  }, [hitTest]);

  const handleMouseUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current.fx = null;
      draggingRef.current.fy = null;
      draggingRef.current = null;
    }
  }, []);

  const handleDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const n = draggingRef.current;
    if (!n) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect   = canvas.getBoundingClientRect();
    n.fx = (e.clientX - rect.left) * (W / rect.width);
    n.fy = (e.clientY - rect.top)  * (H / rect.height);
    n.x  = n.fx;
    n.y  = n.fy;
  }, []);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg2)]"
        style={{ touchAction: "none" }}
        onMouseMove={(e) => { handleMouseMove(e); handleDrag(e); }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onMouseLeave={() => { hoveredRef.current = null; setHoveredLabel(null); handleMouseUp(); }}
      />

      <AnimatePresence>
        {selected && (
          <motion.div
            key="node-panel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 p-4 bg-[var(--bg2)] rounded-xl border border-[var(--orange)]/40"
          >
            <div className="flex items-center justify-between mb-1">
              <p className="font-semibold capitalize">{selected.label}</p>
              <button onClick={() => setSelected(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg">×</button>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Appears <span className="text-[var(--orange)] font-semibold">×{selected.count}</span> times across guest cold opens.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-2 text-xs text-[var(--text-muted)] text-center">
        Drag nodes · Click to inspect · Sizes reflect frequency
      </p>
    </div>
  );
}
