# 2026-11-14 — Jamie's 2026-11-14 wording rulings

Jamie ruled on five wording items and one mail item on 2026-11-14. This
change carries the wording; no code, data or contract moves.

- **Privacy** ("Yes on privacy."): the Game data paragraph said the
  Elixir family's own apps could add facts of their own (a best score in
  one of the apps), each naming its app. Nothing writes such facts since
  Drop only signs people in, so the page names Clan's facts alone (a
  clan's awards, a leader's note on why a member left), each saying
  where it came from. Stored `personal_record` rows and their timeline
  kind are untouched.
- **Family pages** ("Delete family site pages"): `apps/site/src/family.njk`
  and its data (`_data/family.js`, `_data/familyFlat.js`, read by nothing
  else), the `familyPath` filter, its lastmod rule and its `llms.txt`
  lines are gone. The two docs links to `/family/discord` point at
  Building an agent, where that page sent people. The sitemap lists
  collections, so it drops them with the pages. Following the site's
  convention for removed addresses (`/console`, `/ladder`; DECISIONS "A
  doc section answers at its own address only"), there is no redirect:
  the next deploy prunes the documents and `/family` answers the site's
  404. A site test pins that nothing is built at `/family` and nothing
  links there. `packages/ui/src/family.json` and `family.ts` (the chrome
  manifest) are not these pages and are untouched.
- **The record brief** ("Retention yes."): a dated banner says Elixir
  keeps a year from when a thing happened, followed or not.
- **Roles** ("Beta is fine."): "during the beta" stays. The partner line
  reads community-scale slots and budgets on MCP in place of full
  access to the API surface, and the quota rows say Players you follow
  and Clans you follow (the clan only, every member), which are the
  `player_slots`, `activity_clans` and `comprehensive_clans` limits in
  `packages/contracts/src/roles.ts`. Numbers unchanged.
- **Agents** ("Players should have one MCP endpoint. Clans have one too.
  That should be all we need."): Roles' "Three kinds of principal",
  which described two, is "Two kinds of principal" and names each one's
  endpoint; Users and agents' table gains the endpoint row; VISION's
  Agents section quotes the ruling. The code serves exactly two MCP
  door shapes (`packages/auth/src/oauth.mjs` `RESOURCE_PATH_RE`: `/mcp`
  and `/a/<public_id>/mcp`); what it still allows beyond the ruling's
  words is listed in the pull request for Jamie, not changed here.
- **Mail kinds** ("Remove those email kinds."): DECISIONS' Approval-era
  line said the `top_100` and `card_of_week` kind names stay, against
  the Ultimate Champions line's "their tombstones go too". The "stay"
  clause is marked superseded; the code change is another session's.

MCP and JSON API unchanged.
