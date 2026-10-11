# 2026-10-11 — Elixir Clan chooses the model for each use

Jamie, 2026-10-11: "we currently allow the model to be set as a property
of the anthropic api key and we should change that. The model is our
selection based on how the product should work. The key and its budget
are the external decisions. We should focus on the 5.5 models." Jamie
confirmed the mapping the same day.

## What shipped

- `MODEL_FOR` in `packages/clan-engine/src/words.mjs` is the one
  constant: `recruit_pitch`, `leader_message` and `clan_chat` take
  `claude-opus-5-5`, then `claude-sonnet-5-5`, then `claude-haiku-5-5`;
  `discord_activity` takes `claude-sonnet-5-5`, then `claude-opus-5-5`,
  then `claude-haiku-5-5`. `modelFor(purpose, ids)` takes the first the
  key's stored list reaches (the first, for an empty list), or null.
  `MODEL_PREFERENCE` and `chooseModel` are gone.
- `manage/model.mjs`: a use resolves its model before the reservation
  and refuses `model_unavailable` (409) when nothing is reachable,
  before any spend. The unattended activity rewrite returns
  `model_unavailable`, and the channel posts Elixir's own line. A 404
  drops that model from the stored list and marks the list due, so the
  next use takes the next model. Adding a key that reaches no 5.5 model
  is refused `no_models`. The status and summary carry `model_for`
  (`{ purpose: { id, name } | null }`) in place of `model`, `models` and
  `model_listed`.
- The leader's choice is retired: `PUT /model` with a `model` and no key
  answers 410 `model_choice_retired`; a `model` sent beside a key is
  ignored. A `model` saved in a key item before today is left there and
  never read; no migration.
- Each use record keeps the model it actually ran on, as before
  (`r.model` from Anthropic, else the one asked for).
- `anthropic.mjs`: Opus 5.5 answers a 400 to a forced `tool_choice` and
  always thinks, with the thinking counted in `max_tokens`. The request
  now offers the tool with `tool_choice: auto` (no parallel calls), a
  system line that asks for one call of it, and `THINKING_ROOM` (4096)
  added to `max_tokens`. Nothing model-specific is sent, so Sonnet 5.5
  and Haiku 5.5 take the same request.
- Settings shows each use with its model, read-only, and says Elixir
  Clan chooses it; Recruit names the pitch's model; the activity page
  names the rewrite's. The key, who added it, the spend and the cap
  stay.

## Not verified

The request shape for Opus 5.5 follows Anthropic's model guide; it has
not been sent to the live API from here (no live writes). The first
real draft on a clan's key is the check. `claude-sonnet-5-5` is listed by
the keys and priced in `prices.mjs`.

## Versions

Clan only (`/api/clan`). MCP 11.10.1 and JSON API 3.2.0 unchanged; no
migration.
