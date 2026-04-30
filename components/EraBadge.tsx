import { ERA_LABELS, ERA_YEARS } from "@/lib/data";
import type { Era } from "@/lib/types";

interface Props {
  era: Era;
  showYears?: boolean;
  size?: "sm" | "md";
}

const ERA_CSS: Record<Era, string> = {
  "late-night-nbc": "era-late-night-nbc",
  "tonight-show": "era-tonight-show",
  "tbs-conan": "era-tbs-conan",
  podcast: "era-podcast",
  "conan-must-go": "era-conan-must-go",
};

export default function EraBadge({ era, showYears = false, size = "sm" }: Props) {
  const css = ERA_CSS[era];
  const padding = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`${css} ${padding} rounded-full font-medium inline-flex items-center gap-1`}>
      {ERA_LABELS[era]}
      {showYears && (
        <span className="opacity-70">· {ERA_YEARS[era]}</span>
      )}
    </span>
  );
}
