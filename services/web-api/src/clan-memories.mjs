import { currentClanPlayersSql } from "@elixir-mcp/claims";

/** Short collective stories for this clan's authorized feed. Both weekly
 * ranks come from closed race logs. Reading this never writes an event. */
export async function clanMemories(db, accountId, clan, now) {
  const stories = [];
  const {
    rows: [{ ranks, donations, members, runs }],
  } = await db.query(
    `with roster as materialized (${currentClanPlayersSql("$3")}),
    ranks as (
    select w.season_id,w.section_index,r.participant_name,r.participant_clan_tag,home.rank as ours,r.rank as theirs
    from war_week w join war_week prev on prev.clan_tag=w.clan_tag and prev.season_id=w.season_id
      and prev.section_index=w.section_index-1 and prev.closed_at<w.closed_at
    join war_week_clan home on home.clan_tag=w.clan_tag and home.season_id=w.season_id and home.section_index=w.section_index
    join war_week_clan r on r.clan_tag=w.clan_tag and r.season_id=w.season_id and r.section_index=w.section_index
    join war_week_clan old_home on old_home.clan_tag=prev.clan_tag and old_home.season_id=prev.season_id
      and old_home.section_index=prev.section_index and old_home.participant_clan_tag=prev.clan_tag
    join war_week_clan rival on rival.clan_tag=prev.clan_tag and rival.season_id=prev.season_id
      and rival.section_index=prev.section_index and rival.participant_clan_tag=r.participant_clan_tag
    where w.clan_tag=$1 and w.closed_at between $2::timestamptz-interval '7 days' and $2
      and home.participant_clan_tag=w.clan_tag and r.rank>home.rank and home.rank>0
      and rival.rank<old_home.rank and rival.rank>0 order by w.closed_at desc,r.rank,r.participant_clan_tag limit 3),
    donations as (
    select donations_per_week from clan_snapshot_daily
    where clan_tag=$1 and snapshot_kind='pre_reset' and observed_at between $2::timestamptz-interval '7 days' and $2
    and donations_per_week>=100 order by observed_at desc limit 1),
    members as (
    select distinct p.player_tag,coalesce(p.name,p.player_tag) as name
    from war_week w join war_participation wp using(clan_tag,season_id,section_index)
    join roster p on p.player_tag=wp.player_tag and p.clan_tag=w.clan_tag
    join clan_membership cm on cm.player_tag=p.player_tag and cm.clan_tag=w.clan_tag and cm.left_observed_at is null and not cm.baseline
    where w.clan_tag=$1 and w.closed_at between $2::timestamptz-interval '7 days' and $2
      and wp.decks_used>0 and (
        cm.joined_observed_at<=w.closed_at-interval '7 days'
        or exists(select 1 from battle_participant bp where bp.player_tag=wp.player_tag
          and bp.clan_tag=w.clan_tag and bp.type in ('riverRacePvP','riverRaceDuel','riverRaceDuelColosseum')
          and bp.battle_time>=greatest(cm.joined_observed_at,w.closed_at-interval '4 days')
          and bp.battle_time<w.closed_at))
      and not exists(select 1 from war_participation older join war_week ow using(clan_tag,season_id,section_index)
        where older.player_tag=wp.player_tag and older.clan_tag=wp.clan_tag and older.decks_used>0
        and (ow.season_id,ow.section_index)<(w.season_id,w.section_index)
        and coalesce(ow.closed_at,ow.finished_observed_at,w.started_observed_at)>=cm.joined_observed_at)
    order by name,p.player_tag limit 5),
    runs as (
    select games.tournament_tag,array_agg(coalesce(r.name,r.player_tag) order by coalesce(r.name,r.player_tag),r.player_tag) as names
    from roster r cross join lateral (
      select distinct b.tournament_tag from battle_participant bp join battle b using(battle_id)
      where bp.player_tag=r.player_tag and bp.clan_tag=r.clan_tag and bp.type='tournament' and b.tournament_tag is not null
        and bp.battle_time between $2::timestamptz-interval '7 days' and $2) games
    where r.clan_tag=$1 group by games.tournament_tag having count(distinct r.player_tag)>=2
    order by count(distinct r.player_tag) desc,games.tournament_tag limit 3)
    select coalesce((select jsonb_agg(ranks order by season_id desc,section_index desc,theirs,participant_clan_tag) from ranks),'[]') as ranks,
           (select to_jsonb(donations) from donations) as donations,
           coalesce((select jsonb_agg(members order by name,player_tag) from members),'[]') as members,
           coalesce((select jsonb_agg(runs order by cardinality(names) desc,tournament_tag) from runs),'[]') as runs`,
    [clan, new Date(now), accountId],
  );
  for (const r of ranks)
    stories.push(
      `Finished ahead of ${r.participant_name ?? r.participant_clan_tag} after they placed ahead of the clan in the previous war week. This week’s places were #${r.ours} and #${r.theirs}.`,
    );
  if (donations)
    stories.push(
      `The clan reached ${donations.donations_per_week.toLocaleString("en-US")} donations before the weekly reset.`,
    );
  if (members.length)
    stories.push(
      `First recorded war week since joining for ${members.map((m) => m.name).join(", ")}.`,
    );
  for (const r of runs)
    stories.push(
      `${r.names.join(", ")} played in tournament ${r.tournament_tag} this week.`,
    );
  return stories;
}
