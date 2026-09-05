/** clans_standings · clans_pilot_scores · clans_roster — moved verbatim from the
 *  single-file registry (review item 8). */

import {
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { formatLocal } from "../time.mjs";
import { ToolFailure, entitledClan } from "./shared.mjs";

export const clansTools = {
  clans_standings: {
    description:
      'Clan-relative performance: every open member\'s recorded win rate over a window, ranked, with the clan median — the "am I above average?" tool. Percentile = 1 - (rank-1)/ranked_members. Only members meeting min_battles are ranked; the rest are listed unranked.',
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          default: 30,
          description: "Window: recorded battles from the last N days.",
        },
        min_battles: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 10,
          description: "Decided battles (wins+losses) required to be ranked.",
        },
        mode: {
          type: "string",
          enum: MODE_GROUPS,
          description: "Restrict to one mode group (e.g. ladder, war).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const days = Number(args.days ?? 30);
      const minBattles = Number(args.min_battles ?? 10);
      if (!Number.isInteger(days) || days < 1 || days > 90)
        throw new ToolFailure("bad_request", "days must be 1-90.");
      if (!Number.isInteger(minBattles) || minBattles < 1 || minBattles > 200)
        throw new ToolFailure("bad_request", "min_battles must be 1-200.");
      const params = [clanTag, `${days} days`];
      let typeClause = "";
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        typeClause = `and b.type = any($${params.length})`;
      }
      // One grouped pass instead of a per-member lateral scan (audit
      // census: 2.5s avg). The subquery keeps roster rows for members
      // with zero matching battles.
      const { rows } = await ctx.db.query(
        `select cm.player_tag, p.name, p.years_played,
                count(s.battle_id)::int as battles,
                count(*) filter (where s.outcome = 'win')::int as wins,
                count(*) filter (where s.outcome = 'loss')::int as losses,
                count(*) filter (where s.outcome = 'draw')::int as draws
         from clan_membership cm
         join player p on p.player_tag = cm.player_tag
         left join (
           select bp.player_tag, bp.battle_id, bp.outcome
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           where bp.battle_time > now() - $2::interval
             ${typeClause}
         ) s on s.player_tag = cm.player_tag
         where cm.clan_tag = $1 and cm.left_observed_at is null
         group by cm.player_tag, p.name, p.years_played`,
        params,
      );
      const withRate = rows.map((r) => ({
        player_tag: r.player_tag,
        name: r.name,
        years_played: r.years_played,
        battles: r.battles,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        win_rate:
          r.wins + r.losses > 0
            ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
            : null,
      }));
      const ranked = withRate
        .filter((m) => m.wins + m.losses >= minBattles)
        .sort((a, z) => z.win_rate - a.win_rate || z.battles - a.battles)
        .map((m, i) => ({ ...m, rank: i + 1 }));
      const unranked = withRate
        .filter((m) => m.wins + m.losses < minBattles)
        .sort((a, z) => z.battles - a.battles);
      const rates = ranked.map((m) => m.win_rate).sort((a, z) => a - z);
      const median =
        rates.length > 0
          ? Number(
              (rates.length % 2
                ? rates[(rates.length - 1) / 2]
                : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2
              ).toFixed(3),
            )
          : null;
      return {
        clan_tag: clanTag,
        window_days: days,
        basis: `open members with >= ${minBattles} decided recorded battles in the window${args.mode ? ` (mode: ${args.mode})` : ""}`,
        ranked_members: ranked.length,
        median_win_rate: median,
        members: ranked,
        below_floor: unranked,
        note: "Covers RECORDED battles only — capture starts differ per member (elixir_coverage per tag). win_rate = wins/(wins+losses), draws excluded. Members below min_battles appear in below_floor without a rank.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  clans_pilot_scores: {
    description:
      "Every open member's Pilot Score in ONE call (agent feedback #1: ranking a clan took 18 battles_levels calls). Scores each member with >= 30 decided leveled battles against the corpus Level Curve; includes tenure. Wins their card levels can't explain, clan-wide.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        days: {
          type: "integer",
          minimum: 7,
          maximum: 365,
          default: 90,
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const days = Number(args.days ?? 90);
      if (!Number.isInteger(days) || days < 7 || days > 365)
        throw new ToolFailure("bad_request", "days must be 7-365.");
      const EDGES =
        "array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]";
      await ctx.db.query("begin");
      try {
        await ctx.db.query(
          `create temp table cps_pairs on commit drop as
           with sides as (
             select bp.battle_id, bp.player_tag, bp.outcome, bp.deck_avg_level as lvl
             from battle_participant bp
             join battle b on b.battle_id = bp.battle_id
             where bp.deck_avg_level is not null and b.type_class = 'pvp'
               and bp.outcome in ('win','loss')
               and b.battle_time > now() - $1::interval),
           duos as (select battle_id from sides group by battle_id having count(*) = 2)
           select a.player_tag, a.outcome, a.lvl - o.lvl as gap
           from sides a
           join sides o on o.battle_id = a.battle_id and o.player_tag <> a.player_tag
           where a.battle_id in (select battle_id from duos)`,
          [`${days} days`],
        );
        const { rows } = await ctx.db.query(
          `with curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from cps_pairs group by bin having count(*) >= 200)
           select cm.player_tag, pl.name, pl.years_played,
                  count(p.*)::int as n,
                  round(avg(p.gap)::numeric, 2) as mean_gap,
                  round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_win_rate,
                  round(avg(c.wr)::numeric, 3) as expected_from_levels,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score,
                  round((0.5 / sqrt(greatest(count(p.*), 1)))::numeric, 3) as standard_error
           from clan_membership cm
           join player pl on pl.player_tag = cm.player_tag
           join cps_pairs p on p.player_tag = cm.player_tag
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where cm.clan_tag = $1 and cm.left_observed_at is null
           group by cm.player_tag, pl.name, pl.years_played
           having count(p.*) >= 30
           order by (avg((p.outcome = 'win')::int) - avg(c.wr)) desc`,
          [clanTag],
        );
        await ctx.db.query("commit");
        return {
          clan_tag: clanTag,
          window_days: days,
          scored_members: rows.length,
          members: rows.map((r, i) => ({
            rank: i + 1,
            player_tag: r.player_tag,
            name: r.name,
            years_played: r.years_played,
            n: r.n,
            mean_gap: Number(r.mean_gap),
            actual_win_rate: Number(r.actual_win_rate),
            expected_from_levels: Number(r.expected_from_levels),
            pilot_score: Number(r.pilot_score),
            standard_error: Number(r.standard_error),
          })),
          note: "pilot_score = actual minus level-expected win rate (wins card levels can't explain). Members below 30 decided leveled battles in the window are not scored. Scores embed experience and band - compare trends or similar tenures, not raw scores across careers. Deeper single-player detail (cohort percentile, monthly trend): battles_levels.",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      } catch (err) {
        await ctx.db.query("rollback").catch(() => {});
        throw err;
      }
    },
  },

  clans_roster: {
    description:
      "A recorded clan's roster (defaults to YOUR clan): roles, latest trophies/donations per member, activity recency (last recorded battle), and recent join/leave/role events. Any recorded clan works - universal reads.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const [clanRow, roster, events] = await Promise.all([
        ctx.db.query(`select name from clan where clan_tag = $1`, [clanTag]),
        ctx.db.query(
          `select cm.player_tag, cm.role, cm.joined_observed_at, p.name,
                  nn.nickname,
                  s.trophies, s.donations,
                  (select max(b.battle_time) from battle_participant bp
                   join battle b on b.battle_id = bp.battle_id
                   where bp.player_tag = cm.player_tag) as last_battle
           from clan_membership cm
           join player p on p.player_tag = cm.player_tag
           left join player_nickname nn on nn.account_id = $2
             and nn.player_tag = cm.player_tag
           left join lateral (
             select trophies, donations from player_snapshot_daily
             where player_tag = cm.player_tag order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where cm.clan_tag = $1 and cm.left_observed_at is null
           order by cm.role desc, s.trophies desc nulls last`,
          [clanTag, ctx.account.accountId],
        ),
        ctx.db.query(
          `select event_type, timing, window_end, payload from clan_event
           where clan_tag = $1 order by event_id desc limit 20`,
          [clanTag],
        ),
      ]);
      const tz = ctx.account.timezone;
      return {
        clan_tag: clanTag,
        name: clanRow.rows[0]?.name ?? null,
        member_count: roster.rows.length,
        members: roster.rows.map((m) => ({
          player_tag: m.player_tag,
          name: m.name,
          ...(m.nickname ? { nickname: m.nickname } : {}),
          role: m.role,
          trophies: m.trophies,
          donations_this_week: m.donations,
          first_observed_in_clan: m.joined_observed_at?.toISOString() ?? null,
          last_recorded_battle: m.last_battle?.toISOString() ?? null,
        })),
        // An empty event list means "none observed SINCE ROSTER RECORDING
        // BEGAN", never "no joins/leaves ever" (round-3: a leader would
        // have wrongly concluded no departures).
        events_recorded_since:
          roster.rows
            .map((m) => m.joined_observed_at)
            .filter(Boolean)
            .sort((a, b) => a - b)[0]
            ?.toISOString() ?? null,
        recent_events: events.rows.map((e) => ({
          type: e.event_type,
          at: e.window_end.toISOString(),
          ...(tz ? { at_local: formatLocal(e.window_end, tz) } : {}),
          detail: e.payload,
        })),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(ctx.account.timezone
            ? { timezone_applied: ctx.account.timezone }
            : {}),
        }),
      };
    },
  },
};
