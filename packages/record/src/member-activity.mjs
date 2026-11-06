import { typesForModeGroup } from "@elixir-mcp/contracts";
import { notBoatDefense } from "./boat-defense-sql.mjs";

/** A week's battles run Monday reset to Monday reset (A13), the clock its
 *  donations and race close already keep. `weeks` name Monday midnight. */
const RESET = "interval '10 hours'";

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
          and bp.battle_time >= greatest(w."from" + ${RESET},$4::timestamptz)
          and bp.battle_time < least(w."to" + ${RESET},$5::timestamptz)
          and ${notBoatDefense("bp", { lookupByKey: true })}) as battles,
       (select count(*)::int from battle_participant bp
        where bp.player_tag=$1 and bp.clan_tag=$2 and bp.type=any($6::text[])
          and bp.battle_time >= greatest(w."from" + ${RESET},$4::timestamptz)
          and bp.battle_time < least(w."to" + ${RESET},$5::timestamptz)) as ranked_battles,
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

/** One clan's battles in each window, the way the clan report counts them
 *  (A13): played in [from, to) on battle_time, for this clan only, each
 *  battle once however many members were in it, never a boat defense. One
 *  range scan per window on (clan_tag, battle_time desc) (0089), the same
 *  shape as clanActivityWeeks. Departed members who played here are in
 *  `members`: the battle was the clan's. */
export async function clanWeekBattles(db, clanTag, windows) {
  const { rows } = await db.query(
    `with played as materialized (
       select w.i, bp.player_tag, bp.battle_id, bp.type = any($3::text[]) as ranked
         from jsonb_to_recordset($2::jsonb) as w(i int, "from" timestamptz, "to" timestamptz)
         join battle_participant bp
           on bp.clan_tag = $1
          and bp.battle_time >= w."from" and bp.battle_time < w."to"
        where bp.battle_time >= $4::timestamptz and bp.battle_time < $5::timestamptz
          and ${notBoatDefense("bp", { lookupByKey: true })}
     ), people as (
       select i, player_tag,
              count(distinct battle_id)::int as battles,
              (count(distinct battle_id) filter (where ranked))::int as ranked
         from played group by i, player_tag
     )
     select t.i, t.battles, t.active, t.ranked, t.ranked_active,
            (select jsonb_agg(jsonb_build_object(
                      'player_tag', x.player_tag, 'name', p.name,
                      'battles', x.battles, 'ranked', x.ranked))
               from people x
               left join player p on p.player_tag = x.player_tag
              where x.i = t.i) as members
       from (select i,
                    count(distinct battle_id)::int as battles,
                    count(distinct player_tag)::int as active,
                    (count(distinct battle_id) filter (where ranked))::int as ranked,
                    (count(distinct player_tag) filter (where ranked))::int as ranked_active
               from played group by i) t`,
    [
      clanTag,
      JSON.stringify(
        windows.map((w, i) => ({
          i,
          from: new Date(w.from).toISOString(),
          to: new Date(w.to).toISOString(),
        })),
      ),
      typesForModeGroup("ranked"),
      // The windows' outer edges, so the index range holds whichever way the
      // planner joins the windows.
      new Date(
        Math.min(...windows.map((w) => new Date(w.from).getTime())),
      ).toISOString(),
      new Date(
        Math.max(...windows.map((w) => new Date(w.to).getTime())),
      ).toISOString(),
    ],
  );
  const byIndex = new Map(rows.map((r) => [r.i, r]));
  return windows.map((w, i) => {
    const r = byIndex.get(i);
    return {
      ...w,
      battles: r?.battles ?? 0,
      active: r?.active ?? 0,
      ranked: r?.ranked ?? 0,
      ranked_active: r?.ranked_active ?? 0,
      members: r?.members ?? [],
    };
  });
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
