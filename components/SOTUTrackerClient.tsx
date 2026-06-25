"use client";

import { formatDate } from "@/lib/data";
import type { SOTURecord } from "@/lib/types";

interface Props {
  records: SOTURecord[];
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : null;
}

export default function SOTUTrackerClient({ records }: Props) {
  return (
    <div
      className="relative pl-7"
      style={{ borderLeft: "2px solid var(--border)" }}
    >
      {records.map((r) => {
        const vid = youtubeId(r.source_url);
        return (
          <div
            key={r.id}
            className="relative mb-7 bg-[var(--bg2)] border border-[var(--border)] rounded-xl p-5"
          >
            {/* Timeline dot */}
            <span
              className="absolute rounded-full"
              style={{
                left: "-33px",
                top: "22px",
                width: "10px",
                height: "10px",
                background: "var(--orange)",
              }}
              aria-hidden="true"
            />

            {/* Date — leads the card per design review (date-first hierarchy) */}
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">
              {formatDate(r.air_date)}
            </p>

            {/* Title — secondary */}
            <h2 className="text-lg font-bold mb-3">{r.title}</h2>

            {/* Embed */}
            {vid && (
              <div
                style={{
                  position: "relative",
                  paddingBottom: "56.25%",
                  height: 0,
                  overflow: "hidden",
                  maxWidth: "480px",
                  marginBottom: "12px",
                }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${vid}`}
                  title={r.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    borderRadius: "8px",
                  }}
                />
              </div>
            )}

            {/* Topics */}
            {r.topics?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {r.topics.map((t) => (
                  <span
                    key={t}
                    className="text-[11px] px-2 py-0.5 rounded-full"
                    style={{
                      background: "var(--purple)" + "1a",
                      color: "var(--purple)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Summary / pending-extraction placeholder */}
            {r.summary ? (
              <p className="text-sm text-[var(--text)] leading-relaxed">
                {r.summary}
              </p>
            ) : (
              <p className="text-sm italic text-[var(--text-muted)]">
                Summary coming soon — transcript not yet processed.
              </p>
            )}

            {/* Metrics — concrete numbers/stats mentioned in this segment */}
            {r.metrics?.length > 0 && (
              <dl className="mt-3 grid gap-1.5 text-sm">
                {r.metrics.map((m, i) => (
                  <div key={i} className="flex flex-wrap gap-2 items-baseline">
                    <dt
                      className="font-mono text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "var(--teal)" + "1a", color: "var(--teal)" }}
                    >
                      {m.metric.replace(/_/g, " ")}
                    </dt>
                    <dd className="font-semibold">{m.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <a
              href={r.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-xs px-2.5 py-1.5 border border-[var(--border)] rounded-lg hover:bg-[var(--bg3)]"
            >
              Watch on YouTube ↗
            </a>
          </div>
        );
      })}
    </div>
  );
}
