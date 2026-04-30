import { notFound } from "next/navigation";
import { getGuestsData, ORIGIN_LABELS, formatDate, TIER_COLORS } from "@/lib/data";
import GuestAvatar from "@/components/GuestAvatar";
import FriendshipBadge from "@/components/FriendshipBadge";
import FriendshipArc from "@/components/FriendshipArc";
import GuestPagePlayer from "@/components/GuestPagePlayer";
import type { Metadata } from "next";

interface Props {
  params: { id: string };
}

export async function generateStaticParams() {
  const data = getGuestsData();
  return data.guests.map((g) => ({ id: g.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = getGuestsData();
  const guest = data.guests.find((g) => g.id === params.id);
  if (!guest) return { title: "Guest not found" };
  return {
    title: `${guest.name} — The Friend Registry`,
    description: `${guest.name} is a ${guest.friendshipLabel} with a friendship score of ${guest.friendshipScore}/100.`,
  };
}

const FACTOR_LABELS = {
  appearances: "Total appearances",
  coldOpenSentiment: "Cold open sentiment",
  originDepth: "Origin depth",
  visitType: "Visit type",
  gapResilience: "Gap resilience",
};
const FACTOR_MAX = { appearances: 30, coldOpenSentiment: 25, originDepth: 20, visitType: 15, gapResilience: 10 };

export default function GuestPage({ params }: Props) {
  const data = getGuestsData();
  const guest = data.guests.find((g) => g.id === params.id);
  if (!guest) notFound();

  const relatedGuests = (guest.relatedGuests || [])
    .map((id) => data.guests.find((g) => g.id === id))
    .filter(Boolean);

  const tierColor = TIER_COLORS[guest.friendshipLabel];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {/* Back */}
      <a
        href="/"
        className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-6"
      >
        ← Back to Map
      </a>

      {/* Hero */}
      <div className="flex flex-col sm:flex-row gap-6 items-start mb-8">
        <GuestAvatar name={guest.name} photoUrl={guest.photoUrl} size={100} />
        <div className="flex-1">
          <h1 className="font-serif text-4xl font-semibold leading-tight mb-2">
            {guest.name}
          </h1>
          <div className="flex flex-wrap gap-2 items-center text-sm text-[var(--text-muted)] mb-4">
            <span>{ORIGIN_LABELS[guest.origin.type] || guest.origin.label}</span>
            <span className="text-[var(--border)]">·</span>
            <span>
              {guest.appearances.length} appearance
              {guest.appearances.length !== 1 ? "s" : ""}
            </span>
            <span className="text-[var(--border)]">·</span>
            <span>{[...new Set(guest.appearances.map((a) => a.era))].length} era(s)</span>
          </div>
          <FriendshipBadge
            score={guest.friendshipScore}
            label={guest.friendshipLabel}
            size="md"
          />
        </div>
      </div>

      {/* Bio */}
      {guest.bio?.description && (
        <section className="mb-8">
          <p className="text-[var(--text-muted)] leading-relaxed text-[15px]">
            {guest.bio.description}
          </p>
          {guest.bio.sources?.[0] && (
            <a
              href={guest.bio.sources[0]}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
            >
              Wikipedia ↗
            </a>
          )}
        </section>
      )}

      {/* Known for + Recent work */}
      {guest.bio && (guest.bio.known_for.length > 0 || guest.bio.recent_work.length > 0) && (
        <section className="mb-8 grid sm:grid-cols-2 gap-4">
          {guest.bio.known_for.length > 0 && (
            <div className="p-4 bg-[var(--bg2)] rounded-2xl border border-[var(--border)]">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                Known for
              </h3>
              <ul className="space-y-2">
                {guest.bio.known_for.map((w, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="text-sm font-medium leading-snug">{w.title}</span>
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {w.year && `${w.year} · `}{w.type}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {guest.bio.recent_work.length > 0 && (
            <div className="p-4 bg-[var(--bg2)] rounded-2xl border border-[var(--border)]">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                Recent work
              </h3>
              <ul className="space-y-2">
                {guest.bio.recent_work.map((w, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="text-sm font-medium leading-snug">{w.title}</span>
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {w.year && `${w.year} · `}{w.type}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* How Conan knows them */}
      <section className="mb-8 p-5 bg-[var(--bg2)] rounded-2xl border border-[var(--border)]">
        <h2 className="font-serif text-xl font-semibold mb-2">
          How Conan knows them
        </h2>
        {guest.bio?.conan_connection ? (
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            {guest.bio.conan_connection.evidence}
          </p>
        ) : (
          <>
            <p className="font-semibold text-[var(--text)]">{guest.origin.label}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Origin type: {ORIGIN_LABELS[guest.origin.type]} ·{" "}
              Confidence: <span className="capitalize">{guest.origin.confidence}</span>
            </p>
          </>
        )}
      </section>

      {/* Score breakdown */}
      <section className="mb-8 p-5 bg-[var(--bg2)] rounded-2xl border border-[var(--border)]">
        <h2 className="font-serif text-xl font-semibold mb-4">
          Friendship score breakdown
        </h2>
        <div className="space-y-3">
          {(Object.entries(guest.scoreBreakdown) as [keyof typeof FACTOR_LABELS, number][]).map(
            ([key, val]) => {
              const max = FACTOR_MAX[key];
              const pct = Math.round((val / max) * 100);
              return (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--text-muted)]">{FACTOR_LABELS[key]}</span>
                    <span className="font-semibold">
                      {val} / {max}
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: tierColor }}
                    />
                  </div>
                </div>
              );
            }
          )}
        </div>
        <p className="text-xs text-center text-[var(--text-muted)] mt-4">
          A fan-made score, made with love ♥
        </p>
      </section>

      {/* Friendship Arc */}
      <section className="mb-8">
        <h2 className="font-serif text-xl font-semibold mb-4">
          Friendship Arc (1993–present)
        </h2>
        <div className="bg-[var(--bg2)] rounded-2xl border border-[var(--border)] p-5 overflow-x-auto">
          <FriendshipArc guest={guest} />
        </div>
      </section>

      {/* Cold opens */}
      {guest.appearances.some((a) => a.coldOpenWord) && (
        <section className="mb-8">
          <h2 className="font-serif text-xl font-semibold mb-4">
            Cold open words
          </h2>
          <div className="flex flex-wrap gap-2">
            {guest.appearances
              .filter((a) => a.coldOpenWord)
              .map((a, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 bg-[var(--bg2)] border border-[var(--border)] rounded-full text-sm"
                  title={formatDate(a.date)}
                >
                  <span className="italic text-[var(--purple)]">&ldquo;{a.coldOpenWord}&rdquo;</span>
                  <span className="ml-1 text-xs text-[var(--text-muted)]">
                    {new Date(a.date).getFullYear()}
                  </span>
                </span>
              ))}
          </div>
        </section>
      )}

      {/* All appearances */}
      <section className="mb-8">
        <h2 className="font-serif text-xl font-semibold mb-4">
          All appearances
        </h2>
        <div className="space-y-3">
          {guest.appearances.map((app, i) => (
            <GuestPagePlayer key={i} appearance={app} guestName={guest.name} />
          ))}
        </div>
      </section>

      {/* Related guests */}
      {relatedGuests.length > 0 && (
        <section className="mb-8">
          <h2 className="font-serif text-xl font-semibold mb-4">
            Similar friends
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {relatedGuests.map((rg) => {
              if (!rg) return null;
              return (
                <a
                  key={rg.id}
                  href={`/guest/${rg.id}`}
                  className="guest-card flex items-center gap-3 p-3 bg-[var(--bg2)] rounded-xl border border-[var(--border)]"
                >
                  <GuestAvatar name={rg.name} photoUrl={rg.photoUrl} size={36} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{rg.name}</p>
                    <p
                      className="text-xs font-semibold"
                      style={{ color: TIER_COLORS[rg.friendshipLabel] }}
                    >
                      {rg.friendshipScore} · {rg.friendshipLabel}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
