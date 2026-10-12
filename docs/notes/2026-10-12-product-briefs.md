# 2026-10-12 — Product briefs: a page per surface between VISION and the ledger

MCP and JSON API unchanged. No migration. Documentation only; nothing
deploys.

Jamie asked how Elixir could be managed differently: too many detailed
questions arrive mid-build, cold, and the answers conflict; the ledger
records point rulings without the reasoning that connects them to
`VISION.md`; and a change in one package can move another surface
unnoticed. The plan is in the domain repository
(`../plans/elixir-product-management-2026-10-12.md`). This is its first
step.

`docs/product/` holds one brief per surface: record, accounts, agents,
console, timeline, mail, ladder, clan, integrations, collectors. A brief
says what the surface is for, who it serves, the principles that decide
its details, and what it never does. `docs/product/README.md` carries the
conventions: a ratified sentence is tagged `[Jamie, date]`, a drafted one
`[proposed]` until Jamie ratifies the page, an `[engineering]` default is
changeable with evidence; open questions stay on the page under "Open";
a session lists its product questions in a design note with the brief's
answer before building; a mid-build default is taken, tagged and listed
in the pull request.

The briefs were drafted from the public docs, the ledger and the area
guides, then settled in one sitting with Jamie: twenty-three questions in
six rounds, each answered where the record could not settle it. The
rulings are on the pages with Jamie's tag, and the ledger lines they
change are rewritten or added in this pull request: accounts read the
record and one battle page is public; history is kept for what someone
tracks and a year after, and the maintainer's `ops` reason retires;
removing an account deletes the account, not the record; tiers are earned
in the game (Leader with a verified leadership, Family with a collector,
Partner Jamie-granted); email is the identity and Discord may become a
way in; a removal says what it rests on and what it cannot see (beside the
same day's battle-log ruling, which already replaced the 2026-10-04 hold
and #426); Clan sees one clan at a time; Clan's
Discord posts and the family's Discord agent converses; the timeline is
the spine of delivery and every mail is a digest of its items; Elixir
funds no model use; a person's own web reads are unmetered; Explore is a
power-user corner; collector enrollment is open and the admission checks
are the trust; running a collector earns the Family tier and the points
economy retires; no deprecation window. `VISION.md` links the briefs.

Each ruling that changes code or a public doc is an `engineering` issue
filed from this pull request, not work done here.
