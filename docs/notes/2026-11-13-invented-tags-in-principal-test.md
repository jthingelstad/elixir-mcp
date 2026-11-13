# 2026-11-13 — Invented tags in the principal-surface test

`services/mcp/test/principal-surface.test.mjs` named three real player
tags for its invented identities (Plum Heron, Jolly Stoat, Crisp Marten).
They are replaced by invented tags; the test checks only the text of the
initialization block, so nothing else moves. This repository is public
and many players are minors: test files use made-up tags, and the only
real ones a test may name are King Thing and POAP KINGS.

Not changed: `acceptance/catalogue.json`. It is the week's real call
catalogue, replayed against production, and each case must answer
(`answered` in `acceptance/lib.mjs` fails a refusal), which needs a
recorded player; an invented tag would be refused as not recorded.
