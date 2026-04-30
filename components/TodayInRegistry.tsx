"use client";

import Link from "next/link";
import type { Guest } from "@/lib/types";
import GuestAvatar from "./GuestAvatar";

interface Props {
  guests: Guest[];
}

export default function TodayInRegistry({ guests }: Props) {
  if (guests.length === 0) return null;
  const guest = guests[0];

  return (
    <div className="bg-[var(--orange)] text-white px-4 py-2 text-sm">
      <div className="max-w-7xl mx-auto flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
          Today in the Registry
        </span>
        <span>·</span>
        <Link
          href={`/guest/${guest.id}`}
          className="flex items-center gap-2 hover:underline"
        >
          <GuestAvatar name={guest.name} photoUrl={guest.photoUrl} size={20} />
          <span className="font-medium">{guest.name}</span>
          <span className="opacity-75 text-xs">
            appeared on this day in history
          </span>
        </Link>
        {guests.length > 1 && (
          <span className="text-xs opacity-75">+ {guests.length - 1} more</span>
        )}
      </div>
    </div>
  );
}
