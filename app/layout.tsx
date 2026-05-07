import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import StickyPlayer from "@/components/StickyPlayer";
import { PlayerProvider } from "@/lib/PlayerContext";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: "The Friend Registry — A Conan O'Brien Friendship Archive",
  description:
    "A fan-made archive mapping Conan O'Brien's friendships across every era of his career. Unofficial fan project.",
  openGraph: {
    title: "The Friend Registry",
    description: "A fan-made archive of Conan O'Brien's friendships",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PlayerProvider>
          <Nav />
          <main className="min-h-screen pt-16">{children}</main>
          <StickyPlayer />
          <footer className="border-t border-[var(--border)] py-6 px-6 text-center text-sm text-[var(--text-muted)]">
            <p>
              Unofficial fan project — not affiliated with Team Coco or Conan O&apos;Brien.{" "}
              <a
                href="https://www.teamcoco.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--orange)]"
              >
                Support the real show &rarr;
              </a>
            </p>
            <p className="mt-1">Made with love by a fan. Data from public sources.</p>
          </footer>
        </PlayerProvider>
        <Analytics />
      </body>
    </html>
  );
}
