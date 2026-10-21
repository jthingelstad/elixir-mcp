# 2026-10-20 — Ladder: the first hour of a season says why there is no same point

A wording fix to "This season vs last" (#606), from a Codex review
finding on `apps/web/src/ladder/Form.jsx`. No contract change: MCP
11.13.1 and JSON API 3.2.0.

In a season's first hour `samePointWindow` cuts no same point (it cuts
to the whole hour). A player with ten decided battles by then saw the
same-point column disappear under the generic foot, "All of <last> ran
N days.", with no reason given, though #606's note says the foot says
why. The foot now has its own sentence for the first hour: "This season
is not yet an hour old, so <last> to the same point is not shown: it is
set beside this season from its first whole hour. All of <last> ran N
days." The generic sentence is left only for a season whose start is
not known.

The public docs (`apps/site/src/docs/ladder.md`) do not describe the
first hour, so they are unchanged. A journey in
`apps/web/e2e/ladder.spec.ts` pins the sentence 40 minutes into Season
136, with last season read whole and no same-point read.
