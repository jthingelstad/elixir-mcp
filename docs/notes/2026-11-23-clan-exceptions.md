# 2026-11-23 — Member exceptions replace holds

Jamie, 2026-11-23: Clan's holds become **member exceptions**, named
overrides a leader sets on one member so the rules leave them alone in one
way, until a date.

## What changed

- **Kinds** (`packages/clan-engine/src/exceptions.mjs`): `keep_in_clan`
  (no kick), `keep_as_elder` (Elders only: out of the Elder band, so a kept
  Elder takes none of the earned seats, blocks no promotion and is not
  ranked for demotion), `not_for_elder` (Members only: never suggested for
  promotion and out of the band) and `away` (the member's own, within the
  policy's `away_max_days`, or a leader's for them; always clan-visible).
- **Every exception ends.** Lengths 1w, 2w, 1m, 3m or a date, at most 365
  days from when it is set or changed. `exceptionActiveAt` treats a record
  with no end date as protecting nothing.
- **Visibility** is `leaders` or `clan`. Leaders-only ones reach only the
  Leader and Co-Leaders: not the member, MCP or any public surface.
  Members see a clan-visible one's kind and end, never its why or setter.
- **One record per stretch**, at most one running per kind per member:
  `exception_id`, `player_tag`, `kind`, `visibility`, `until`, `note`,
  `set_by`/`set_by_name`/`set_at`, `changed_*`, `ended_*`, and `events`
  (added, changed, ended). Ran out is derived at read time; nothing is
  written when an end date passes. Records are kept after they end.
- **The engine** takes `exceptions` (not `holds`) and counts each one at
  each weekly review it was running at, so a new exception never rewrites
  past reviews. The band reports `kept_elders`; members carry
  `exceptions`, `ranked_for_elder` and `excepted` on promotion and
  demotion. `removal_evidence_schema` is 6.
- **Ledger:** `exception#<clan>#<id>` items in `clan_state`, listed by
  member (`gsi1sk exception#<tag>#<set_at>#<id>`). The `hold#` methods are
  gone.
- **Routes** (`packages/clan/src/handler.mjs`): `GET /exceptions`,
  `GET /members/<tag>/exceptions`, `PUT|DELETE
  /members/<tag>/exceptions/<kind>`. `/me/away` stays the member's own
  Away. The GETs take no lock; the writes need a fresh roster like every
  leader mutation.
- **Web:** Run › Exceptions (`views/RunExceptions.jsx`: set by leaders,
  automatic, add), the member sheet's Exceptions (`components/Exceptions.jsx`),
  chips on Review and on Members for clan-visible ones, the member's own
  lines on Standing and You here, Decided's latest exception events, and
  Away reading `away`. Events `clan.exception_set`,
  `clan.exception_changed`, `clan.exception_ended` replace
  `clan.hold_set`.

## Migration 0318

Copies every `hold#<clan>#<tag>` into `exception#<clan>#hold-<tag
without #>`:

| Hold | Exception |
| --- | --- |
| kind `away` | `away`, visibility `clan` |
| kind `leader`, or none | `keep_in_clan`, visibility `leaders` |
| `until` | the same |
| no `until` | now + 90 days, with a `changed` event (by null, `migration: "0318"`) |
| `note`, or an older `reason` | `note` |
| `by`, `by_name`, `set_at` | `set_by`, `set_by_name`, `set_at` and the `added` event |

The hold's whole body rides along as `hold`, with `migrated_from` and
`migrated_at`. Past-due holds are copied too; an end date further off than
a year is kept as written. `on conflict do nothing`, so a re-run copies
nothing. Expand and contract: the `hold#` items stay; the contract
migration that deletes them first copies any written after `migrated_at`.

## For the member history page

Read exception events from either:

- `GET /api/clan/clans/<tag>/history` (leaders): `exception_events`,
  newest first, each named (`player_name`, `by_name`); or
- `GET /api/clan/clans/<tag>/members/<player>/exceptions`: `events`,
  oldest first; non-leaders get only clan-visible ones, with `note`, `by`
  and `by_name` null.

Each event: `exception_id`, `player_tag`, `kind`, `event` (added,
changed, ended, expired), `at`, `by`, `by_name`, `until`, `visibility`,
`note`, and `migration: "0318"` on the migration's end date.
`eventLine(e)` in `apps/web/src/clan/components/Exceptions.jsx` gives the
line ("Keep as Elder added by Ada", "Keep in clan ran out").
