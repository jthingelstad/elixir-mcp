# 2026-10-13 — Clan: a leader's own view shows no removal Action, Jamie's ruling (#535)

`docs/notes/2026-10-13-w3-my-clan-view.md` left one question open with
Jamie: whether a leader's own connection should see, in `clans_my_view`,
the removal Actions waiting for them to decide. Jamie answered on #535 on
2026-10-13: "no, it should not".

That is what MCP 11.12.0 already does: `clans_my_view` shows no removal
Action to anyone, a leader or co-leader who would decide it included, and
a leader's answer always carries the note that some Actions are shown only
in Clan. `docs/DECISIONS.md` gives the ruling a line of its own ("Your own
Clan view shows no removal Action, a leader's included"), and the line for
the person's own view no longer carries the no-removal part as an
engineering default waiting on the question.

No behaviour, contract or public docs change: the public page
(`/docs/clan-policy#your-own-view`) and the tool description already state
the rule plainly. MCP 11.13.0; JSON API 3.2.0 unchanged.
