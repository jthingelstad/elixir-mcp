# 2026-11-14 — Small cleanups after the pivot

Leftovers from before Elixir became the social layer, each checked
against the code first.

- **Mail source "Ladder" reads "Stats".** `MAIL_SOURCE` in
  `packages/mail/src/shell.mjs` labelled the Arena week and milestone
  mails "Ladder", and the Emails page keyed its chip icon on that word.
  The label is worked out when a mail or the page is drawn, never
  stored, so it changes with the surface's name. "ladder" stays where it
  is the Trophy Road mode, a docs slug or the stored feedback area.
- **The `fetch_points` line in DECISIONS** says what the database holds
  now: migration 0266 dropped `gateway.fetch_points`.
- **The `retire_app` op is gone.** It existed to remove Clan's old
  family OAuth client. A read of `{family_clients: {list: true}}` on
  2026-11-14 shows only Drop's provisioned client, so the job is done and
  the op could only answer `already_removed`. The op, its retirement
  tests and its catalogue row go. Two tests stay, in
  `services/migrate/test/family-clients.test.mjs`: provisioning still
  refuses `clan`, and an expired registration's live token stops working
  while Drop's keeps working. Drop's client and every other sub-op are
  untouched.
- **`WebApiEmailComposeFailedFilter` is gone from the stack.** Nothing
  logs `email_compose_failed` in the web-api: its one writer, the JSON
  API's clan mail door, went in JSON API 4.0.0, and Clan's mail composes
  in the jobs Lambda. The jobs filter (`EmailComposeFailedFilter`) still
  writes `ElixirMCP/Email` `ComposeFailed`, which otto-ops' hourly check
  and Grafana read. No alarm or IAM change. A template change: it rides
  the platform lane on the next deploy.
- **Usage and Following say what the Roles page says** for the clan
  rows ("Clans you follow, the clan only", "Clans you follow, every
  member"), and Usage for the budgets ("Tool calls a day", "Live CR
  fetches a day"). No limit, role or reading changed. The player row
  keeps its wording ("Player slots used" on Usage, "Players" on
  Following): the number is slots spent, which leaves out the players
  you follow for free, so "Players you follow" would say something
  different.
- **Acceptance allowances:** five per-tool entries in
  `acceptance/catalogue-allow.json` came out (`war_history`
  `end_of_day_rank`; `battles_performance` `net_trophies`, `week_of`,
  `trophy_battles`, `trophy_mode_battles`). A committed bite of the same
  tool carries each as a key, which the docs and notes checks accept
  since 2026-11-14. Shared (`*`, `docs`) entries stay: they apply to
  every tool, and no bite can show them covered for all of them.
- **The MCP request log masks `/a/<id>` only.** The `/i/` case went
  with the integration door; no `/i/` route, CloudFront behaviour or
  OAuth resource remains.

Kept: `POST /api/explore`, the alias of `POST /api/me/tool`. It went
live at 12:41Z (6:41 AM CT) today, the app does not reload on a new
build, and a tab loaded before that deploy would get a 404 on the
Record tab, Find and the nickname editor until it was reloaded.

No MCP contract, JSON API or migration change.
