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
