"use client";

import Image from "next/image";
import { getInitials, getAvatarColor } from "@/lib/data";

interface Props {
  name: string;
  photoUrl: string | null;
  size?: number;
  className?: string;
}

export default function GuestAvatar({ name, photoUrl, size = 48, className = "" }: Props) {
  const initials = getInitials(name);
  const color = getAvatarColor(name);

  if (photoUrl) {
    return (
      <div
        className={`relative rounded-full overflow-hidden flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <Image
          src={photoUrl}
          alt={name}
          fill
          className="object-cover"
          onError={(e) => {
            // Fallback to initials if image fails
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.innerHTML = `<div style="width:${size}px;height:${size}px;background:${color};display:flex;align-items:center;justify-content:center;border-radius:50%;color:white;font-weight:600;font-size:${Math.round(size * 0.35)}px">${initials}</div>`;
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.35),
      }}
    >
      {initials}
    </div>
  );
}
