import { Suspense } from "react";
import type { Metadata } from "next";
import { getGuestsData, getCrossedPathsData } from "@/lib/data";
import ExplorerClient from "@/components/ExplorerClient";

export const metadata: Metadata = {
  title: "Guest Explorer | The Friend Registry",
  description: "Browse every Conan guest — by profession, era, and generation — plus who's crossed paths with Conan but never been booked.",
};

export default function ExplorerPage() {
  const data = getGuestsData();
  const crossedPaths = getCrossedPathsData();

  if (data.guests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <p className="font-serif text-2xl font-semibold mb-3">No guests yet</p>
        <p className="text-[var(--text-muted)]">
          Run <code className="font-mono">npm run ingest</code> to populate data.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold mb-2">Guest Explorer</h1>
      <p className="text-[var(--text-muted)] mb-8">
        Every guest, filterable by profession, era, and generation — plus who&apos;s crossed paths
        with Conan himself but never actually been booked.
      </p>

      <Suspense>
        <ExplorerClient
          guests={data.guests}
          guestCrossings={crossedPaths.guestCrossings}
          neverBookedCandidates={crossedPaths.neverBookedCandidates}
        />
      </Suspense>
    </div>
  );
}
