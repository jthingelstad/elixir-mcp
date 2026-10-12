# 2026-10-12 — Elixir Clan: the role is read again after the roster freshness check

MCP and JSON API unchanged. No migration. Deployed with no acceptance
family: nothing a tool serves changed.

Codex on #519 (P1): the handler read the person's role through the gate
first, and the roster freshness check (`role-freshness.mjs`) after. A
roster read admitted between the two would make the check pass while
the handler still held the role from before it, so a leader removed or
demoted by that very read could make one more change. The window is the
few milliseconds between two reads in one request, and it is real on
the path where the live ask finds a read already in hand.

After `confirmRole` passes, the handler now runs the gate again
(`clanContext`) and acts on that role: a member is refused by the
service's role check, someone no longer in the clan by the gate, an
unverified player as before. It is one more `/api/v1/me` read, on leader
mutations only. `packages/clan/test/role-freshness.test.mjs` pins it with
a roster admission that lands during the freshness read.
