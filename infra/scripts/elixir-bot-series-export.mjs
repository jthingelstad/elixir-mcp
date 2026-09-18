#!/usr/bin/env node
/**
 * The documented intermediate for the elixir-bot series import
 * (time-series review 6.2; Phase 3, 2026-09-18). Reads the bot's
 * database strictly read-only (`?mode=ro`, never `immutable`) and
 * writes .backfill-bot-series.json: one entry per bot day in the roster
 * payload's own shape, plus the rollup slice (6.3).
 *
 *   node infra/scripts/elixir-bot-series-export.mjs            # writes the file, prints the census
 *
 * Per day: `{ day, fetched_at, observed_at_source, sunday, payload }`.
 * `day` is the bot's Chicago metric_date, which maps to the game day
 * of the same name row for row (every clan_daily_metrics.observed_at
 * falls inside [D 10:00Z, D+1 10:00Z); the script asserts it).
 * `fetched_at` is clan_daily_metrics.observed_at for the day (the bot
 * wrote both tables from the same tick; player_daily_metrics has no
 * time of its own); for the days before the bot's first roster
 * (2026-03-07 -> 03-10, member rows only) it is D+1 04:50Z, the bot's
 * modal roster hour (Appendix C), marked observed_at_source "modal".
 * `payload` is `{tag, name, members, clanScore, clanWarTrophies,
 * requiredTrophies, donationsPerWeek, memberList: [{tag, trophies,
 * donations, donationsReceived, clanRank, lastSeen}]}`; fields the bot
 * never kept are absent, never zero (previousClanRank, arena, type,
 * location). On a Chicago Sunday the bot's donations_week is the
 * week's MAX-merged peak: `sunday: true`, and the import writes it as
 * the pre_reset row and leaves the daily row's donations null.
 *
 * The rollup slice: player_daily_battle_rollups with battle_date <=
 * 2026-04-17, Chicago day -> UTC day of the same name (3.3's stated
 * residual), mode groups mapped (friendly / two_v_two / other /
 * special_event -> casual), game_mode_id as is (0 when null),
 * battles_captured from `battles`, trophy_delta from
 * trophy_change_total.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ARCHIVE = new URL("../../../elixir-bot/elixir-v51.db", import.meta.url)
  .pathname;
const ARCHIVE_URI = `file:${ARCHIVE}?mode=ro`;
const OUT = new URL("../../.backfill-bot-series.json", import.meta.url);
const CLAN = "#J2RGCRVG";
const ROLLUP_CUTOFF = "2026-04-17";

function q(sql) {
  const out = execFileSync("sqlite3", ["-json", ARCHIVE_URI, sql], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
  return out.trim() ? JSON.parse(out) : [];
}
const iso = (t) => (t.endsWith("Z") ? t : `${t}Z`);
const gameDay = (isoAt) =>
  new Date(Date.parse(isoAt) - 10 * 3600_000).toISOString().slice(0, 10);
const isSunday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 0;

const clanDays = q(
  `select metric_date, clan_name, member_count, clan_score, clan_war_trophies, required_trophies,
          donations_per_week_requirement, observed_at
   from clan_daily_metrics where clan_tag = '${CLAN}' order by metric_date`,
);
const memberRows = q(
  `select player_tag, metric_date, trophies, clan_rank, donations_week, donations_received_week, last_seen_api
   from player_daily_metrics order by metric_date, player_tag`,
);
const byDay = new Map();
for (const r of memberRows) {
  if (!byDay.has(r.metric_date)) byDay.set(r.metric_date, []);
  byDay.get(r.metric_date).push(r);
}
const clanByDay = new Map(clanDays.map((c) => [c.metric_date, c]));
const days = [...new Set([...clanByDay.keys(), ...byDay.keys()])].sort();

let mismatched = 0;
const entries = [];
for (const day of days) {
  const c = clanByDay.get(day);
  const members = byDay.get(day) ?? [];
  let fetchedAt;
  let source;
  if (c) {
    fetchedAt = iso(c.observed_at);
    source = "clan_daily_metrics.observed_at";
    if (gameDay(fetchedAt) !== day) mismatched += 1;
  } else {
    const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    fetchedAt = `${next}T04:50:00Z`;
    source = "modal";
  }
  const payload = {
    tag: CLAN,
    name: c?.clan_name ?? "POAP KINGS",
    ...(c
      ? {
          members: c.member_count,
          clanScore: c.clan_score,
          clanWarTrophies: c.clan_war_trophies,
          requiredTrophies: c.required_trophies,
          donationsPerWeek: c.donations_per_week_requirement,
        }
      : { members: members.length }),
    memberList: members.map((m) => ({
      tag: m.player_tag,
      ...(m.trophies !== null ? { trophies: m.trophies } : {}),
      ...(m.donations_week !== null ? { donations: m.donations_week } : {}),
      ...(m.donations_received_week !== null
        ? { donationsReceived: m.donations_received_week }
        : {}),
      ...(m.clan_rank !== null ? { clanRank: m.clan_rank } : {}),
      ...(m.last_seen_api ? { lastSeen: m.last_seen_api } : {}),
    })),
  };
  entries.push({
    day,
    fetched_at: fetchedAt,
    observed_at_source: source,
    sunday: isSunday(day),
    has_clan_row: Boolean(c),
    payload,
  });
}

const MODE_GROUP = {
  ladder: "ladder",
  ranked: "ranked",
  war: "war",
  tournament: "tournament",
  challenge: "challenge",
  friendly: "casual",
  two_v_two: "casual",
  other: "casual",
  special_event: "casual",
};
// Four bot groups fold into casual, so two bot rows can share a mapped
// key (friendly and other on the same game mode): summed per key.
const rollupByKey = new Map();
let rollupFolded = 0;
for (const r of q(
  `select player_tag, battle_date, mode_group, game_mode_id, battles, wins, losses, draws,
          crowns_for, crowns_against, trophy_change_total
   from player_daily_battle_rollups where battle_date <= '${ROLLUP_CUTOFF}'
   order by battle_date, player_tag, mode_group, game_mode_id`,
)) {
  const row = {
    player_tag: r.player_tag,
    day: r.battle_date,
    mode_group: MODE_GROUP[r.mode_group] ?? "casual",
    game_mode_id: r.game_mode_id ?? 0,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    crowns_for: r.crowns_for,
    crowns_against: r.crowns_against,
    trophy_delta: r.trophy_change_total,
    battles_captured: r.battles,
  };
  const key = `${row.player_tag}|${row.day}|${row.mode_group}|${row.game_mode_id}`;
  const have = rollupByKey.get(key);
  if (!have) rollupByKey.set(key, row);
  else {
    rollupFolded += 1;
    for (const k of [
      "wins",
      "losses",
      "draws",
      "crowns_for",
      "crowns_against",
      "trophy_delta",
      "battles_captured",
    ])
      have[k] += row[k];
  }
}
const rollups = [...rollupByKey.values()];

const census = {
  days: entries.length,
  first_day: entries[0]?.day,
  last_day: entries.at(-1)?.day,
  clan_rows: clanDays.length,
  member_rows: memberRows.length,
  players: new Set(memberRows.map((m) => m.player_tag)).size,
  member_only_days: entries.filter((e) => !e.has_clan_row).map((e) => e.day),
  sundays: entries.filter((e) => e.sunday).length,
  observed_at_outside_game_day: mismatched,
  rollup_rows: rollups.length,
  rollup_rows_folded: rollupFolded,
  rollup_players: new Set(rollups.map((r) => r.player_tag)).size,
  rollup_battles: rollups.reduce((s, r) => s + r.battles_captured, 0),
};
writeFileSync(
  OUT,
  JSON.stringify({
    exported_at: new Date().toISOString(),
    census,
    entries,
    rollups,
  }),
);
console.log(JSON.stringify(census, null, 1));
console.log(`wrote ${OUT.pathname}`);
