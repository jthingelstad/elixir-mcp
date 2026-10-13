# 2026-10-13 — Native release acceptance reads

The Web Functions cutover's full live gate ran 829 cases over 536 distinct
read-only calls. Three checks failed: the live donation comparison reused a
roster from an earlier poll, a historical timeline read exceeded its 15-second
ceiling, and the docs audit required fields of private or attested timeline
items that the acceptance principal's natural window did not hold.

Gym 304.1 now refreshes both answers before comparing them. Its arguments,
sum assertion and negative control remain; a scratch regression proves that
an old cached poll is replaced and an unequal current total still fails.
The docs allowances name the conditional feedback and award fields and their
scratch tests. No production feedback answer or award is manufactured.

The budget read passed isolated at 14,086 and 14,011 ms after its 18,333 ms
failure. The ceiling is unchanged; engineering issue #576 tracks this narrow
latency defect. There is no known-failure exemption.

This changes the release harness only. MCP 11.13.0 and JSON API 3.2.0 are
unchanged; the native runtime remains the deployed one.
