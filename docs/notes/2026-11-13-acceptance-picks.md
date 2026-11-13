# 2026-11-13 — Acceptance picks find their row by its frozen values

No MCP tool, `/api/v1` operation, contract version, migration or stored
data changes. Acceptance only (#907).

A pick in `acceptance/picks.json` read one position of a closed answer.
Two things move a position:

- `war_history` orders `member_weeks` by points and then the current
  name, so a rename reorders tied rows.
- `clans_standings` lists only members who have not left, so a departure
  shifts every row below it.

A case pinned to `$MEMBER_3` would then assert one player's numbers
against another's.

A pick can now name `where`: the frozen values its cases assert on its
row. `pickRow` (`acceptance/subjects.mjs`) resolves it in this order:

1. The positional row, while it still holds the values, so a pick never
   changes subject needlessly.
2. Otherwise the one row that holds them.
3. With `ties: "tag"`, the lowest tag among several matching rows. This
   is only for picks whose cases hold for any such row.
4. Otherwise a SKIP that names the values and how many rows match.

The war week 136/1 picks have it:

- `$MEMBER_1`, `$MEMBER_2` and `$MEMBER_16` (values from cases 85.1 and
  262.3) SKIP on a tie. Their other cases read player-specific history.
- `$MEMBER_3` and `$MEMBER_4` (87.4 only) take `ties: "tag"`.

A test fails if a `where` value is not one a Gym case asserts on that row
of the same read, or if two cases disagree.

## Left, and why

- `$MEMBER_5` and `$MEMBER_7` (standings rows) feed only cross-call
  invariants (157.2, 157.3, 198.1), which hold for whichever member the
  row is. A departure changes the subject, not the verdict.
- `$MEMBER_14` and `$MEMBER_15` need a member whose join note is still
  live (237.1, 237.2, 237.3 and 334.4 are `live` cases). Re-choosing them
  needs live reads; the steps are on #907.
- The `clans_members_series`, `elixir_timeline` and rival picks assert
  no exact value on their own row in their source read, so there is no
  `where` to give them yet. The first live run confirms they still name
  the subjects their cases expect (#907).
