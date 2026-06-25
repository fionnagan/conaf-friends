import { Suspense } from "react";
import fs from "fs";
import path from "path";
import AskAboutSOTU from "@/components/AskAboutSOTU";
import SOTUTrackerClient from "@/components/SOTUTrackerClient";
import type { Metadata } from "next";
import type { SOTURecord } from "@/lib/types";

export const metadata: Metadata = {
  title: "State of the Podcast | The Friend Registry",
  description:
    "How Conan, Sona & Matt have talked about the show's trajectory, 2022 to today.",
};

function getSotuRecords(): SOTURecord[] {
  try {
    const filePath = path.join(process.cwd(), "data", "sotu-records.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SOTURecord[];
  } catch {
    return [];
  }
}

export default function SOTUPage() {
  const records = getSotuRecords().sort(
    (a, b) => new Date(b.air_date).getTime() - new Date(a.air_date).getTime()
  );

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold mb-2">
        State of the Podcast
      </h1>
      <p className="text-lg text-[var(--text-muted)] mb-2">
        How Conan, Sona &amp; Matt have talked about the show&apos;s trajectory,
        2022 to today.
      </p>
      <p className="text-sm text-[var(--text-muted)] mb-8">
        A few times a year, the show pauses for a check-in modeled on a
        presidential State of the Union — sometimes posted as a full episode,
        sometimes as a standalone clip.
      </p>

      <AskAboutSOTU />

      {records.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-serif text-2xl font-semibold mb-3">
            No segments logged yet
          </p>
          <p className="text-[var(--text-muted)]">
            Run the SOTU ingest script to populate{" "}
            <code className="font-mono">data/sotu-records.json</code>.
          </p>
        </div>
      ) : (
        <Suspense>
          <SOTUTrackerClient records={records} />
        </Suspense>
      )}
    </div>
  );
}
