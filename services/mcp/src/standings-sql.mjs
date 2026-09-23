/**
 * The SQL behind clans_standings, in one place (the participation-sql
 * pattern): the tool runs it and the migrate Lambda's
 * `explain_standings` diagnostic EXPLAIN ANALYZEs it, so the plan being
 * read is the plan being served.
 *
 * The counts come from the daily rollup for the whole days inside the
 * window and the raw rows for its edge days (daily-sql.mjs, plan step
 * 14); until then the subquery scanned the CORPUS's window and kept ~50
 * members of it. The streak is the run of equal decided outcomes ending
 * at the member's latest battle, from the members' own raw rows (the
 * 2026-09-16 timeline request §2: a consumer called
 * battles_performance per member for this).
 */

import { typesForModeGroup } from "@elixir-mcp/contracts";
import { dailySql } from "./daily-sql.mjs";

export function standingsQuery({ clanTag, from, to = null, mode = null }) {
  const members = `(select cm.player_tag from clan_membership cm
                    where cm.clan_tag = $1 and cm.left_observed_at is null)`;
  const values = [clanTag, from, to];
  const rawClauses = [];
  let types = null;
  let modeGroup = null;
  if (mode) {
    values.push(typesForModeGroup(mode));
    types = `$${values.length}`;
    rawClauses.push(`and bp.type = any(${types})`);
    values.push(mode);
    modeGroup = `$${values.length}`;
  }
  const daily = dailySql({
    players: `array(${members})`,
    from: "$2",
    to: "$3",
    modeGroup,
    types,
  });
  const text = `with d as ${daily},
     s as (
       select bp.player_tag, bp.battle_id, bp.outcome, bp.battle_time, bp.side, bp.deck_avg_level, bp.opp_deck_avg_level
       from battle_participant bp
       where bp.player_tag in ${members}
         and bp.battle_time >= $2
         and ($3::timestamptz is null or bp.battle_time < $3)
         ${rawClauses.join(" ")}
     ),
     decided as (
       select player_tag, outcome,
              row_number() over (partition by player_tag order by battle_time desc, battle_id desc) as drn
       from s where outcome in ('win', 'loss')
     ),
     streak as (
       select d.player_tag, l.latest as streak_kind,
              (coalesce(min(d.drn) filter (where d.outcome <> l.latest), max(d.drn) + 1) - 1)::int as streak_len
       from decided d
       join (select player_tag, outcome as latest from decided where drn = 1) l
         on l.player_tag = d.player_tag
       group by d.player_tag, l.latest
     ),
     sums as (
       select player_tag,
              sum(battles)::int as battles, sum(wins)::int as wins,
              sum(losses)::int as losses, sum(draws)::int as draws,
              sum(trophy_delta) filter (where mode_group = 'ladder')::int as net_trophies,
              sum(battles) filter (where mode_group = 'ladder')::int as ladder_battles
       from d group by player_tag
     ),
     -- The control next to the number (3.16.0): the member's battles by
     -- mode group from the same rollup rows, and the mean level gap
     -- against the opposing side over the raw rows the streak reads.
     modes as (
       select player_tag,
              json_agg(json_build_object('mode_group', mode_group, 'battles', battles,
                                         'wins', wins, 'losses', losses)) as modes
       from (select player_tag, mode_group, sum(battles)::int as battles,
                    sum(wins)::int as wins, sum(losses)::int as losses
               from d group by player_tag, mode_group) m
       group by player_tag
     ),
     -- The gap over each member's LATEST 50 leveled battles in the window:
     -- every opposing row is a random heap read (0.6 ms cold on the
     -- micro), and the whole window was 12,657 of them and 15 s on a
     -- 30-day read (2026-09-18); level_gap_battles says the sample.
     recent as (
       select s.player_tag, s.battle_id, s.side, s.deck_avg_level, s.opp_deck_avg_level,
              row_number() over (partition by s.player_tag order by s.battle_time desc, s.battle_id desc) as rn
       from s where s.deck_avg_level is not null
     ),
     gaps as (
       select r.player_tag,
              round(avg(r.deck_avg_level - o.lvl)::numeric, 2) as mean_level_gap,
              count(o.lvl)::int as level_gap_battles
       from recent r
       cross join lateral (select r.opp_deck_avg_level as lvl) o -- stamped at ingest (0156)
       where r.rn <= 50
       group by r.player_tag
     )
     select cm.player_tag, p.name, p.years_played,
            coalesce(su.battles, 0)::int as battles,
            coalesce(su.wins, 0)::int as wins,
            coalesce(su.losses, 0)::int as losses,
            coalesce(su.draws, 0)::int as draws,
            coalesce(su.net_trophies, 0)::int as net_trophies,
            coalesce(su.ladder_battles, 0)::int as ladder_battles,
            mo.modes, g.mean_level_gap, coalesce(g.level_gap_battles, 0)::int as level_gap_battles,
            st.streak_kind, st.streak_len
     from clan_membership cm
     join player p on p.player_tag = cm.player_tag
     left join sums su on su.player_tag = cm.player_tag
     left join modes mo on mo.player_tag = cm.player_tag
     left join gaps g on g.player_tag = cm.player_tag
     left join streak st on st.player_tag = cm.player_tag
     where cm.clan_tag = $1 and cm.left_observed_at is null`;
  return { text, values };
}
