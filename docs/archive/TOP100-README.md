> **ARCHIVED 2026-09-25** — Jamie's pre-build handoff bundle for the Top 100 mail ("nothing here is implemented yet"), reviewed against the record and built 2026-09-18. Superseded by `docs/EMAIL.md` (`top_100`) and <https://elixir.poapkings.com/docs/email>. The writer prompt it lists stays at `docs/top100/generator-prompt.md` (a runtime prompt); the brief schema, sample brief and gold issue are in `services/editor/fixtures/`. Moved from `docs/top100/README.md`.

# Elixir Weekly — handoff bundle

A weekly newsletter about the global Path of Legends top 100, generated from
Elixir MCP data. Funded as marketing spend: one shared edition to all
recipients, so generation cost is amortized across the whole list.

This bundle is a design handoff. Nothing here is implemented yet.

## Files

| File | What it is |
|---|---|
| `SPEC.md` | Product and editorial spec. Read first. |
| `generator-prompt.md` | The writer prompt. Takes a brief, returns an issue. |
| `brief.schema.json` | JSON Schema for the brief the collector must build. |
| `sample-brief.json` | Real data, 2026-09-18. Test fixture. |
| `sample-issue.md` | Hand-written reference issue from that brief. Gold standard. |

## The core architecture decision

**The collector computes, the model writes.**

Every delta, cluster, threshold and selection is calculated deterministically
in code and handed to the model as JSON. The model never does arithmetic on
tool output. It receives facts and produces prose.

This matters for two reasons: arithmetic on tool output is where hallucinated
numbers come from, and a newsletter that prints a wrong number about a named
player is a trust problem, not a bug.

The `numbers_used` field in the generator output is the enforcement mechanism.
Every numeric claim in the body ships with the dotted brief path it came from.
The collector re-resolves each path and compares before the issue queues for
send. A mismatch blocks the send.

## Build order

1. **Brief builder** — the real work. Maps Elixir tool calls to
   `brief.schema.json`. See "Tool mapping" below.
2. **Generator call** — feed `sample-brief.json` through
   `generator-prompt.md`, compare output to `sample-issue.md`.
3. **Validator** — resolve every `numbers_used` path, block on mismatch.
4. **Critic pass** — generate twice with different `deep_cut` candidates, third
   call picks the better issue against the novelty bar in the spec.
5. **Send** — list, template, unsubscribe. Out of scope for this bundle.

## Tool mapping

| Brief field | Elixir call |
|---|---|
| `board.top100` | `rankings_players(limit=100)` |
| `movers.*` | `rankings_players(as_of=<window start>, limit=200)`, diff by tag |
| `podium[].rank_from` | same as_of board |
| `podium[].deck_summary` | `battles_decks(player_tag, days=3, mode=ranked)` |
| `clans` | derive from `board.top100`, or `rankings_clans` |
| `meta.decks` | `battles_meta_decks(mode=ranked)` |
| `meta.hero_share` | `battles_meta_cards(mode=ranked)` — forms never merge |
| `meta.rising_card` | two `battles_meta_cards` windows, diff share |
| `deep_cut` (spike) | `rankings_timeline(player_tag, days=7)` |
| `deep_cut` (level gap) | `battles_levels` |
| `coverage` | `elixir_coverage`, `elixir_data_insights` |

Note: `rankings_players(as_of=YYYY-MM-DD)` resolves to the snapshot at end of
that local day. Confirm which snapshot you got — the response carries
`snapshot.observed_at`.

## Open questions for the Claude Code session

1. **Movers depth.** Diffing against a 200-deep as_of board leaves players who
   were below 200 as "entered" with no prior rank. Pull 500 instead, or accept
   the gap and label it?
2. **Deck data for the top 100.** Battle history only exists for recorded
   players. What share of the top 100 is recorded, and does the meta section
   need a "based on N of 100" line every issue? Probably yes.
3. **Send day.** The board snapshots at 10:00 UTC. Generating right after that
   gives the freshest data and lands mid-morning in Europe, early for the US.
4. **`deep_cut` rotation.** Track which type shipped in recent issues and
   exclude repeats, or let the novelty score decide alone?
5. **Personalization.** If a recipient's tag is known, render one deterministic
   line at the top from `players_summary`. Template merge, zero tokens. Keep
   the LLM out of it — per-recipient generation is where the economics break.

## Constraints that are not negotiable

- Names, never bare tags, in anything a reader sees.
- Rank delta and rating delta always appear together.
- No tier lists, no "play this deck" prescriptions.
- Neutral framing toward named players. They did not opt into coverage.
- Supercell fan content disclaimer in every issue footer.
