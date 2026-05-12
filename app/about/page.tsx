import type { Metadata } from "next";
import { getGuestsData } from "@/lib/data";

export const metadata: Metadata = {
  title: "About | The Friend Registry",
  description: "About this fan-made archive of Conan O'Brien's friendships.",
};

export default function AboutPage() {
  const data = getGuestsData();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold mb-2">About this project</h1>
      <p className="text-[var(--text-muted)] mb-8 text-lg">
        A fan-made archive of every friendship Conan O&apos;Brien has formed across
        30+ years of television and podcasting.
      </p>

      <div className="prose">
        <h2>What is The Friend Registry?</h2>
        <p>
          This is an unofficial, fan-made website that maps the relationships
          between Conan O&apos;Brien and every guest who has appeared on his shows,
          from <em>Late Night with Conan O&apos;Brien</em> (1993–2009) through{" "}
          <em>The Tonight Show</em>, <em>Conan</em> on TBS, the podcast{" "}
          <em>Conan O&apos;Brien Needs a Friend</em>, and <em>Conan Must Go</em>.
        </p>

        <h2>The Friendship Score</h2>
        <p>
          Every guest receives a Friendship Score between 35 and 100, calculated
          from five factors: number of appearances, cold open sentiment, origin
          depth, visit type, and gap resilience. The score is entirely fan-made
          and affectionate, it is designed to celebrate every guest, not rank
          them critically. The lowest tier is still &ldquo;Honored Guest&rdquo; because
          every Conan guest deserves that dignity.
        </p>
        <p>
          A tooltip on every score reads: &ldquo;A fan-made score, made with love ♥&rdquo;
         , because that&apos;s exactly what it is.
        </p>

        <h2>Data sources</h2>
        <ul>
          <li>
            <strong>Podcast episodes:</strong> The official{" "}
            <em>Conan O&apos;Brien Needs a Friend</em> RSS feed via{" "}
            <a href="https://feeds.simplecast.com/dHoohVNH" target="_blank" rel="noopener noreferrer">
              Simplecast
            </a>. Cold open phrases parsed directly from episode descriptions.
          </li>
          <li>
            <strong>Late night history:</strong> Wikipedia episode lists and
            IMDb guest credits for each of Conan&apos;s shows. This data is
            incomplete, especially for early years (1993–2000), gaps are marked
            as unknown rather than fabricated.
          </li>
          <li>
            <strong>Guest photos:</strong> Wikipedia&apos;s pageimage API.
          </li>
          <li>
            <strong>YouTube videos:</strong> Team Coco&apos;s official YouTube
            channel via YouTube Data API v3. Only official embeds are used,
            no downloading or ad-stripping.
          </li>
          <li>
            <strong>Guest origins:</strong> A combination of Wikipedia bio
            scraping and a hardcoded ruleset based on publicly available
            information about Conan&apos;s career history.
          </li>
        </ul>

        <h2>Accuracy and gaps</h2>
        <p>
          Late-night guest data is notoriously sparse on the open web, especially
          for pre-2010 episodes. Where data is missing or uncertain, this site
          marks it as &ldquo;unknown&rdquo; or &ldquo;inferred&rdquo; rather than inventing data.
          If you spot an error, please open an issue on GitHub.
        </p>

        <h2>Respecting Team Coco</h2>
        <p>
          All audio and video playback uses official Team Coco sources, the
          Simplecast-hosted audio stream and YouTube IFrame embeds. This
          preserves ads, view counts, and revenue for Team Coco. This site
          does not download, mirror, or re-host any content.
        </p>

        <h2>Disclaimer</h2>
        <p>
          This is an unofficial fan project, not affiliated with Conan O&apos;Brien,
          Team Coco, Earwolf, SiriusXM, or any other entity. All trademarks and
          copyrights belong to their respective owners. This site exists purely
          to celebrate a beloved podcast and its host.
        </p>
      </div>

      {/* Stats */}
      {data.guests.length > 0 && (
        <div className="mt-10 p-6 bg-[var(--bg2)] rounded-2xl border border-[var(--border)]">
          <h2 className="font-serif text-xl font-semibold mb-4">Registry stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-center">
            <div>
              <div className="font-serif text-3xl font-bold text-[var(--orange)]">
                {data.totalGuests}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Total guests</div>
            </div>
            <div>
              <div className="font-serif text-3xl font-bold text-[var(--purple)]">
                {data.totalAppearances}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Total appearances</div>
            </div>
            <div>
              <div className="font-serif text-3xl font-bold text-[var(--teal)]">
                {data.guests.filter((g) => g.appearances.some((a) => a.coldOpenWord)).length}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Cold opens found</div>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] text-center mt-4">
            Data generated: {new Date(data.generatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
