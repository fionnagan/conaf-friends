"use client";

import { useRef, useState, useEffect } from "react";
import type { Guest } from "@/lib/types";
import FriendshipArc from "./FriendshipArc";

export default function LazyArc({ guest }: { guest: Guest }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ minHeight: 120 }}>
      {mounted && <FriendshipArc guest={guest} />}
    </div>
  );
}
