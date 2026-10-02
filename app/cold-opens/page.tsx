import { Suspense } from "react";
import { getGuestsData, resolveEpisode } from "@/lib/data";
import ColdOpensClient, { type ColdOpen } from "@/components/ColdOpensClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cold Open Archive | The Friend Registry",
  description:
    'Every "I feel ___ about being Conan O\'Brien\'s friend" moment, catalogued.',
};

export default function ColdOpensPage() {
  const data = getGuestsData();

  // Group every cold-open appearance by episode — a multi-guest episode
  // (e.g. "Matthew McConaughey & Woody Harrelson") shares one video/audio/
  // artwork, so it renders as one card listing every guest's own cold open
  // word instead of one near-identical card per guest.
  const byEpisode = new Map<string, ColdOpen>();
  for (const g of data.guests) {
    for (const a of g.appearances) {
      if (!a.coldOpenWord) continue;
      const episode = resolveEpisode(a, data.episodes);
      // No shared episode to group by (shouldn't happen for a podcast cold
      // open, but fall back to a per-guest key rather than dropping it).
      const key = episode?.id ?? `${g.id}::${a.date}`;

      const entry = byEpisode.get(key);
      const guestEntry = {
        id: g.id,
        name: g.name,
        photoUrl: g.photoUrl,
        word: a.coldOpenWord.replace(/"/g, ''),
        sentiment: a.coldOpenSentiment,
      };
      if (entry) {
        entry.guests.push(guestEntry);
      } else {
        byEpisode.set(key, {
          episodeId: key,
          date: a.date,
          episodeTitle: episode?.title,
          episodeUrl: episode?.url,
          audioUrl: episode?.audioUrl,
          youtubeVideoId: episode?.youtubeVideoId,
          artworkUrl: episode?.artworkUrl,
          guests: [guestEntry],
        });
      }
    }
  }

  const coldOpens = Array.from(byEpisode.values());

  // Sort by date descending
  coldOpens.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold mb-2">
        Cold Open Archive
      </h1>
      <p className="text-lg text-[var(--text-muted)] mb-2">
        Every guest&apos;s unique answer to the question: I feel _____ about
        being Conan O&apos;Brien&apos;s friend.
      </p>
      <p className="text-sm text-[var(--text-muted)] mb-8">
        {coldOpens.reduce((n, co) => n + co.guests.length, 0)} cold opens catalogued
      </p>

      {coldOpens.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-serif text-2xl font-semibold mb-3">
            The archive is empty
          </p>
          <p className="text-[var(--text-muted)]">
            Run <code className="font-mono">npm run ingest</code> to populate data.
          </p>
        </div>
      ) : (
        <Suspense>
          <ColdOpensClient coldOpens={coldOpens} />
        </Suspense>
      )}
    </div>
  );
}
