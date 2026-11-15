#!/bin/sh
# The workflow lint: holds every workflow in .github/workflows to this
# repository's rules (validate.yml's header states them; #447 rewrote
# this check for them):
#
#   pinned        every `uses:` names a full 40-character commit SHA (a
#                 local ./action is exempt); Dependabot moves the pins
#   permissions   the file sets `permissions: {}` at the top, and every
#                 job asks for its own `permissions:`
#   checkout      every actions/checkout step sets
#                 `persist-credentials: false`, so no token is left in
#                 .git/config for a later step
#   trigger       no `pull_request_target`: a fork's code never runs with
#                 this repository's token
#   gate          validate.yml has the job `validate`, named `validate`
#                 (the main ruleset's one required check and
#                 lib/ci-gate.mjs's lookup), which runs `if: always()`
#                 and needs every other job in the file, so no job can
#                 fail without failing the check
#
# Exit 0 when every rule holds, 1 when any fails (each failure names the
# file, the rule and the lines). The validate workflow runs it; run it
# after touching .github/workflows/. An argument points it at another
# directory, which is how services/mcp/test/test-workflows.test.mjs
# proves each rule still fails on a violation.
#
#   sh infra/scripts/test-workflows.sh [workflow-dir]

set -u
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
dir="${1:-$here/../../.github/workflows}"

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "ok   - $1"; }
fail() {
  failed=$((failed + 1))
  echo "FAIL - $1"
  [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/       /'
}
check() { # check <label> <findings>: no findings is a pass
  if [ -z "$2" ]; then pass "$1"; else fail "$1" "$2"; fi
}
# awk whose own failure is a finding: a check that could not run must
# never read as a pass.
lint() {
  out="$(awk "$@" 2>&1)"
  status=$?
  printf '%s' "$out"
  [ "$status" -eq 0 ] || printf '\nthe check itself failed to run (awk exit %s)' "$status"
}

files="$(find "$dir" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)"
if [ -z "$files" ]; then
  fail "workflows: $dir holds at least one workflow" "none found"
  echo
  echo "$passed passed, $failed failed"
  exit 1
fi

for f in $files; do
  n="$(basename "$f")"

  # pinned: the value after uses:, quotes stripped, is ./local or ref@<40 hex>.
  check "$n: every action is pinned to a commit SHA" "$(lint '
    /^[ \t]*(- )?uses:/ {
      v = $0
      sub(/^[ \t]*(- )?uses:[ \t]*/, "", v)
      sub(/[ \t]+#.*$/, "", v)
      gsub(/["\047]/, "", v)
      if (v ~ /^\.\//) next
      at = index(v, "@"); sha = substr(v, at + 1)
      if (at > 1 && length(sha) == 40 && sha !~ /[^0-9a-f]/) next
      printf "line %d: %s\n", NR, v
    }' "$f")"

  check "$n: no default token permissions" "$(grep -qE '^permissions:[ \t]*\{\}[ \t]*(#.*)?$' "$f" ||
    echo "want a top-level 'permissions: {}'")"

  # Jobs are the two-space keys under the top-level jobs: map; a job's own
  # keys sit at four spaces.
  check "$n: every job sets its own permissions" "$(lint '
    function close_job() { if (job != "" && !has) printf "job %s has no permissions:\n", job }
    /^[^ \t#]/ { if (injobs) close_job(); injobs = ($0 ~ /^jobs:/); job = ""; next }
    injobs && /^  [A-Za-z0-9_-]+:[ \t]*(#.*)?$/ {
      close_job(); job = $1; sub(/:$/, "", job); has = 0; next
    }
    injobs && /^    permissions:/ { has = 1 }
    END { if (injobs) close_job() }' "$f")"

  # A step runs from its "- " line to the next line at that indent or less.
  check "$n: no checkout persists the token" "$(lint '
    function indent(s) { match(s, /^ */); return RLENGTH }
    function close_step() {
      if (checkout && !kept) printf "line %d: actions/checkout without persist-credentials: false\n", at
      instep = 0; checkout = 0; kept = 0
    }
    /^[ \t]*$/ || /^[ \t]*#/ { next }
    {
      i = indent($0)
      if (instep && i <= step) close_step()
      if ($0 ~ /^ *- /) { instep = 1; step = i; at = NR; checkout = 0; kept = 0 }
      if (instep && $0 ~ /uses:[ \t]*["\047]?actions\/checkout@/) checkout = 1
      if (instep && $0 ~ /persist-credentials:[ \t]*false/) kept = 1
    }
    END { if (instep) close_step() }' "$f")"

  check "$n: no pull_request_target trigger" "$(grep -nE '(^|[^A-Za-z_])pull_request_target([^A-Za-z_]|$)' "$f")"
done

# gate: the required check's job, in validate.yml.
v="$dir/validate.yml"
if [ ! -f "$v" ]; then
  fail "gate: validate.yml exists" "the required check 'validate' needs its workflow"
else
  check "gate: validate.yml's validate job is the required check" "$(lint '
    function close_job() {
      if (job == "") return
      jobs[++count] = job
      if (job == "validate") { found = 1; vname = name; valways = always; vneeds = needs }
    }
    /^[^ \t#]/ { if (injobs) close_job(); injobs = ($0 ~ /^jobs:/); job = ""; next }
    injobs && /^  [A-Za-z0-9_-]+:[ \t]*(#.*)?$/ {
      close_job(); job = $1; sub(/:$/, "", job)
      name = ""; always = 0; needs = " "; inneeds = 0; next
    }
    injobs && job != "" {
      if (inneeds && $0 ~ /^      - /) { x = $0; sub(/^ *- */, "", x); sub(/[ \t]*(#.*)?$/, "", x); needs = needs x " "; next }
      inneeds = 0
      if ($0 ~ /^    name:/) { name = $0; sub(/^    name:[ \t]*/, "", name); gsub(/["\047]/, "", name); sub(/[ \t]+#.*$/, "", name) }
      if ($0 ~ /^    if:[ \t]*(\$\{\{[ \t]*)?always\(\)/) always = 1
      if ($0 ~ /^    needs:[ \t]*\[/) {
        x = $0; sub(/^    needs:[ \t]*\[/, "", x); sub(/\].*$/, "", x); gsub(/[ \t]/, "", x)
        k = split(x, parts, ","); for (j = 1; j <= k; j++) needs = needs parts[j] " "
      } else if ($0 ~ /^    needs:[ \t]*(#.*)?$/) inneeds = 1
      else if ($0 ~ /^    needs:[ \t]*[A-Za-z0-9_-]+/) { x = $0; sub(/^    needs:[ \t]*/, "", x); sub(/[ \t]*(#.*)?$/, "", x); needs = needs x " " }
    }
    END {
      if (injobs) close_job()
      if (!found) { print "no job named validate"; exit }
      if (vname != "validate") printf "the validate job is named \"%s\", want \"validate\"\n", vname
      if (!valways) print "the validate job needs if: always(), or a failed job skips it and a skipped check passes"
      for (j = 1; j <= count; j++)
        if (jobs[j] != "validate" && index(vneeds, " " jobs[j] " ") == 0)
          printf "the validate job does not need %s\n", jobs[j]
    }' "$v")"
fi

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
