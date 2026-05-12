"use client";

import { useEffect, useState } from "react";

interface Analytics {
  totalSubmissions: number;
  topCountry: { country: string; count: number } | null;
}

export default function TrendingPanel() {
  const [data, setData]       = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/i-feel/analytics")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-wrap gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flex-1 min-w-[120px] h-20 rounded-xl bg-[var(--bg2)] border border-[var(--border)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data || data.totalSubmissions === 0) return null;

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex-1 min-w-[120px] p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)] text-center">
        <p className="text-2xl font-serif font-semibold text-[var(--orange)]">
          {data.totalSubmissions.toLocaleString()}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1">Total feelings shared</p>
      </div>
      {data.topCountry && (
        <div className="flex-1 min-w-[120px] p-4 bg-[var(--bg2)] rounded-xl border border-[var(--border)] text-center">
          <p className="text-2xl font-serif font-semibold">{data.topCountry.country}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Most active country</p>
        </div>
      )}
    </div>
  );
}
