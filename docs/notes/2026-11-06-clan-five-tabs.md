# Clan's five tabs (redesign step 4)

The rail is replaced by `ClanHead` with kit `Tabs`, plus `SubNav` rows under
Today and Members and a section list under Run. One router still lives in
`apps/web`; `packages/clan-web/src/routes.jsx` adds the paths.

- **Redirects.** `lib/moved.js` (`clanMoved`) is the map, and `apps/web`'s
  `movedTo` consults it. `/clan/<tag>/actions/<n>` stays, because mail and
  Discord carry it.
- **Kit.** `Tabs` gains `countLabel`, so a count is read in words and an
  `aria-label` no longer hides the visible text (axe's
  label-content-name-mismatch).
- **Tests.** The Clan e2e specs were rewritten for the tabs; a new `clanTab`
  fixture finds a tab by name. Standing's "How it works here" now opens when a
  member arrives from Run: the prop was misnamed and e2e caught it.
- **Words.** Stories and in-game lines say Elixir or Clan, not "Elixir Clan".
  `week_resolved` uses figures ("1st place"). `chat.test.mjs` runs the rules
  announcement through the filter.
