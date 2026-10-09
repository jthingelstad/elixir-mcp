import { typesForModeGroup } from "@elixir-mcp/contracts";
import { notBoatDefense } from "./boat-defense-sql.mjs";

/** Clan-scoped counters for the member drill-down. A current member's
 * personal participation history can include other clans; this read cannot. */
export async function memberActivityWeeks(
  db,
  clanTag,
  playerTag,
  weeks,
  from,
  to,
) {
  const { rows } = await db.query(
    `with weeks as (
       select * from jsonb_to_recordset($3::jsonb)
       as w(iso_week text, "from" timestamptz, "to" timestamptz)
     )
     select w.iso_week,
       (select count(*)::int from battle_participant bp
        where bp.player_tag=$1 and bp.clan_tag=$2
          and bp.battle_time >= greatest(w."from",$4::timestamptz)
          and bp.battle_time < least(w."to",$5::timestamptz)
          and ${notBoatDefense("bp", { lookupByKey: true })}) as battles,
       (select count(*)::int from battle_participant bp
        where bp.player_tag=$1 and bp.clan_tag=$2 and bp.type=any($6::text[])
          and bp.battle_time >= greatest(w."from",$4::timestamptz)
          and bp.battle_time < least(w."to",$5::timestamptz)) as ranked_battles,
       case when $4::timestamptz > w."from" then null else (select max(s.donations)::int from player_snapshot_daily s
        where s.player_tag=$1 and s.clan_tag=$2
          and s.snapshot_kind in ('daily','pre_reset')
          and s.observed_at >= greatest(w."from",$4::timestamptz)
          and s.observed_at < least(w."to",$5::timestamptz)
          and s.snapshot_date::timestamp >= w."from"
          and s.snapshot_date::timestamp < least(w."to",$5::timestamptz)) end as donations
     from weeks w order by w."from"`,
    [
      playerTag,
      clanTag,
      JSON.stringify(
        weeks.map(({ iso_week, from, to }) => ({ iso_week, from, to })),
      ),
      from,
      to,
      typesForModeGroup("ranked"),
    ],
  );
  return rows;
}

/** Existing policy calendar, read without creating rows or inferring dates. */
export async function memberActivityWarBounds(db, weeks) {
  const { rows } = await db.query(
    `select w.season_id, w.section_index,
            min(p.starts_at) as "from", max(p.ends_at) as "to"
       from jsonb_to_recordset($1::jsonb) as w(season_id int, section_index int)
       join war_period p on p.war_season_id=w.season_id
                        and p.section_index=w.section_index
       group by w.season_id,w.section_index`,
    [
      JSON.stringify(
        weeks.map(({ season_id, section_index }) => ({
          season_id,
          section_index,
        })),
      ),
    ],
  );
  return rows.map((w) => ({
    ...w,
    from: w.from.toISOString(),
    to: w.to.toISOString(),
  }));
}

/** A clan's battles and active members in each window, by when the
 *  battles were played (`battle_time`, never when Elixir learned them, so
 *  a late capture or a backfill lands in the week it was played): the
 *  distinct battles a member played while in this clan, and how many
 *  members played one. Boat defenses are not the member's battle (0171).
 *  The Monday clan report's week and the four before it. */
export async function clanActivityWeeks(db, clanTag, windows) {
  const { rows } = await db.query(
    `select w.i, a.battles, a.active
       from jsonb_to_recordset($2::jsonb) as w(i int, "from" timestamptz, "to" timestamptz)
       cross join lateral (
         select count(distinct bp.battle_id)::int as battles,
                count(distinct bp.player_tag)::int as active
           from battle_participant bp
          where bp.clan_tag = $1
            and bp.battle_time >= w."from" and bp.battle_time < w."to"
            and ${notBoatDefense("bp", { lookupByKey: true })}) a
      order by w.i`,
    [
      clanTag,
      JSON.stringify(
        windows.map((w, i) => ({
          i,
          from: new Date(w.from).toISOString(),
          to: new Date(w.to).toISOString(),
        })),
      ),
    ],
  );
  return rows.map((r) => ({
    from: new Date(windows[r.i].from).toISOString(),
    to: new Date(windows[r.i].to).toISOString(),
    battles: r.battles,
    active: r.active,
  }));
}

/** How many members the record holds on a clan's roster at each instant
 *  (membership intervals, as the clan entry sizes a window), with when
 *  the record first saw the roster and when the clan's active recording
 *  began: a count before the first is unknown, never zero. */
export async function clanRosterAt(db, clanTag, instants) {
  const { rows } = await db.query(
    `select t.i,
            (select count(*)::int from clan_membership cm
              where cm.clan_tag = $1 and cm.joined_observed_at <= t.at
                and (cm.left_observed_at is null or cm.left_observed_at > t.at)) as members
       from jsonb_to_recordset($2::jsonb) as t(i int, at timestamptz)
      order by t.i`,
    [
      clanTag,
      JSON.stringify(
        instants.map((at, i) => ({ i, at: new Date(at).toISOString() })),
      ),
    ],
  );
  const {
    rows: [since],
  } = await db.query(
    `select (select min(joined_observed_at) from clan_membership where clan_tag = $1) as roster_since,
            (select min(created_at) from recording
              where subject_type = 'clan' and subject_tag = $1 and status = 'active') as recording_since`,
    [clanTag],
  );
  return {
    members: rows.map((r) => r.members),
    roster_since: since.roster_since?.toISOString() ?? null,
    recording_since: since.recording_since?.toISOString() ?? null,
  };
}
