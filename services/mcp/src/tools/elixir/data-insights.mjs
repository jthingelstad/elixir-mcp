import { responseMeta } from "@elixir-mcp/contracts";
import { docsRef, notes } from "../shared.mjs";

export const elixir_data_insights = {
  description:
    "What the service holds: players, battles and their time span, snapshots, war weeks, recorded clans and players, and API observations. The transparency view of the whole corpus, not just your slice.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler(ctx) {
    const q = (sql) => async () => (await ctx.db.query(sql)).rows[0];
    const counts = [];
    for (const step of [
      q(`select count(*)::int as n from player`),
      q(
        `select count(*)::int as n, min(battle_time) as first, max(battle_time) as last from battle`,
      ),
      q(`select count(*)::int as n from player_snapshot_daily`),
      q(`select count(*)::int as n from war_week`),
      // Recorded players along the axis a corpus-sizing question needs
      // (feedback #18).
      q(`with direct as (
               select subject_tag as player_tag from recording
               where subject_type = 'player' and status = 'active'),
             via as (
               select cm.player_tag
               from recording r
               join clan_membership cm on cm.clan_tag = r.subject_tag
                 and cm.left_observed_at is null
               where r.subject_type = 'clan' and r.status = 'active'
                 and r.scope = 'comprehensive')
             select (select count(*) from direct)::int as direct,
                    (select count(distinct player_tag) from via
                     where player_tag not in (select player_tag from direct))::int as via_clans,
                    (select count(distinct player_tag) from
                      (select player_tag from direct union select player_tag from via) u)::int as total,
                    (select count(*) from recording
                     where subject_type = 'clan' and status = 'active')::int as clans,
                    (select count(*) from recording
                     where subject_type = 'clan' and status = 'active'
                       and scope = 'activity')::int as clans_activity,
                    (select count(*) from recording
                     where subject_type = 'clan' and status = 'active'
                       and scope = 'comprehensive')::int as clans_comprehensive`),
      q(`select count(*)::int as n from api_receipt`),
      // Players with a PROFILE snapshot: since 0127 the roster writes
      // rows for every member of every polled clan, so the count reads
      // profile_observed_at (Phase 3 verification, 2026-09-18).
      q(`select (select count(distinct player_tag) from player_snapshot_daily
                     where profile_observed_at is not null)::int as with_snapshot,
                    (select count(distinct player_tag) from player_badge)::int as with_badges,
                    (select count(distinct player_tag) from player_snapshot_daily
                     where profile_observed_at is not null
                       and snapshot_date >= current_date - 7)::int as with_snapshot_last_7_days,
                    (select max(snapshot_date)::text from player_snapshot_daily) as newest_snapshot`),
      async () =>
        (
          await ctx.db.query(
            `select r.subject_tag as clan_tag, c.name, r.scope as scope,
                        (select count(*) from clan_membership cm
                         where cm.clan_tag = r.subject_tag and cm.left_observed_at is null)::int as members,
                        r.created_at
                 from recording r left join clan c on c.clan_tag = r.subject_tag
                 where r.subject_type = 'clan' and r.status = 'active'
                 order by r.scope desc, members desc, r.subject_tag`,
          )
        ).rows,
    ])
      counts.push(await step());
    const [players, battles, snaps, weeks, recs, receipts, profiles, clans] =
      counts;
    return {
      players_observed: players.n,
      battles: {
        recorded: battles.n,
        first: battles.first?.toISOString() ?? null,
        last: battles.last?.toISOString() ?? null,
      },
      daily_snapshots: snaps.n,
      war_weeks: weeks.n,
      recorded_players: {
        direct: recs.direct,
        via_clans: recs.via_clans,
        total: recs.total,
      },
      profiles: {
        players_with_snapshot: profiles.with_snapshot,
        players_with_badges: profiles.with_badges,
        players_with_snapshot_last_7_days: profiles.with_snapshot_last_7_days,
        newest_snapshot: profiles.newest_snapshot,
      },
      active_recordings: {
        clans: recs.clans,
        clans_by_scope: {
          activity: recs.clans_activity,
          comprehensive: recs.clans_comprehensive,
        },
        players: recs.direct,
      },
      recorded_clans: clans.map((c) => ({
        clan_tag: c.clan_tag,
        name: c.name,
        scope: c.scope,
        members: c.members,
        recorded_since: c.created_at?.toISOString() ?? null,
      })),
      api_observations: receipts.n,
      notes: notes(
        "players_observed counts every tag ever seen in a recorded battle or roster, far more than the recorded set.",
        "recorded_players.direct are players tracked on their own; via_clans are current members of comprehensively recorded clans; total is the population profile and badge questions can draw on.",
        "Raw payload history is archived durably to S3 beyond these counts.",
      ),
      docs: docsRef("recording", "one-recording-many-reasons"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
