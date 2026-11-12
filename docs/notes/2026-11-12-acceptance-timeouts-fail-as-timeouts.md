# 2026-11-12 — Acceptance: a timeout fails as a timeout

Gym 215.2 failed three times on 2026-11-12 with "notes_match ... no note
says it" and passed when run alone. The tool was right every time it
answered: each capture of 215.2's read that day carries the war-ledger
note. The failures were two harness defects meeting slow
`elixir_timeline` reads.

- **The door gave up before the server did.** `acceptance/door.mjs`
  aborted a call at 20 s, a bound set on 2026-09-26 "above the 18 s
  analytical budget". Only the four budgeted tools stop at 18 s. Every
  other read-only tool, `elixir_timeline` included, races the MCP
  function's deadline, its 25 s kill less 1.5 s, and answers
  `query_timeout` with a request id. At 13:14Z the server answered 215.2's
  read in 22.4 s, with the note, and the suite had already thrown it away.
  The door now waits 30 s (`DOOR_TIMEOUT_MS`), past the kill, and a test
  reads `TimeoutSeconds` from `infra/template.yaml` and fails if the door
  stops first. A call the door abandons answers `request_timeout`, no
  longer the `rpc_error` a protocol refusal answers.
- **A timeout was read as the answer.** A Gym block whose asserts use a
  notes verb takes a refusal as its body on purpose, so it can assert on
  a refusal's words. A timeout fell through the same path. On that body
  215.2's `when` (the count of `entries[...].war.resolved[]` is 0) held
  over the absent list, and the notes verb then found no note. At 13:18Z
  the server's own `query_timeout` (23.3 s) failed the case the same way.
  A timeout (`query_timeout`, `timeout`, `request_timeout`) now fails
  every Gym case, single or multi-call, as `refused <code>`, whatever the
  case asserts. Other refusals still reach the notes verbs.
- A FAIL line now prints the case's wall time. A failure had no duration
  before, because only a case that returned reported one.

The same morning's deploy gate failed 119.1, 163.1, 168.2 and 303.3 on
two `elixir_timeline` reads that hit `query_timeout` at 23-24 s. The
first three share one cached read. They already failed as timeouts. The
cause under all five is the slow month-long and week-long timeline reads
of engineering issue #649. This change does not fix #649. It makes the
failure name the timeout, and it keeps answers that arrive between 20 and
24 s. There is no retry and no known-failure entry.

This changes the release harness only. MCP 11.20.1 is unchanged.
