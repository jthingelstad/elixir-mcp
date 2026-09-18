/**
 * The elixir-bot series import and its validation census (time-series
 * review Part 6; Phase 3, 2026-09-18). Decision 3: history import is in
 * scope and IS the validation; nothing in elixir-bot changes.
 *
 *   {series_import: {stage: {entries, rollups}}}
 *     The documented intermediate (infra/scripts/elixir-bot-series-
 *     export.mjs) into the `staging` schema, replacing what was there.
 *     Nothing touches the record.
 *
 *   {series_census: {clan_tag?, from?, to?}}
 *     Read-only. Staging against live over every game day in the
 *     window: days only the recorder has, only the bot has, both; per
 *     metric, rows equal, rows within the residual (the recorder's
 *     observation later than the bot's, so a difference is the five
 *     hours between them), rows that disagree otherwise; the
 *     observed_at deltas; the Sundays (the bot's MAX-merged donations
 *     against the recorder's pre_reset row); the rollup slice.
 *
 *   {series_import: {commit: true}}
 *     The non-overlapping rows only, through projectClanSeries with
 *     source 'elixir-bot' and no receipt: a clan row where the record
 *     has none for the day, a member's row where the record has none
 *     for that member and day, a pre_reset row on a Sunday where the
 *     record's own window missed it (carrying the bot's MAX); and the
 *     rollup keys the record lacks, by exception directly (a derived
 *     table under a source-less schema; this file and the NOTES entry
 *     are its provenance). Never a moment.
 */

import pg from "pg";

const STAGING_DDL = `
  create schema if not exists staging;
  create table if not exists staging.bot_clan_day (
    day date primary key, fetched_at timestamptz not null, sunday boolean not null,
    has_clan_row boolean not null, clan_score int, clan_war_trophies int, members int,
    required_trophies int, donations_per_week int);
  create table if not exists staging.bot_member_day (
    player_tag text not null, day date not null, fetched_at timestamptz not null,
    sunday boolean not null, trophies int, donations int, donations_received int,
    clan_rank int, last_seen text, primary key (player_tag, day));
  create table if not exists staging.bot_rollup (
    player_tag text not null, day date not null, mode_group text not null, game_mode_id int not null,
    wins int, losses int, draws int, crowns_for int, crowns_against int, trophy_delta int,
    battles_captured int, primary key (player_tag, day, mode_group, game_mode_id));`;

const CLAN = "#J2RGCRVG";

export async function seriesImport(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const started = Date.now();
  try {
    if (spec.stage) return await stage(db, spec.stage, started);
    if (spec.commit === true) return await commit(db, started);
    throw new Error(
      "series_import needs {stage: {entries, rollups}} or {commit: true}",
    );
  } finally {
    await db.end();
  }
}

async function stage(db, { entries = [], rollups = [] }, started) {
  await db.query("begin");
  try {
    await db.query(STAGING_DDL);
    await db.query(
      `truncate staging.bot_clan_day, staging.bot_member_day, staging.bot_rollup`,
    );
    const clanDays = entries.filter((e) => e.has_clan_row);
    await db.query(
      `insert into staging.bot_clan_day
         (day, fetched_at, sunday, has_clan_row, clan_score, clan_war_trophies, members,
          required_trophies, donations_per_week)
       select * from unnest($1::date[], $2::timestamptz[], $3::boolean[], $4::boolean[], $5::int[],
                            $6::int[], $7::int[], $8::int[], $9::int[])`,
      [
        clanDays.map((e) => e.day),
        clanDays.map((e) => e.fetched_at),
        clanDays.map((e) => e.sunday),
        clanDays.map((e) => e.has_clan_row),
        clanDays.map((e) => e.payload.clanScore ?? null),
        clanDays.map((e) => e.payload.clanWarTrophies ?? null),
        clanDays.map((e) => e.payload.members ?? null),
        clanDays.map((e) => e.payload.requiredTrophies ?? null),
        clanDays.map((e) => e.payload.donationsPerWeek ?? null),
      ],
    );
    const members = [];
    for (const e of entries)
      for (const m of e.payload.memberList ?? [])
        members.push({
          ...m,
          day: e.day,
          fetched_at: e.fetched_at,
          sunday: e.sunday,
        });
    await db.query(
      `insert into staging.bot_member_day
         (player_tag, day, fetched_at, sunday, trophies, donations, donations_received, clan_rank, last_seen)
       select * from unnest($1::text[], $2::date[], $3::timestamptz[], $4::boolean[], $5::int[],
                            $6::int[], $7::int[], $8::int[], $9::text[])`,
      [
        members.map((m) => m.tag),
        members.map((m) => m.day),
        members.map((m) => m.fetched_at),
        members.map((m) => m.sunday),
        members.map((m) => m.trophies ?? null),
        members.map((m) => m.donations ?? null),
        members.map((m) => m.donationsReceived ?? null),
        members.map((m) => m.clanRank ?? null),
        members.map((m) => m.lastSeen ?? null),
      ],
    );
    await db.query(
      `insert into staging.bot_rollup
         (player_tag, day, mode_group, game_mode_id, wins, losses, draws, crowns_for, crowns_against,
          trophy_delta, battles_captured)
       select * from unnest($1::text[], $2::date[], $3::text[], $4::int[], $5::int[], $6::int[], $7::int[],
                            $8::int[], $9::int[], $10::int[], $11::int[])`,
      [
        rollups.map((r) => r.player_tag),
        rollups.map((r) => r.day),
        rollups.map((r) => r.mode_group),
        rollups.map((r) => r.game_mode_id),
        rollups.map((r) => r.wins),
        rollups.map((r) => r.losses),
        rollups.map((r) => r.draws),
        rollups.map((r) => r.crowns_for),
        rollups.map((r) => r.crowns_against),
        rollups.map((r) => r.trophy_delta),
        rollups.map((r) => r.battles_captured),
      ],
    );
    await db.query("commit");
    return {
      staged: {
        clan_days: clanDays.length,
        member_rows: members.length,
        rollups: rollups.length,
        days: entries.length,
      },
      ms: Date.now() - started,
    };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

export async function seriesCensus(databaseUrl, spec = {}) {
  const clanTag = String(spec.clan_tag ?? CLAN).toUpperCase();
  const from = spec.from ?? "2026-03-01";
  const to = spec.to ?? "2026-12-31";
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set transaction_read_only = on");
    await db.query("set statement_timeout = 250000");
    const {
      rows: [days],
    } = await db.query(
      `with bot as (select day from staging.bot_clan_day where day between $2::date and $3::date),
            rec as (select day from clan_snapshot_daily
                     where clan_tag = $1 and snapshot_kind = 'daily' and source = 'api' and day between $2::date and $3::date)
       select (select count(*)::int from bot where day not in (select day from rec)) as only_bot,
              (select count(*)::int from rec where day not in (select day from bot)) as only_recorder,
              (select count(*)::int from bot where day in (select day from rec)) as both,
              (select json_agg(day::text order by day) from bot where day not in (select day from rec)) as only_bot_days,
              (select json_agg(day::text order by day) from rec where day not in (select day from bot)) as only_recorder_days`,
      [clanTag, from, to],
    );
    // Clan metrics on the days both have. "residual": the recorder's
    // observation is later than the bot's, so a difference is what moved
    // in the hours between them (the bot's day ends ~05Z, the recorder's
    // at 10Z). "disagree": the recorder's observation is at or before the
    // bot's and the values still differ.
    const metric = (col, botCol = col) => `
      count(*) filter (where r.${col} is not distinct from b.${botCol})::int as "${col}_equal",
      count(*) filter (where r.${col} is distinct from b.${botCol} and r.observed_at > b.fetched_at)::int as "${col}_residual",
      count(*) filter (where r.${col} is distinct from b.${botCol} and r.observed_at <= b.fetched_at)::int as "${col}_disagree"`;
    const {
      rows: [clan],
    } = await db.query(
      `select count(*)::int as days,
         ${metric("clan_score")}, ${metric("clan_war_trophies")}, ${metric("members")},
         ${metric("required_trophies")}, ${metric("donations_per_week")}
       from staging.bot_clan_day b
       join clan_snapshot_daily r on r.clan_tag = $1 and r.day = b.day and r.snapshot_kind = 'daily' and r.source = 'api'
       where b.day between $2::date and $3::date`,
      [clanTag, from, to],
    );
    const {
      rows: [members],
    } = await db.query(
      `with b as (select * from staging.bot_member_day where day between $2::date and $3::date),
            r as (select * from player_snapshot_daily
                   where snapshot_kind = 'daily' and source = 'api' and roster_observed_at is not null
                     and clan_tag = $1 and snapshot_date between $2::date and $3::date)
       select (select count(*)::int from b) as bot_rows,
              (select count(*)::int from b where not exists
                 (select 1 from player_snapshot_daily s where s.player_tag = b.player_tag
                    and s.snapshot_date = b.day and s.snapshot_kind = 'daily')) as only_bot,
              (select count(*)::int from r where not exists
                 (select 1 from b where b.player_tag = r.player_tag and b.day = r.snapshot_date)) as only_recorder,
              (select count(*)::int from b join r on r.player_tag = b.player_tag and r.snapshot_date = b.day) as both,
              (select count(*)::int from b join player_snapshot_daily s
                 on s.player_tag = b.player_tag and s.snapshot_date = b.day and s.snapshot_kind = 'daily'
                where s.clan_tag is distinct from $1) as both_under_another_clan,
              (select json_build_object(
                 'trophies_equal', count(*) filter (where r.trophies is not distinct from b.trophies),
                 'trophies_residual', count(*) filter (where r.trophies is distinct from b.trophies and r.roster_observed_at > b.fetched_at),
                 'trophies_disagree', count(*) filter (where r.trophies is distinct from b.trophies and r.roster_observed_at <= b.fetched_at),
                 'donations_equal', count(*) filter (where not b.sunday and r.donations is not distinct from b.donations),
                 'donations_residual', count(*) filter (where not b.sunday and r.donations is distinct from b.donations and r.roster_observed_at > b.fetched_at),
                 'donations_disagree', count(*) filter (where not b.sunday and r.donations is distinct from b.donations and r.roster_observed_at <= b.fetched_at),
                 'donations_received_equal', count(*) filter (where not b.sunday and r.donations_received is not distinct from b.donations_received),
                 'donations_received_residual', count(*) filter (where not b.sunday and r.donations_received is distinct from b.donations_received and r.roster_observed_at > b.fetched_at),
                 'donations_received_disagree', count(*) filter (where not b.sunday and r.donations_received is distinct from b.donations_received and r.roster_observed_at <= b.fetched_at),
                 'clan_rank_equal', count(*) filter (where r.clan_rank is not distinct from b.clan_rank),
                 'clan_rank_residual', count(*) filter (where r.clan_rank is distinct from b.clan_rank and r.roster_observed_at > b.fetched_at),
                 'clan_rank_disagree', count(*) filter (where r.clan_rank is distinct from b.clan_rank and r.roster_observed_at <= b.fetched_at),
                 'delta_hours', json_build_object(
                    'under_minus_1', count(*) filter (where extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 < -1),
                    'minus_1_to_0', count(*) filter (where extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 between -1 and 0),
                    '0_to_1', count(*) filter (where extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 > 0 and extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 <= 1),
                    '1_to_3', count(*) filter (where extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 > 1 and extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 <= 3),
                    '3_to_6', count(*) filter (where extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 > 3 and extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 <= 6),
                    'over_6', count(*) filter (where extract(epoch from r.roster_observed_at - b.fetched_at) / 3600 > 6)))
               from b join r on r.player_tag = b.player_tag and r.snapshot_date = b.day) as metrics`,
      [clanTag, from, to],
    );
    const {
      rows: [sundays],
    } = await db.query(
      `with b as (select * from staging.bot_member_day where sunday and day between $1::date and $2::date)
       select count(*)::int as bot_sunday_rows,
              count(*) filter (where p.player_tag is not null)::int as with_recorder_pre_reset,
              count(*) filter (where p.player_tag is not null and p.donations is not distinct from b.donations)::int as pre_reset_equal,
              count(*) filter (where p.player_tag is not null and p.donations is distinct from b.donations)::int as pre_reset_differs,
              count(*) filter (where p.player_tag is null)::int as recorder_window_missed
       from b
       left join player_snapshot_daily p
         on p.player_tag = b.player_tag and p.snapshot_date = b.day and p.snapshot_kind = 'pre_reset' and p.source = 'api'`,
      [from, to],
    );
    const {
      rows: [rollup],
    } = await db.query(
      `select count(*)::int as bot_keys,
              count(*) filter (where r.player_tag is null)::int as absent,
              count(*) filter (where r.player_tag is not null and (r.wins, r.losses, r.draws, r.battles_captured)
                                 = (b.wins, b.losses, b.draws, b.battles_captured))::int as present_equal,
              count(*) filter (where r.player_tag is not null and (r.wins, r.losses, r.draws, r.battles_captured)
                                 <> (b.wins, b.losses, b.draws, b.battles_captured))::int as present_different
       from staging.bot_rollup b
       left join player_daily_battle_rollup r
         on r.player_tag = b.player_tag and r.day = b.day and r.mode_group = b.mode_group
        and r.game_mode_id = b.game_mode_id`,
    );
    return {
      clan_tag: clanTag,
      from,
      to,
      days,
      clan,
      members,
      sundays,
      rollup,
    };
  } finally {
    await db.end();
  }
}

async function commit(db, started) {
  const { projectClanSeries } = await import("../../ingest/src/series.mjs");
  const out = {
    days: 0,
    clan_rows: 0,
    member_rows: 0,
    pre_reset_rows: 0,
    members_skipped_overlap: 0,
    rollup_keys_added: 0,
  };
  const { rows: days } = await db.query(
    `select day::text as day, fetched_at, sunday, has_clan_row,
            clan_score, clan_war_trophies, members, required_trophies, donations_per_week
     from staging.bot_clan_day
     union all
     select distinct day::text, fetched_at, sunday, false, null::int, null::int, null::int, null::int, null::int
     from staging.bot_member_day m
     where not exists (select 1 from staging.bot_clan_day c where c.day = m.day)
     order by 1`,
  );
  for (const d of days) {
    await db.query("begin");
    try {
      const { rows: members } = await db.query(
        `select b.player_tag, b.trophies, b.donations, b.donations_received, b.clan_rank, b.last_seen,
              exists (select 1 from player_snapshot_daily s where s.player_tag = b.player_tag
                        and s.snapshot_date = b.day and s.snapshot_kind = 'daily') as has_daily,
              exists (select 1 from player_snapshot_daily s where s.player_tag = b.player_tag
                        and s.snapshot_date = b.day and s.snapshot_kind = 'pre_reset') as has_pre_reset
       from staging.bot_member_day b where b.day = $1::date order by b.player_tag`,
        [d.day],
      );
      const {
        rows: [{ has_clan_row: recorderHasClanRow }],
      } = await db.query(
        `select exists (select 1 from clan_snapshot_daily where clan_tag = $1 and day = $2::date
                        and snapshot_kind = 'daily') as has_clan_row`,
        [CLAN, d.day],
      );
      const observedAt = d.fetched_at.toISOString();
      const memberEntry = (m, { withDonations }) => ({
        tag: m.player_tag,
        ...(m.trophies !== null ? { trophies: m.trophies } : {}),
        ...(withDonations && m.donations !== null
          ? { donations: m.donations }
          : {}),
        ...(withDonations && m.donations_received !== null
          ? { donationsReceived: m.donations_received }
          : {}),
        ...(m.clan_rank !== null ? { clanRank: m.clan_rank } : {}),
        ...(m.last_seen ? { lastSeen: m.last_seen } : {}),
      });
      const clanFields = d.has_clan_row
        ? {
            members: d.members,
            clanScore: d.clan_score,
            clanWarTrophies: d.clan_war_trophies,
            requiredTrophies: d.required_trophies,
            donationsPerWeek: d.donations_per_week,
          }
        : { members: members.length };
      // The daily row: the clan's where the record has none, the members'
      // where each has none. On a Sunday the bot's donations are the
      // week's MAX, not the day's last value: the daily row leaves them
      // null (absence over a guess) and the pre_reset row carries them.
      const newMembers = members.filter((m) => !m.has_daily);
      out.members_skipped_overlap += members.length - newMembers.length;
      const writeClanRow = d.has_clan_row && !recorderHasClanRow;
      if (writeClanRow || newMembers.length) {
        const r = await projectClanSeries(db, {
          payload: {
            tag: CLAN,
            name: "POAP KINGS",
            ...clanFields,
            memberList: newMembers.map((m) =>
              memberEntry(m, { withDonations: !d.sunday }),
            ),
          },
          observedAt,
          source: "elixir-bot",
          moments: false,
          clanRow: writeClanRow,
          kind: "daily",
        });
        out.clan_rows += r.clanRow;
        out.member_rows += r.membersMoved;
      }
      if (d.sunday) {
        const missed = members.filter(
          (m) => !m.has_pre_reset && m.donations !== null,
        );
        if (missed.length) {
          const r = await projectClanSeries(db, {
            payload: {
              tag: CLAN,
              name: "POAP KINGS",
              ...clanFields,
              memberList: missed.map((m) =>
                memberEntry(m, { withDonations: true }),
              ),
            },
            observedAt,
            source: "elixir-bot",
            moments: false,
            clanRow: false,
            kind: "pre_reset",
          });
          out.pre_reset_rows += r.membersMoved;
        }
      }
      out.days += 1;
      await db.query("commit");
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  }
  // The rollup slice: keys the record lacks, by exception directly.
  await db.query(
    `insert into player (player_tag) select distinct player_tag from staging.bot_rollup on conflict do nothing`,
  );
  const { rowCount } = await db.query(
    `insert into player_daily_battle_rollup
       (player_tag, day, mode_group, game_mode_id, wins, losses, draws, crowns_for, crowns_against,
        trophy_delta, battles_captured)
     select player_tag, day, mode_group, game_mode_id, wins, losses, draws, crowns_for, crowns_against,
            trophy_delta, battles_captured
     from staging.bot_rollup
     on conflict (player_tag, day, mode_group, game_mode_id) do nothing`,
  );
  out.rollup_keys_added = rowCount;
  return { ...out, ms: Date.now() - started };
}
