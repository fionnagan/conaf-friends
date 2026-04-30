import { getGuestsData } from "@/lib/data";
import ArcListClient from "@/components/ArcListClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Friendship Arcs — The Friend Registry",
  description: "Every guest's friendship arc with Conan O'Brien, from 1993 to today.",
};

export default function ArcPage() {
  const data = getGuestsData();

  if (data.guests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <p className="font-serif text-2xl font-semibold mb-3">No arcs yet</p>
        <p className="text-[var(--text-muted)]">
          Run <code className="font-mono">npm run ingest</code> to populate data.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold mb-2">
        Friendship Arcs
      </h1>
      <p className="text-[var(--text-muted)] mb-8">
        Every guest&apos;s relationship with Conan, plotted across 30+ years.
        Sorted by friendship score.
      </p>

      <ArcListClient guests={data.guests} />
    </div>
  );
}
