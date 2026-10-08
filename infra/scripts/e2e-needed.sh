#!/bin/sh
# Does this change need the browser journeys (npm run e2e)? Reads changed
# paths on stdin, one per line, and prints `true` or `false`.
#
# The journeys serve the built site and app tree with /api/* answered by
# fixtures, so only what lands in that tree, or builds and serves it, can
# break them. Doc pages and the updates feed are checked by verify's site
# build; services, migrations, infra and the MCP tools never reach the
# browser. validate runs the journeys on every push to main regardless.
#
#   git diff --name-only origin/main...HEAD | sh infra/scripts/e2e-needed.sh

set -u

if grep -E \
  -e '^apps/web/' \
  -e '^packages/(ui|client|design|clan-web|clan-engine|contracts|record)/' \
  -e '^infra/scripts/(build-site|serve-site)\.mjs$' \
  -e '^package(-lock)?\.json$' \
  -e '^\.github/workflows/validate\.yml$' \
  -e '^apps/site/' |
  grep -vE \
    -e '^apps/site/src/docs/[^/]+\.md$' \
    -e '^apps/site/src/_data/updates\.js$' \
    -e '^apps/site/test/' \
    -e '\.md$' |
  grep -q .; then
  echo true
else
  echo false
fi
