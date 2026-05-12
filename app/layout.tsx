import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import StickyPlayer from "@/components/StickyPlayer";
import { PlayerProvider } from "@/lib/PlayerContext";

export const metadata: Metadata = {
  title: "The Friend Registry | A Conan O'Brien Friendship Archive",
  description:
    "A fan-made archive mapping Conan O'Brien's friendships across every era of his career. Unofficial fan project.",
  icons: {
    icon: "/conan_hi.png",
    apple: "/conan_hi.png",
  },
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
              Built by a fan with 🧡 &middot;{" "}
              Data from the{" "}
              <a
                href="https://feeds.simplecast.com/dHoohVNH"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--orange)]"
              >
                Conan O&apos;Brien Needs a Friend RSS feed
              </a>
              {" "}&middot; Not affiliated with Team Coco or Earwolf.
            </p>
          </footer>
        </PlayerProvider>
      </body>
    </html>
  );
}
