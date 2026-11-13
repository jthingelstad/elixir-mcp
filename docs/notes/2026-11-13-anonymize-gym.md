# 2026-11-13 — The Gym names no player but King Thing

The Gym's blocks named about sixty other players and clans by tag, and a
few by name, in arguments, `[?x=#TAG]` filters and notes patterns. Many
of them run live against production, and the repo is public. They now
name placeholders that the run resolves (`acceptance/subjects.mjs`,
after `2026-11-13-acceptance-subjects.md`):

- **Kinds** read the current state: `$CLANMATE_n` (a POAP KINGS member
  with a battle in 30 days), `$COLLECTION_n`, and two new ones,
  `$FRIEND_n` (a followed, recorded player outside the clan) and
  `$OTHERCLAN_n` (a followed player's clan whose roster answers).
- **Picks** (`acceptance/picks.json`, new) read one position of a frozen
  answer, so a block about a closed war week or a past window still
  reads the same player: `$RIVAL_n` from a closed week's standings,
  `$MEMBER_n` from a closed week's or window's members.
- `$X_n.name` is that player's name (`players_names`). Placeholders work
  inside strings: a path filter, a notes pattern (escaped as a literal).
- Only `args`, `calls`, `assert` and `when` are resolved; a placeholder
  in prose is never read.

142 blocks now name placeholders. Where a block asserted on one
particular player and the invariant is already checked elsewhere, it
is retired (a new `retired` modifier: SKIPPED with its reason, never
run): 130.4, 229.2, 230.2 and 267.1. Two keep running only as bites
(`needs_fixture`): 130.1 and 334.3. Assertions that quoted a member's
name in a summary now match the summary's shape with the names left
open; two searches by a member's name now search by the owner's name
or by a placeholder's name; the rest reword prose only.

The 48 bites coupled to these blocks are anonymized with the shared
mapping, and each bite's manifest entry seeds its placeholders with the
invented tags its captures now carry (`subjects`), so the replay reads
what the capture holds. Every bite still fails its case with the same
expectation. The Gym brief tells the agent to write placeholders, not
tags.

What only production proves: that each pick's path lands on a tag in
today's answers, and that the reworded live blocks still pass. That is
the next full acceptance run's job; nothing a person notices changes.
