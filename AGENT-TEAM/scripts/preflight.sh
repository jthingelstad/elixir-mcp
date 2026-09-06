#!/usr/bin/env bash
#
# Objective-run preflight: verifies the checkout is safe to act on and
# prints a live health snapshot. Non-zero exit = stop and report; an
# automated run must never pull, rebase, stash, or act on unexpected
# local state.
set -euo pipefail

cd "$(dirname "$0")/../.."

command -v git >/dev/null || { echo "git not found"; exit 2; }
command -v node >/dev/null || { echo "node not found"; exit 2; }

verdict=0

if ! git fetch origin --prune >/dev/null 2>&1; then
  echo "✗ git fetch failed — remote sync unknown; stop mutation."
  exit 1
fi

branch="$(git symbolic-ref --quiet --short HEAD || true)"
echo "==> Preflight on branch: ${branch:-DETACHED}"
git status --short --branch | sed 's/^/  /'

[ "$branch" = "main" ] || { echo "  ✗ objective runs publish only from main."; verdict=1; }
[ -z "$(git status --porcelain)" ] || { echo "  ✗ worktree is DIRTY — stop mutation."; verdict=1; }

counts="$(git rev-list --left-right --count main...origin/main 2>/dev/null || echo '? ?')"
ahead="${counts%%	*}"; behind="${counts##*	}"
if [ "$behind" != "0" ]; then echo "  ✗ main is BEHIND origin/main by $behind — stop mutation."; verdict=1; fi
if [ "$ahead" != "0" ]; then echo "  ✗ main is AHEAD of origin/main by $ahead (unpublished commits) — stop mutation."; verdict=1; fi

lease="$(node AGENT-TEAM/scripts/objective-lease.mjs status)"
if [ "$lease" != "null" ]; then
  echo "  ✗ checkout lease is HELD: $lease"
  verdict=1
else
  echo "  ✓ checkout lease free"
fi

echo "==> Live snapshot"
if snapshot="$(curl -sf --max-time 10 https://elixir.poapkings.com/api/public/status)"; then
  echo "$snapshot" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      const s = JSON.parse(d);
      const h = s.health ?? {};
      console.log(`  health ok=${h.ok} last_admission=${h.last_admission_seconds}s battles_1h=${h.battles_last_hour} dlq=${h.dlq_messages} capture_24h=${JSON.stringify(h.capture_audit_24h)}`);
    });
  '
else
  echo "  ✗ public status endpoint unreachable — investigate before anything else."
  verdict=1
fi

if [ "$verdict" -ne 0 ]; then
  echo "==> PREFLIGHT FAILED — report, do not mutate."
  exit 1
fi
echo "==> Preflight clean."
