import { TIER_COLORS } from "@/lib/data";
import type { FriendshipLabel } from "@/lib/types";

interface Props {
  score: number;
  label: FriendshipLabel;
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
}

export default function FriendshipBadge({
  score,
  label,
  size = "md",
  showTooltip = true,
}: Props) {
  const color = TIER_COLORS[label];

  const sizes = {
    sm: { score: "text-2xl", label: "text-xs", pad: "px-2 py-1" },
    md: { score: "text-4xl", label: "text-sm", pad: "px-3 py-1.5" },
    lg: { score: "text-6xl", label: "text-base", pad: "px-4 py-2" },
  };

  const s = sizes[size];

  return (
    <div className="flex flex-col items-center gap-1 group relative">
      <span
        className={`font-serif font-bold leading-none ${s.score}`}
        style={{ color }}
      >
        {score}
      </span>
      <span
        className={`font-semibold rounded-full text-white ${s.label} ${s.pad}`}
        style={{ background: color }}
      >
        {label}
      </span>
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[var(--text)] text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          A fan-made score, with love ♥
        </div>
      )}
    </div>
  );
}
