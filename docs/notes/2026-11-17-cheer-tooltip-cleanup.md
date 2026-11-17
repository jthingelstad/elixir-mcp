# 2026-11-17 — Keep cheer tooltip timers inside the mounted control

The first CI pass for the accepted development-risk exception exposed an
unhandled React update after jsdom teardown, despite all 1,061 web
assertions passing. A touch long press scheduled the name's delayed hide;
the synthetic click then cleared the press record holding that timer.
Unmounting could no longer cancel it.

The delayed hide has its own timer reference, canceled when the control
unmounts. The existing press behavior, appearance and 1.2-second name
hold remain unchanged. A deterministic fake-timer regression reproduces
the long-press, lift, synthetic click and unmount sequence and fails when
the timer survives. The CI failure is fixed at the control that owns the
timer; no retry or test suppression is added.

MCP and JSON API versions and the schema are unchanged. This lifecycle
repair has no new player-facing behavior or What's new entry.
