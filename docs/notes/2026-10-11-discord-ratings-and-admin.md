# 2026-10-11 — Discord ratings and Admin ▸ Discord

The third of four changes for Jamie's "judge the quality of those
without having any access or visibility to the client discord server"
(2026-10-11; after `2026-10-11-discord-quality-ledger.md` and
`2026-10-11-discord-readback.md`).

- **Ratings are feedback.** Each delivered post on the three delivery
  lists (a timeline's Discord panel; Clan's Actions ▸ Discord and Social
  ▸ Discord) has 👍 and 👎 and an optional note (1,000 characters). A
  rating is a feedback item (one system, 0204) with a `discord_post` ref
  to the ledger row, filed by `rateDiscordPost`
  (`packages/feedback`): area `console` for a timeline, `clan` for the
  two clan features; category `praise` for 👍 and `general` for 👎;
  context `{rating, feature, action, outcome, clan, noted}`. A second
  rating follows the first (`follows_id`) and the latest stands.
- **Scope is checked before the write.** A timeline's post is the
  filer's own or one of their agents' (`POST
  /api/me/timeline/discord/rate`, agent-scoped like the GET); a clan's
  is the clan's, for that feature, rated by a leader or co-leader
  (`POST /api/clan/<tag>/discord/rate` and `.../activity-discord/rate`).
  Anything else is `not_found`. Each list returns the reader's own
  ratings (`ratings`, by ledger id); another leader's are not shown.
- **`discord_post` is a page-only ref kind** (`FEEDBACK_PAGE_REF_KINDS`
  in contracts): `cleanRefs` still drops it from an MCP or `/api/v1`
  filing, and only `rateDiscordPost` adds it, after the scope check. So
  `elixir_send_feedback`'s enum and the OpenAPI are unchanged: no
  contract bump. 0223 adds the kind to `feedback_ref`'s check (drop and
  add NOT VALID); 0224 validates.
- **Jamie is notified of a 👎 or a note only**; a bare 👍 is counted, not
  announced.
- **Admin ▸ Discord** (`GET /api/admin/discord?days=`, `GET
  /api/admin/discord/<tag or account id>`), admins only: per feature
  over 1 to 90 days, the clans' model runs, and the destinations with the
  most refused, lost or deleted first; a destination's page has its last
  50 rows whole, each with its ratings and a link to the feedback item,
  and a clan's last 20 runs with every refusal.
  `packages/syndication/src/quality-report.mjs` is the one reader, for
  the page and for the op that follows.
- **Read-back asked once** (0225, Codex on #513): a candidate stayed
  eligible until its read's receipt arrived, so two deliveries queued
  before it could both ask Discord for the same message. `read_asked_at`
  is now set as the candidate is taken (`update ... for update skip
  locked returning`), and a post asked once is never asked again,
  answered or not.

MCP and JSON API unchanged.
