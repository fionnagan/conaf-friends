#!/usr/bin/env bash
# commit-and-push.sh
# Shared by every ingest workflow that commits generated data files back to
# main (weekly-ingest.yml, backfill-booking-signals.yml) — previously each
# duplicated this same commit/rebase/push block verbatim, so a fix to one
# (like the rebase-before-push race fix in PR #31) had to be hand-applied to
# the other and was easy to miss.
#
# Assumes the caller has already run `git add` for whatever it wants
# committed. Takes the commit message as $1.
#
# Handles the race PR #31 found for real: another workflow (a one-off
# backfill, another PR) pushing to main in the window between this job's
# checkout and its own push, which turns a plain `git push` into a lost
# "fetch first" rejection. `git pull --rebase` alone survives that when the
# two changes don't touch the same lines — which is what actually happened
# in every race seen so far (different guests' fields). Retries a few times
# to ride out a genuinely fast-moving main (several backfills checkpoint
# every 50 guests now).
#
# What this does NOT attempt: resolving a REAL content conflict (both sides
# changed the same lines of the same generated JSON). There's no safe
# generic way to auto-merge that without silently picking a winner and
# dropping the other side's data — exactly the kind of fabricated-looking
# result this project's ingest pipeline is built to avoid. On a genuine
# conflict, this aborts the rebase cleanly and fails loudly so the run's
# data isn't half-applied, and it can be safely re-triggered.
#
# Usage: scripts/ci/commit-and-push.sh "commit message"
set -euo pipefail

COMMIT_MESSAGE="${1:?Usage: commit-and-push.sh \"commit message\"}"
MAX_ATTEMPTS=3

if git diff --staged --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "$COMMIT_MESSAGE"

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  if git pull --rebase origin main; then
    if git push; then
      exit 0
    fi
    echo "Push rejected after a clean rebase (attempt $attempt/$MAX_ATTEMPTS) — main moved again, retrying..."
    attempt=$((attempt + 1))
    continue
  fi

  # Rebase failed. Distinguish "still resolvable, try again" from "this is a
  # real content conflict" isn't reliable from the exit code alone, so:
  # abort cleanly, and only retry if attempts remain — a transient race
  # resolves on a later attempt once main settles; a real conflict fails
  # the same way every time, and the last attempt's failure is what surfaces.
  git rebase --abort 2>/dev/null || true
  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "::error::Rebase onto origin/main conflicted after $MAX_ATTEMPTS attempts — this run's data was NOT committed or pushed. This means another workflow changed the same lines of the same generated file in this window (a real content conflict, not just a race) — it needs a human or a re-run once main settles, not an automatic guess at which side wins. Re-trigger this workflow once the conflicting change has landed."
    exit 1
  fi
  echo "Rebase conflicted (attempt $attempt/$MAX_ATTEMPTS) — aborting and retrying against latest main..."
  attempt=$((attempt + 1))
done
