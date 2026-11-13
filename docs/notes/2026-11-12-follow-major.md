# 2026-11-12 — Follow, never track: the MCP major (12.0.0)

Jamie, 2026-11-12, approved the MCP major of DECISIONS "Follow, never
track" and "Agents read the social layer and never write it, save a
follow the person asks for". No aliases and no deprecation window: a
renamed or retired tool is gone from `tools/list` at once, and its name is
banned from declarations by `services/mcp/test/tool-conventions.test.mjs`.

## Renamed (arguments and results unchanged)

| Before | Now |
| --- | --- |
| `elixir_track_player` | `elixir_follow_player` |
| `elixir_track_clan` | `elixir_follow_clan` |
| `players_timeline` | `players_series` |
| `clans_timeline` | `clans_series` |
| `clans_members_timeline` | `clans_members_series` |

The OAuth scope `recordings:write` keeps its key and reads "Change who you
follow"; `account:write` is nicknames only now.

## Retired or folded

- `elixir_identify`: an agent no longer writes a map. `on_behalf_of:
  "discord:<id>"` resolves through the person's Discord link; otherwise
  the `no_subject` hint says to ask and pass `player_tag` (one name
  candidate: pass that tag), and adds the Discord link for a `discord:`
  id or none. Mappings already made still resolve (`via:
  "agent_mapping"`), and `elixir_my_identities` still lists them.
- `clans_context`: agents read `clans_directory`. Its grant storage and
  the operator's op stay; no migration.
- `battles_trends`: `battles_performance` takes an optional `segment`
  (`"mine"`, `{player_tag}` or `{clan_tag}`) and answers `weeks[]` as the
  old tool did: the twelve-week default and 52-week cap, `mode`, the
  window arguments. With `segment` it refuses `player_tag`, `group_by`
  other than week, `last_n_battles` and `before_after` (`bad_request`). It
  keeps the analytical query budget, now decided per call
  (`analyticalCall` in `packages/tools/src/invoker.mjs`).
- `elixir_data_insights`: its numbers stay public at `/api/public/stats`
  and on the site's `/data`. Gym finding 217, about it, is pruned.

## Four reads

`players_follows`, `players_highlights`, `clans_directory` and
`elixir_cheers`, read-only. They are in `AGENT_ONLY_TOOLS` (a person's
own connection and agents, hidden from integrations), and each handler
refuses an integration, and an agent whose owner is not approved, with
`not_entitled` (`socialReaderOrRefuse`). An agent reads as its owner.
Listed counts: person 46, agent 45, integration 36.

- `players_follows`: `player_tag`, `name`, `badges`, `follows`,
  `followers` (`socialOf`, the player page's own read), defaulting to the
  reader's primary; `not_found` for an unrecorded tag.
- `players_highlights`: `highlights[]` of `id`, `at`, `text`, `words`,
  `battle_url`; `limit` 1 to 30, default 10.
- `elixir_cheers`: the items about the reader's primary player in a
  window (days 1 to 30, default 7; from/to or season, at most 35 days),
  rebuilt as a feed shows them; counts by kind from everyone but the
  reader, only items with a cheer, `total`. Never who.
- `clans_directory`: the clan directory's tiles and the policy's public
  part, `yours` as the owner.

## The JSON API, 3.6.0

A minor: `GET /api/v1/players/{tag}/follows`, `/players/{tag}/highlights`,
`/me/cheers` and `/clans/directory`, person OAuth `cr:read`, each
`x-tool` its tool. The mirrored renamed tools keep their paths and
operation ids. poapkings.com and Drop call none of the changed operations.

Ships as MCP 12.0.0 and JSON API 3.6.0. No migration.
