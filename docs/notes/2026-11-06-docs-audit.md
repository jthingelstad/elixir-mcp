# 2026-11-06 — Public docs read against the code

The redesign moved Home, Ladder, Clan's five tabs, Settings, search, the help
drawer and mail by reader. Nobody had read `apps/site/src/docs/` against the
result. This change does that and fixes the page wherever the code disagreed,
about 75 claims over 27 pages. `privacy` and `terms` were not touched, and
`timeline` and `timeline-tool` were left for the split in progress.

**The method.** Each priority page read line by line against its view or
handler, then a sweep of the rest: every bold phrase and backticked identifier
in the docs grepped against the code, so a button or tool that no longer exists
shows up.

**One code change.** `ClaimNotice` still said "Tracking" and "make it primary";
it now says Players & tracking and "your main player", as Settings does. Its
test moved with it.

**Found, not changed:**

- `docs/product/structure.md` puts Invite clanmates in Clan, Members and Home's
  empty state; `BringClanmates` is only on Ladder's Season tab. The doc page now
  says what the code does. The brief wins or moves: Jamie's call.
- `Standing.jsx` reads `you.inactivity.at_risk_days`, and the service sends a
  string in that place, so the callout says "from its at-risk day" and never
  shows the number.
- `timeline-tool.md` names `account_role_changed`; the code has
  `account_tier_changed`.

**Read by sweep only, not line by line:** architecture, connecting,
connect-a-client, clocks, decks-and-war, battles, reading-the-numbers,
responses, protocol, glossary, archetypes, inactivity-clock, clan-discord and
about. The milestones' numeric rules are not confirmed.
