# 2026-10-20 — A demotion's own words drop "Keep playing"

Jamie: "Approved: reword Elixir's own demotion message to drop "Keep
playing"".

`leaderMessage("demotion")` in `packages/clan-engine/src/render.mjs` said
`<name> moves from Elder back to Member for now. Keep playing and it can come back.` Since the draft redesign (#609) those are ELIXIR'S PLAIN
WORDS, the floor every "Draft in our voice" draft must say at least, while
the demotion ASK forbids any hint at why (nothing about lately, being
quiet or inactivity). "Keep playing" is such a hint, so the floor pushed
drafts to break the rule. The message now reads
`<name> moves from Elder back to Member for now, and Elder can come back.`, which matches what the
model is told happened (`context.mjs`).

- The clan-chat line (`inGameCopy`) already said "It can come back." and
  is unchanged.
- Pinned by a test in `packages/clan-engine/test/render.test.mjs` that
  holds the exact words and refuses "keep playing", "lately", "quiet" and
  activity words.
- Views only: MCP 11.13.1 and JSON API 3.2.0, unchanged; no acceptance
  family.
