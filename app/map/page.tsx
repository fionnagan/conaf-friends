import { getGuestsData, getTodayAnniversaries } from "@/lib/data";
import MapView from "@/components/MapView";
import TodayInRegistry from "@/components/TodayInRegistry";

export default function MapPage() {
  const data = getGuestsData();
  const anniversaries = getTodayAnniversaries(data.guests);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {anniversaries.length > 0 && (
        <TodayInRegistry guests={anniversaries} />
      )}

      {data.guests.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-20">
          <div className="font-serif text-5xl mb-4">✦</div>
          <h2 className="font-serif text-3xl font-semibold mb-3">
            The constellation is empty
          </h2>
          <p className="text-[var(--text-muted)] max-w-md mb-6 leading-relaxed">
            No friends have been catalogued yet. Run the ingest pipeline to
            populate the registry with real data.
          </p>
          <code className="bg-[var(--bg2)] border border-[var(--border)] px-4 py-2 rounded-lg text-sm font-mono">
            npm run ingest
          </code>
          <p className="text-xs text-[var(--text-muted)] mt-4">
            Takes ~5–10 minutes. Requires a YouTube API key in{" "}
            <code className="font-mono">.env.local</code> (optional, works without it).
          </p>
        </div>
      ) : (
        <MapView guests={data.guests} />
      )}
    </div>
  );
}
