"use client";

import { useRouter } from "next/navigation";

interface Props {
  /** Originating URL (validated relative path). Null → fall back to homepage. */
  from: string | null;
}

export default function GuestBackButton({ from }: Props) {
  const router = useRouter();

  function handleBack() {
    if (from) {
      router.push(from);
    } else {
      router.push("/");
    }
  }

  return (
    <button
      onClick={handleBack}
      className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-6"
    >
      ← Back
    </button>
  );
}
