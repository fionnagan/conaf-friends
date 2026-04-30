import { getGuestsData } from "@/lib/data";
import ColdOpensClient from "@/components/ColdOpensClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cold Open Archive — The Friend Registry",
  description:
    'Every "I feel ___ about being Conan O\'Brien\'s friend" moment, catalogued.',
};

export default function ColdOpensPage() {
  const data = getGuestsData();

  // Build flat list of all cold opens
  const coldOpens = data.guests.flatMap((g) =>
    g.appearances
      .filter((a) => a.coldOpenWord)
      .map((a) => ({
        guestId: g.id,
        guestName: g.name,
        guestPhotoUrl: g.photoUrl,
        word: a.coldOpenWord!.replace(/"/g, ''),
        sentiment: a.coldOpenSentiment,
        date: a.date,
        episodeTitle: a.episodeTitle,
        episodeUrl: a.episodeUrl,
        audioUrl: a.audioUrl,
        youtubeVideoId: a.youtubeVideoId,
        artworkUrl: a.artworkUrl,
      }))
  );

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
        {coldOpens.length} cold opens catalogued
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
        <ColdOpensClient coldOpens={coldOpens} />
      )}
    </div>
  );
}
