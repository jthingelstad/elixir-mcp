#!/bin/sh
# Does this change need the browser journeys (npm run e2e)? Reads changed
# paths on stdin, one per line, and prints `true` or `false`.
#
# The journeys serve the built site and app tree with /api/* answered by
# fixtures, so what lands in that tree, or builds and serves it, can break
# them. A few specs also import code outside the tree: native-ssr bundles
# services/web-api's app-pages.mjs with build.mjs's own options, and the
# mail and battle-activity specs render with packages/mail, the relay's
# templates and the web API's day shaping. Those files are named below.
# Doc pages and the updates feed are checked by verify's site build,
# except the pages a journey opens (quickstart). Everything else in
# services, migrations, infra and the MCP tools never reaches a journey.
# validate runs the journeys on every push to main regardless.
#
# services/mcp/test/ci-tooling.test.mjs holds this list to the specs: it
# bundles every spec (and every entry a spec bundles), and each repository
# file in that closure, and each doc page a journey opens, must answer
# `true` here. A wrong `false` silently skips the journeys on a pull
# request, so a new import that test reports belongs in this list.
#
#   git diff --name-only origin/main...HEAD | sh infra/scripts/e2e-needed.sh

set -u

paths=$(cat)

# What lands in the built tree, builds it or serves it, or a spec imports.
reaches_journeys() {
  printf '%s\n' "$paths" |
    grep -E \
      -e '^apps/web/' \
      -e '^packages/(ui|client|design|clan-web|clan-engine|contracts|record|mail|auth)/' \
      -e '^services/web-api/src/(app-pages|http|share-files)\.mjs$' \
      -e '^services/web-api/src/routes/battle-activity\.mjs$' \
      -e '^services/email-relay/src/templates\.mjs$' \
      -e '^infra/scripts/(build|build-site|serve-site)\.mjs$' \
      -e '^package(-lock)?\.json$' \
      -e '^\.node-version$' \
      -e '^\.github/workflows/validate\.yml$' \
      -e '^apps/site/' |
    grep -vE \
      -e '^apps/site/src/docs/[^/]+\.md$' \
      -e '^apps/site/src/_data/updates\.js$' \
      -e '^apps/site/test/' \
      -e '\.md$' |
    grep -q .
}

# The doc pages a journey opens, which the doc-page rule above leaves out.
opened_by_a_journey() {
  printf '%s\n' "$paths" | grep -qE -e '^apps/site/src/docs/quickstart\.md$'
}

if reaches_journeys || opened_by_a_journey; then
  echo true
else
  echo false
fi
