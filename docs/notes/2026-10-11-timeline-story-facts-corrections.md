# 2026-10-11 — Sitting details: partial teammates and a month's cost (11.11.1)

MCP 11.11.1. JSON API 3.2.0 unchanged. No migration.

- **Codex P2 on #482:** a sitting that mixed solo games with one 2v2
  game read "played 20 battles in one sitting with Bea in 2v2". When
  `teammate.battles` is less than the sitting's battles, the text now
  says "20 battles in one sitting, 1 of them with Bea in 2v2".
- **Acceptance latency (deploy of 11.11.0):** `catalogue/elixir_timeline#2`,
  a month-long roster read of a member, took 18.3 s against a 15 s
  ceiling (p95 11.6 s). `explain_timeline` over the same month for the
  home clan put `clan.sitting_details` at 3.2 s: it joined `player` for
  every other participant of every game in every standout. It now reads
  only the other participants of the sitting's wins and same-side
  partners, without names, and reads the names of the few players the
  details name in one statement after.
- **Acceptance docs audit:** `left_at` (departure_classified's optional
  detail) is documented and appears only when a leader classified a
  departure with its time, so a quiet week failed the audit. It is in
  `acceptance/catalogue-allow.json` with that reason; the clan tests
  pin it. Not caused by 11.11.0; fixed the day it was seen.
