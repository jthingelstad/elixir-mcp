# 2026-11-23 — A player's page tells battles Elixir learned late

A player's page reads the seven days of battles they played
(`basis: "occurred"`). It showed nothing when every one of those battles
was a late capture, meaning a battle Elixir learned more than a day after
it was played (`battle_time < created_at - interval '1 day'`). Every
timeline read leaves late captures out, so a backfill is never told as
fresh play. That rule is right for a feed. It is wrong for a page that
asks what a player did. Tap Check for new battles on a player nobody
follows, and the log it lands holds a day or two of play that is already
a day or more old. Every battle in it was a late capture, so the page
stayed empty.

**What changed.** `buildTimeline` takes a new option, `lateBattles`
(default `false`). With it on, a player entry counts and narrates late
captures like any other battle. These queries switch:

- `playerBattlesSql`: the `wide` statement drops its
  `battle_time >= created_at - 1 day` line. The batched
  `prefetchStatements` change in the same way.
- `OWN_BATTLE_SQL` becomes the boat-defense test alone (`ownBattleSql`).
  This applies in `sittingAnchors` (the walk back to the anchor and the
  battle count that fingerprints a sitting) and in `readTimelineEvidence`'s
  session query.
- The late-capture count query is skipped, so `late_captures` is `0`.

A sitting's evidence source carries `late_battles: true`. Its games
therefore read the same battles the sitting counted, and the flag survives
`storedItem`/`restoredItem`. Without the option, every query is byte for
byte the SQL it was before. A script compared the old and new statements
for both bases.

**Who passes it.** The page sets it in `pageTimeline`, which serves the
page, the public session page and the games read. It also reaches the
story store's `buildSubjectStories`, which is "the player page's read", so
the shadow compare keeps matching. No other caller passes it:

- Home's batched prefetch
- MCP's `elixir_timeline`
- the bell
- mail and push
- the account page
- every clan entry

**Other kinds.**

- **`battle_session`:** told at its played time, with an id, revision,
  anchor and games that agree.
- **`returned` and `presence.returned_after_days`:** judged from timely
  battles only (`timelyOf`). A battle log keeps roughly the last 30
  battles, so the gap before a late batch may hide play Elixir never read.
  A return is never claimed from one. `quiet_crossed` and
  `last_battle_at` already read every battle.
- **Clan entries:** unchanged. This covers session crossings,
  `session_standout` and `sittingDetails`.
- **Ingest-written items:** none of these read the window, so none
  change. This covers deck switches, first wins, ledger crossings,
  week form, war weeks and promotions.

**Links that already exist.** In a sitting that mixes late and timely
games, the page reaches back further than a feed does, so the page's
anchor, and with it the id, can differ from the one a feed gave.

- `readSitting` looks in the page's read first. If the id is not there,
  it falls back to the feeds' read, so a session link from the Timeline
  still opens.
- `readRecordedItem` resolves cheers, comments and posts by `item_ref`. It
  reads as the feeds do first, then, for a player's sitting, as the page
  does.

**Story store.** `_evidence_source` gains `late_battles`, so a story row
the store already settled shows a one-time content change the next time
it is written.

Tests:

- `packages/tools/test/timeline-late-battles.test.mjs`
- two cases in `services/web-api/test/player-page.test.mjs`
