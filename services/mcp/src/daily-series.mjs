/**
 * The daily series readers' shared pieces (time-series review Part 7,
 * contract 3.12.0): the metric catalogue over player_snapshot_daily,
 * the date-only window the series tools take (game days, the 10:00Z
 * grid), the stamps every point carries, and the notes every series
 * response says once.
 *
 * Every point carries the instants that produced it: `observed_at` (the
 * newest observation of either writer), `profile_observed_at` (the
 * profile poll that wrote the lifetime block; null on a day the roster
 * wrote and no profile poll did), `roster_observed_at` (the roster poll
 * that wrote the clan columns; null when the roster never touched the
 * row), `source` (`api` or `elixir-bot`) and `kind`.
 */

import {
  ToolFailure,
  WINDOW_DATE_ONLY_DESC,
  withWindowSugar,
} from "./tools/shared.mjs";

/** Every metric a member's day row carries, by the name the tool speaks. */
export const PLAYER_METRICS = [
  "trophies",
  "best_trophies",
  "donations",
  "donations_received",
  "battle_count",
  "wins",
  "losses",
  "three_crown_wins",
  "star_points",
  "exp_points",
  "collection_level",
  "king_tower_level",
  "pol_league",
  "pol_trophies",
  "pol_rank",
  "season_trophies",
  "season_best_trophies",
  "total_donations",
  "challenge_cards_won",
  "challenge_max_wins",
  "tournament_cards_won",
  "tournament_battle_count",
  "arena_id",
  "clan_tag",
  "clan_rank",
  "previous_clan_rank",
  "game_last_seen_at",
];

export const KINDS = ["daily", "pre_reset", "season_roll"];

export const KIND_SCHEMA = {
  type: "string",
  enum: KINDS,
  default: "daily",
  description:
    "Which row of the day: daily (the day's last observation), pre_reset (the hour before the Monday 00:10 UTC donation reset: the honest weekly donation total) or season_roll (the hour before the season rolls).",
};

export const GRANULARITY_SCHEMA = {
  type: "string",
  enum: ["day", "week"],
  default: "day",
  description: "week returns the last row of each ISO week.",
};

export const DAY_WINDOW_ARGS = {
  from: { type: "string", description: WINDOW_DATE_ONLY_DESC },
  to: { type: "string", description: WINDOW_DATE_ONLY_DESC },
  days: {
    type: "integer",
    minimum: 1,
    description:
      "Last N days of the series, today included: sugar for from. Or use from/to.",
  },
  weeks: {
    type: "integer",
    minimum: 1,
    description:
      "Last N weeks of the series, today included: sugar for from. Or use from/to.",
  },
};

/** The date-only window every daily series takes: from/to as YYYY-MM-DD
 *  (game days), days/weeks as sugar for from (N days back from today is
 *  the day N-1 days ago, today included). */
export function dayWindow(rawArgs) {
  const args = withWindowSugar(rawArgs);
  if (args.from !== rawArgs.from)
    args.from = new Date(Date.parse(args.from) + 86_400_000)
      .toISOString()
      .slice(0, 10);
  for (const d of ["from", "to"]) {
    if (
      args[d] !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(args[d])) ||
        Number.isNaN(Date.parse(args[d])))
    )
      throw new ToolFailure(
        "bad_request",
        `Unparseable ${d}: ${args[d]}`,
        WINDOW_DATE_ONLY_DESC,
      );
  }
  if (args.from && args.to && args.from > args.to)
    throw new ToolFailure(
      "bad_request",
      "from is after to — the window is inverted.",
      "Swap the bounds; from must be the earlier date.",
    );
  return {
    from: args.from ?? null,
    to: args.to ?? null,
    source: args.from || args.to ? "argument" : "unbounded",
  };
}

/** The stamps a point carries beside its metrics. */
export function pointStamps(row) {
  return {
    kind: row.snapshot_kind,
    observed_at: row.observed_at?.toISOString() ?? null,
    profile_observed_at: row.profile_observed_at?.toISOString() ?? null,
    roster_observed_at: row.roster_observed_at?.toISOString() ?? null,
    source: row.source,
  };
}

/** A metric's value as the tool speaks it. */
export function metricValue(row, metric) {
  const v = row[metric];
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

export const STAMP_COLUMNS = `snapshot_kind, observed_at, profile_observed_at, roster_observed_at, source`;

export const GAME_DAY_NOTE =
  "Days are game days: each runs from 10:00 UTC to 10:00 UTC and is named for the date it starts on, the same grid as war days and season rolls; a point is the day's last observation.";

/** The note said once when any point in the window came from the
 *  elixir-bot import. */
export function botSourceNote(points) {
  return points.some((p) => p.source === "elixir-bot")
    ? "Some points carry source: elixir-bot, imported from POAP KINGS' earlier bot for days the archive lacks; their instant is the bot's day, approximated on four days (2026-03-07 to 03-10)."
    : null;
}
