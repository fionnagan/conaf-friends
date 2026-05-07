"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useMotionConfig } from "@/lib/use-reduced-motion";

export interface GuestMatch {
  guest_id: string;
  guest_name: string;
  episode_url: string;
  profile_url: string;
  cold_open_text: string;
  feeling_phrase_normalized: string;
  photo_url?: string;
}

interface Props {
  matches: GuestMatch[];
  feeling: string;
}

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export default function MatchCards({ matches, feeling }: Props) {
  const { t, stagger } = useMotionConfig();
  if (!matches.length) return null;
  const top = matches[0];

  return (
    <section className="space-y-5">
      {/* Emotional identity headline */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t({ duration: 0.5, ease: "easeOut" })}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">
          Your emotional match
        </p>
        <h2 className="font-serif text-2xl font-semibold leading-tight">
          You feel most like{" "}
          <a
            href={top.profile_url}
            className="text-[var(--orange)] hover:underline"
          >
            {top.guest_name}
          </a>
        </h2>
        {feeling && (
          <p className="text-sm text-[var(--text-muted)] mt-1">
            About being <span className="italic">&quot;{feeling}&quot;</span> about being Conan&apos;s friend
          </p>
        )}
      </motion.div>

      {/* Guest cards */}
      <div className="space-y-3">
        {matches.map((m, i) => (
          <motion.a
            key={m.guest_id + m.episode_url}
            href={m.profile_url}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={t({ delay: stagger(i, 0.12), duration: 0.45, ease: "easeOut" })}
            whileHover={{ scale: 1.012, transition: { duration: 0.18 } }}
            className="flex items-center gap-4 p-4 bg-[var(--bg2)] rounded-2xl border border-[var(--border)] hover:border-[var(--orange)]/60 transition-colors group cursor-pointer"
          >
            {/* Circular photo */}
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-full overflow-hidden bg-[var(--orange)]/20 flex items-center justify-center ring-2 ring-[var(--border)] group-hover:ring-[var(--orange)]/40 transition-all">
                {m.photo_url ? (
                  <Image
                    src={m.photo_url}
                    alt={m.guest_name}
                    width={56}
                    height={56}
                    className="object-cover w-full h-full"
                    unoptimized
                  />
                ) : (
                  <span className="font-serif text-lg font-semibold text-[var(--orange)]">
                    {initials(m.guest_name)}
                  </span>
                )}
              </div>
              {i === 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--orange)] flex items-center justify-center text-white text-[10px] font-bold shadow-lg">
                  ★
                </span>
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm group-hover:text-[var(--orange)] transition-colors truncate">
                {m.guest_name}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                Conan said they felt{" "}
                <span className="text-[var(--text)] italic font-medium">
                  &quot;{m.cold_open_text}&quot;
                </span>
              </p>
            </div>

            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <span className="text-[var(--text-muted)] text-xs group-hover:text-[var(--orange)] transition-colors">
                View →
              </span>
              {i === 0 && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--orange)] bg-[var(--orange)]/10 px-2 py-0.5 rounded-full">
                  Best match
                </span>
              )}
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
