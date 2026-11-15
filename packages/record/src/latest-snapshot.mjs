/**
 * The one ORDER BY for "a player's latest snapshot row" (#512).
 *
 * player_snapshot_daily keeps up to three rows per player and game day:
 * `daily`, which every observation moves, and the auxiliary `pre_reset`
 * and `season_roll` rows, written only inside their windows and frozen
 * after. The readers used to order `snapshot_date desc, snapshot_kind
 * desc`, so on the game day that held a window the frozen row won on its
 * name ('pre_reset' > 'daily'): from Monday 00:10Z, when the donation
 * window closes, to the 10:00Z game-day turn, every latest read served
 * the values of the window's last observation.
 *
 * Latest means newest observed. The row's own stamp decides: `observed_at`
 * for any row, `profile_observed_at` for a reader that wants the profile
 * block, `roster_observed_at` for the roster's columns. A row's
 * snapshot_date is the game day of its observations, so leading with the
 * date keeps the order the stamp's while letting the primary key
 * (player_tag, snapshot_date, snapshot_kind) serve the read: a backward
 * probe to the player's newest day and a sort of its few rows, never the
 * player's whole history. Two rows observed at the same instant (inside a
 * window, one read writes both) take `daily` first: pre_reset keeps the
 * week's donation high-water mark, and the latest read wants the counter
 * as it stands.
 *
 * The kind-keyed series reads (a series that asks for `pre_reset` rows)
 * name their kind and do not use this.
 *
 * `alias` qualifies the columns ("s" gives `s.snapshot_date ...`).
 * A read bounded on the stamp itself ("the last profile at or before t",
 * the timeline's) probes 0262's (player_tag, profile_observed_at desc)
 * index instead and keeps to `snapshot_kind = 'daily'`, the row every
 * observation writes, so it needs no sort (activity/entries.mjs).
 */
const STAMPS = new Set([
  "observed_at",
  "profile_observed_at",
  "roster_observed_at",
]);

export function latestSnapshotOrder({
  alias = null,
  stamp = "observed_at",
} = {}) {
  if (!STAMPS.has(stamp))
    throw new Error(`latestSnapshotOrder: unknown stamp ${stamp}`);
  if (alias !== null && !/^[a-z_][a-z0-9_]*$/.test(alias))
    throw new Error(`latestSnapshotOrder: bad alias ${alias}`);
  const c = alias ? `${alias}.` : "";
  return `${c}snapshot_date desc, ${c}${stamp} desc nulls last, ${c}snapshot_kind = 'daily' desc`;
}
