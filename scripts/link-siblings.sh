#!/usr/bin/env bash
# Links the sibling repositories a worktree reads as ../<repo> (#457):
# ../cr-agent-api-docs for every deploy's vocabulary import and for
# reference-audit, ../drop.poapkings.com for `npm run cr`. Each git
# repository beside the main checkout that the worktree's parent lacks
# is symlinked there. Idempotent: an existing entry of that name, a real
# directory, a file or any link, is left exactly as it is, so the domain's
# session-start (which places them first) and a second run change nothing.
#
#   scripts/link-siblings.sh <main-checkout> <worktree>
#
# scripts/worktree-setup.sh runs it; services/mcp/test/link-siblings.test.mjs
# pins it.
set -euo pipefail

source_tree=$(cd "${1:?link-siblings: the main checkout}" && pwd -P)
worktree=$(cd "${2:?link-siblings: the worktree}" && pwd -P)
from=$(dirname "$source_tree")
to=$(dirname "$worktree")
self=$(basename "$source_tree")

# A worktree beside the main checkout already has its siblings; the root
# directory is never a place to put links.
if [ "$from" = "$to" ] || [ "$to" = "/" ]; then
  exit 0
fi

linked=0
for sibling in "$from"/*/; do
  sibling=${sibling%/}
  name=$(basename "$sibling")
  [ "$name" = "$self" ] && continue
  [ "$name" = "$(basename "$worktree")" ] && continue
  # Repositories only: a .git directory, or the file a linked worktree has.
  [ -e "$sibling/.git" ] || continue
  if [ -e "$to/$name" ] || [ -L "$to/$name" ]; then
    continue
  fi
  ln -s "$sibling" "$to/$name"
  linked=$((linked + 1))
done
if [ "$linked" -gt 0 ]; then
  echo "link-siblings: linked $linked sibling repositor$([ "$linked" -eq 1 ] && echo y || echo ies) into $to"
fi
