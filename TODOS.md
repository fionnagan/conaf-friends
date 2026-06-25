# TODOS

## NEXT PRIORITY

### P3: Dead/unavailable YouTube embed fallback for SOTU tracker page

**What:** Add an `onError` fallback on the embedded YouTube iframes in the State of
the Podcast tracker page (T3, see design doc `fi-verified-guest-data-design-20260624-134856.md`)
showing "Video unavailable" plus a link to the original YouTube URL, instead of a
broken/blank iframe.

**Why:** The tracker spans 2022-2026 today and will keep growing. YouTube clips get
taken down, made private, or region-locked over multi-year spans. Surfaced during
`/plan-design-review` (Issue 3A) — deliberately deferred since none of the 7 known
clips are dead today, but it will eventually happen and a silent broken box erodes
trust in the page.

**Pros:** Prevents a silent failure mode; cheap to add once needed (a single
`onError` handler + fallback markup).
**Cons:** Not urgent — no currently-broken embed to fix.

**Context / where to start:** The page (T3) renders one `<iframe>` per SOTU record
from `data/sotu-records.json`. Add an error boundary or `onError` on the iframe
wrapper that swaps to a "Video unavailable — [watch on YouTube](source_url)" message.

**Depends on / blocked by:** T3 (the page itself) must exist first.
