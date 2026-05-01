"use client";

import { useEffect } from "react";
import type { Guest } from "@/lib/types";
import GuestAvatar from "./GuestAvatar";
import { ERA_LABELS, ORIGIN_LABELS, getEraTextColor } from "@/lib/data";

interface Props {
  guest: Guest;
  onClose: () => void;
}

const ERA_ORDER = ["late-night-nbc", "tonight-show", "tbs-conan", "podcast", "conan-must-go"] as const;

export default function GuestModal({ guest, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const eraGroups = ERA_ORDER.map((era) => ({
    era,
    apps: guest.appearances.filter((a) => a.era === era),
  })).filter((g) => g.apps.length > 0);

  const coldWords = [
    ...new Set(
      guest.appearances
        .filter((a) => a.coldOpenWord)
        .map((a) => a.coldOpenWord!)
    ),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative z-10 w-full sm:max-w-lg max-h-[90vh] sm:max-h-[80vh] overflow-y-auto bg-[var(--bg)] sm:rounded-2xl rounded-t-2xl border border-[var(--border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--bg)] flex items-center gap-4 px-6 py-4 border-b border-[var(--border)]">
          <GuestAvatar name={guest.name} photoUrl={guest.photoUrl} size={52} />
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-xl font-semibold leading-tight">{guest.name}</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {guest.appearances.length} appearance{guest.appearances.length !== 1 ? "s" : ""} ·{" "}
              {eraGroups.length} era{eraGroups.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg2)] text-[var(--text-muted)] text-lg flex-shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Bio */}
          {guest.bio?.description && (
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              {guest.bio.description}
            </p>
          )}

          {/* Known for */}
          {(guest.bio?.known_for?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Known for
              </p>
              <div className="space-y-1.5">
                {guest.bio!.known_for.map((w, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium leading-snug">{w.title}</span>
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {w.year ? `${w.year} · ` : ""}{w.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* How Conan knows them */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              How Conan knows them
            </p>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              {guest.bio?.conan_connection?.evidence ||
                (guest.origin.type !== "cold-booking"
                  ? guest.origin.label
                  : "Appeared as a guest on the show.")}
            </p>
          </div>

          {/* Cold open words */}
          {coldWords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {coldWords.map((word, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 bg-[var(--bg2)] border border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] capitalize"
                >
                  {word}
                </span>
              ))}
            </div>
          )}

          {/* Eras */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              Appearances by era
            </p>
            <div className="space-y-1.5">
              {eraGroups.map(({ era, apps }) => (
                <div key={era} className="flex items-center gap-2 text-sm">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: getEraTextColor(era) }}
                  />
                  <span style={{ color: getEraTextColor(era) }} className="font-medium">
                    {ERA_LABELS[era]}
                  </span>
                  <span className="text-[var(--text-muted)] text-xs">
                    {apps.length}×
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-1">
          <a
            href={`/guest/${guest.id}`}
            className="block w-full text-center py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--orange)] transition-colors"
          >
            Full profile ↗
          </a>
        </div>
      </div>
    </div>
  );
}
