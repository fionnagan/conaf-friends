/**
 * booking-signal-schema.ts
 * Extraction rules for the fields both enrich-bios.ts (full pipeline, as
 * part of a larger structured-extraction call) and backfill-booking-
 * signals.ts (a fields-only call for guests enriched before these fields
 * existed) pull from a Wikipedia intro via Claude: birth_year, death_year,
 * gender, nationality, prestige_signals, primary_platform.
 *
 * Single-sourced after the rules had to be hand-copied and independently
 * patched in both files for the same bug: a real A/B test against
 * claude-haiku-4-5-20251001 fabricated death_year for 4 of 5 living guests,
 * and the resulting plausibility guardrail had to be written twice (once
 * per file) because neither the prompt text nor the validation logic was
 * shared. This constant is the shared source for the prompt text; the two
 * files still validate independently (enrich-bios.ts's validate() and
 * backfill-booking-signals.ts's inline check) since their surrounding
 * write/skip logic differs enough that unifying validation would obscure
 * more than it'd save — the prompt text was the actual duplication.
 */
// Shared by enrich-bios.ts's validate() and backfill-booking-signals.ts's
// inline check — previously each file had its own independently-written
// copy of this exact logic (added the same day, for the same real incident:
// a Haiku A/B test fabricated death_year for 4 of 5 living guests). Sharing
// the function itself means the two call sites literally cannot drift out
// of agreement, which a parity test alone wouldn't guarantee (a test only
// catches drift on its next run; a shared function makes drift impossible).
//
// Only catches STRUCTURALLY impossible combinations (no birth_year, death
// before/equal to birth, death in the future) — a numerically plausible but
// simply wrong death_year (correct birth_year, incorrect but in-range death
// year) can't be caught by validation alone; that's a real, documented
// limitation, not a gap in this function.
const YEAR_RE = /^\d{4}$/;

export function checkDeathYearPlausibility(
  birthYear: string,
  deathYear: string,
  currentYear: number = new Date().getFullYear()
): { ok: boolean; reason?: string } {
  if (!deathYear) return { ok: true };
  // A non-empty value that isn't a real 4-digit year is a schema-contract
  // violation, not "unknown" — Claude's own extraction prompt requires
  // exactly this format or an empty string. Without this check, garbage
  // input (e.g. a malformed response) would silently pass every comparison
  // below as "plausible", since NaN <= NaN and NaN > N both evaluate false —
  // defeating the guardrail's whole purpose.
  if (!YEAR_RE.test(deathYear)) return { ok: false, reason: `death_year_malformed:${deathYear}` };
  if (!birthYear) return { ok: false, reason: `death_year_without_birth_year:${deathYear}` };
  if (!YEAR_RE.test(birthYear)) return { ok: false, reason: `birth_year_malformed:${birthYear}` };
  const death = parseInt(deathYear);
  const birth = parseInt(birthYear);
  if (death <= birth) return { ok: false, reason: `death_year_before_birth_year:${birthYear}-${deathYear}` };
  if (death > currentYear) return { ok: false, reason: `death_year_in_future:${deathYear}` };
  return { ok: true };
}

export const BOOKING_SIGNAL_RULES = `- birth_year: 4-digit string from the intro's "(born ...)" clause, or "" if not stated
- death_year: 4-digit string if the intro states a death date (e.g. "(born X –
  died Y)" or "(1950–2020)"), or "" if the person is living or no date is stated
  — never infer from tense or context, only an explicit date
- gender: "male", "female", or "" — ONLY from pronouns the intro itself uses
  (he/him, she/her, they/them as a stated identity) — never inferred from name,
  profession, or photo; "" if the intro avoids pronouns or uses "they" generically
- nationality: the demonym Wikipedia's own opening sentence uses (e.g. "American",
  "British"), or "" if not stated — do not infer from name, accent, or any other cue
- prestige_signals: awards/honors explicitly named in the intro (e.g. "Emmy nominee",
  "Grammy winner"); empty array if none are mentioned — never infer prestige
- primary_platform: the ONE medium the intro emphasizes as their current work`;
