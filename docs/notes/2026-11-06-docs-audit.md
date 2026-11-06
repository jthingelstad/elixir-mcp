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

- `docs/product/structure.md` put Invite clanmates in Home's empty state too.
  Home's first steps end the moment a read names the clan, so it would never be
  seen; the record now says Clan's Spread the word and Ladder's Season.
- `Standing.jsx` read `you.inactivity.at_risk_days`, and the service sent a
  string in that place, so the callout never showed the number. Fixed: the
  service sends `at_risk_days` beside it.
- `timeline-tool.md` names `account_role_changed`; the code has
  `account_tier_changed`.

**Read by sweep only, not line by line:** architecture, connecting,
connect-a-client, clocks, decks-and-war, battles, reading-the-numbers,
responses, protocol, glossary, archetypes, inactivity-clock, clan-discord and
about. The milestones' numeric rules are not confirmed.
