/** clans_standings · clans_pilot_scores · clans_roster — moved verbatim from the
 *  single-file registry (review item 8). */

import {
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { formatLocal } from "../time.mjs";
import { ToolFailure, entitledClan } from "./shared.mjs";

import {
  LEVEL_EDGES_SQL,
  levelPairsSql,
  PILOT_METHODOLOGY,
  PILOT_NOTE,
} from "../level-curve.mjs";

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
      "Every open member's Pilot Score in ONE call (agent feedback #1: ranking a clan took 18 battles_levels calls). Scores each member with >= 30 decided leveled battles against the corpus Level Curve; includes tenure. Descriptive in-sample residuals, not a skill ranking or proof of improvement.",
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
      const EDGES = LEVEL_EDGES_SQL;
      await ctx.db.query("begin");
      try {
        await ctx.db.query(levelPairsSql(), [`${days} days`]);
        const { rows } = await ctx.db.query(
          `with curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from lv_pairs group by bin having count(*) >= ${PILOT_METHODOLOGY.curve_min_observations})
           select cm.player_tag, pl.name, pl.years_played,
                  count(p.*)::int as n,
                  round(avg(p.gap)::numeric, 2) as mean_gap,
                  round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_win_rate,
                  round(avg(c.wr)::numeric, 3) as expected_from_levels,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score,
                  round((0.5 / sqrt(greatest(count(p.*), 1)))::numeric, 3) as standard_error
           from clan_membership cm
           join player pl on pl.player_tag = cm.player_tag
           join lv_pairs p on p.player_tag = cm.player_tag
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where cm.clan_tag = $1 and cm.left_observed_at is null
           group by cm.player_tag, pl.name, pl.years_played
           having count(p.*) >= ${PILOT_METHODOLOGY.player_min_battles}
           order by (avg((p.outcome = 'win')::int) - avg(c.wr)) desc`,
          [clanTag],
        );
        // Aggregate volume context only: identical counts do not identify
        // the observations or rates in a fitted curve.
        const { rows: basisRows } = await ctx.db.query(
          `select (select count(*)::int from lv_pairs) as pairs,
                  (select count(*)::int from (
                     select 1 from lv_pairs
                     group by width_bucket(gap, ${EDGES})
                     having count(*) >= ${PILOT_METHODOLOGY.curve_min_observations}) b) as bins`,
        );
        await ctx.db.query("commit");
        const asOf = new Date();
        return {
          clan_tag: clanTag,
          window_days: days,
          scored_members: rows.length,
          basis: {
            curve_pairs: Number(basisRows[0].pairs),
            curve_bins: Number(basisRows[0].bins),
            window_from: new Date(
              asOf.getTime() - days * 86400_000,
            ).toISOString(),
            window_to: asOf.toISOString(),
          },
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
          methodology: PILOT_METHODOLOGY,
          note: PILOT_NOTE,
          meta: responseMeta({ as_of: asOf.toISOString() }),
        };
      } catch (err) {
        await ctx.db.query("rollback").catch(() => {});
        throw err;
      }
    },
  },

  clans_roster: {
    description:
      'A recorded clan\'s roster (defaults to YOUR clan): roles, latest trophies/donations per member, activity recency (last recorded battle), and recent join/leave/role events. Any recorded clan works - universal reads. For "how many members" or "what is this clan called", pass summary: true and get the name, the count and the role breakdown without the member list.',
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        summary: {
          type: "boolean",
          default: false,
          description:
            "Name, member count and role counts only - no member list, no events.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);

      // The cheap answer to a cheap question. Reading a member count used to
      // cost the whole roster: 48 member objects, each with a correlated
      // last-battle scan, plus twenty clan events. Reported 2026-09-09 (#11)
      // by an agent that pulled all of it to say how many people were in a
      // clan. This is one indexed count, and it saves the server the work as
      // well as the caller the payload.
      if (args.summary === true) {
        const { rows } = await ctx.db.query(
          `select c.name,
                  count(cm.player_tag)::int as member_count,
                  count(*) filter (where cm.role = 'leader')::int as leaders,
                  count(*) filter (where cm.role = 'coLeader')::int as co_leaders,
                  count(*) filter (where cm.role = 'elder')::int as elders,
                  count(*) filter (where cm.role = 'member')::int as members
           from clan c
           left join clan_membership cm
             on cm.clan_tag = c.clan_tag and cm.left_observed_at is null
           where c.clan_tag = $1
           group by c.name`,
          [clanTag],
        );
        const row = rows[0];
        return {
          clan_tag: clanTag,
          name: row?.name ?? null,
          member_count: row?.member_count ?? 0,
          role_counts: {
            leader: row?.leaders ?? 0,
            coLeader: row?.co_leaders ?? 0,
            elder: row?.elders ?? 0,
            member: row?.members ?? 0,
          },
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }

      // One client is one connection: pg queues concurrent queries on it
      // anyway, so Promise.all bought no parallelism and only tripped the
      // deprecation (docs/ENGINEERING.md: one client, one query at a time).
      const clanRow = await ctx.db.query(
        `select name from clan where clan_tag = $1`,
        [clanTag],
      );
      const roster = await ctx.db.query(
        `select cm.player_tag, cm.role, cm.joined_observed_at, p.name,
                p.game_last_seen_at,
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
      );
      const events = await ctx.db.query(
        `select event_type, timing, window_end, payload from clan_event
         where clan_tag = $1 order by event_id desc limit 20`,
        [clanTag],
      );
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
          // The GAME's own activity stamp, not ours. last_recorded_battle
          // only moves when somebody plays a battle we captured; this moves
          // whenever they open the game, so a member who is present but not
          // battling is distinguishable from one who is simply gone.
          last_seen_in_game: m.game_last_seen_at?.toISOString() ?? null,
        })),
        // An empty event list means "none observed SINCE ROSTER RECORDING
        // BEGAN", never "no joins/leaves ever" (round-3: a leader would
        // have wrongly concluded no departures).
        member_note:
          "last_seen_in_game is Clash Royale's own lastSeen for that player, captured from this clan's roster polls: when they were last ACTIVE, as against last_recorded_battle which only moves when a battle was captured. It is the predicate the game itself uses to seed a river race roster, so a member whose last_seen_in_game predates the race start will be missing from war_current.participants. Null means we have never polled a clan roster carrying them.",
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
