"use client";
import { useReducedMotion } from "framer-motion";

/**
 * Returns transition/animation props that respect prefers-reduced-motion.
 * When reduced motion is preferred:
 *   - duration is cut to near-zero (instant)
 *   - no spring physics
 *   - no stagger delays
 */
export function useMotionConfig() {
  const reduced = useReducedMotion();
  return {
    reduced: !!reduced,
    transition: reduced
      ? { duration: 0.01 }
      : undefined,
    /** Wrap a full Framer transition object — zeroes it out if reduced */
    t: (full: object) => (reduced ? { duration: 0.01 } : full),
    /** Stagger delay — zero if reduced */
    stagger: (i: number, ms: number) => (reduced ? 0 : i * ms),
  };
}
