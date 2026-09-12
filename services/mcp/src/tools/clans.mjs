/** clans_standings · clans_pilot_scores · clans_roster · clans_participation. Conventions
 *  (1.0.0): from/to + days sugar, `applied`, `notes[]` + `docs`,
 *  `verbosity` (replacing summary: true), `live: true` on the roster. */

import {
  normalizeTag,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { isoWeekLabel, isoWeekStart } from "../time.mjs";
import { formatLocal } from "../time.mjs";
import {
  ToolFailure,
  TAG_RULE_HINT,
  MODE_SCHEMA,
  WINDOW_ARGS,
  VERBOSITY,
  entitledClan,
  buildMeta,
  resolveWindow,
  requireEnum,
  appliedBlock,
  notes,
  docsRef,
  liveRead,
  liveStatus,
  livePendingNote,
  notRecordedOrPending,
} from "./shared.mjs";

import {
  LEVEL_EDGES_SQL,
  levelPairsSql,
  PILOT_METHODOLOGY,
  PILOT_NOTES,
  PILOT_DOCS,
} from "../level-curve.mjs";

const CLAN_TAG_SCHEMA = {
  type: "string",
  description: "Clan tag like #J2RGCRVG. Omit to mean your recorded clan.",
};

export const clansTools = {
  clans_standings: {
    description:
      'Clan-relative performance: every open member\'s recorded win rate over a window (default 30 days), ranked, with the clan median: the "am I above average?" tool. Only members meeting min_battles are ranked; the rest are listed below the floor.',
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "Last N days (default 30); or use from/to.",
        },
        ...WINDOW_ARGS,
        min_battles: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 10,
          description: "Decided battles (wins + losses) required to be ranked.",
        },
        mode: MODE_SCHEMA,
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const win = resolveWindow(ctx, args, { defaultDays: 30 });
      const minBattles = Number(args.min_battles ?? 10);
      if (!Number.isInteger(minBattles) || minBattles < 1 || minBattles > 200)
        throw new ToolFailure("bad_request", "min_battles must be 1-200.");
      requireEnum(args.mode, MODE_GROUPS, "mode");
      const params = [clanTag, win.from];
      const clauses = [];
      if (win.to) {
        params.push(win.to);
        clauses.push(`and bp.battle_time < $${params.length}`);
      }
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        clauses.push(`and b.type = any($${params.length})`);
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
           where bp.battle_time >= $2
             ${clauses.join(" ")}
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
        applied: appliedBlock({
          clan_tag: clanTag,
          window: win.echo,
          days: args.days,
          min_battles: minBattles,
          mode: args.mode,
        }),
        ranked_members: ranked.length,
        median_win_rate: median,
        members: ranked,
        below_floor: unranked,
        notes: notes(
          "Covers RECORDED battles only, and capture starts differ per member (elixir_coverage per tag).",
          "win_rate = wins/(wins+losses), draws excluded; percentile = 1 - (rank-1)/ranked_members; members below min_battles are in below_floor without a rank.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  clans_pilot_scores: {
    description:
      "Every open member's Pilot Score in ONE call: each member with >= 30 decided leveled battles scored against the corpus Level Curve over the window (default 90 days), with tenure. Descriptive in-sample residuals, not a skill ranking or proof of improvement.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        days: {
          type: "integer",
          minimum: 7,
          maximum: 365,
          default: 90,
          description: "Window for the curve and the scores, ending now.",
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
          applied: appliedBlock({
            clan_tag: clanTag,
            window: {
              from: new Date(asOf.getTime() - days * 86400_000).toISOString(),
              to: asOf.toISOString(),
              source: args.days !== undefined ? "argument" : "default",
              days,
            },
          }),
          scored_members: rows.length,
          basis: {
            curve_pairs: Number(basisRows[0].pairs),
            curve_bins: Number(basisRows[0].bins),
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
          notes: notes(
            PILOT_NOTES,
            "basis counts describe the curve's volume only; unchanged counts do not identify an unchanged curve.",
          ),
          docs: PILOT_DOCS,
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
      "A clan's roster, yours by default: roles, latest trophies and donations per member, activity recency (last recorded battle and the game's own last-seen), and recent join/leave/role events. verbosity compact answers 'how many members' and 'what is this clan called' with the name, the count and the role breakdown only. live: true asks for a fresh read of ANY clan, recorded or not: served if in hand, otherwise queued while the record answers with live_status pending.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        verbosity: VERBOSITY(
          "name, member count and role counts only; no member list, no events.",
        ),
        live: {
          type: "boolean",
          description:
            "Ask for a read of this clan no older than two minutes; works for a clan nobody records. Served if in hand, otherwise queued while the record answers with live_status pending.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      let clanTag;
      let live = null;
      if (args.live === true) {
        if (args.clan_tag === undefined) {
          clanTag = await entitledClan(ctx.db, ctx.account, undefined);
        } else {
          try {
            clanTag = normalizeTag(String(args.clan_tag));
          } catch {
            throw new ToolFailure(
              "invalid_tag",
              `Invalid clan tag: ${args.clan_tag}`,
              TAG_RULE_HINT,
            );
          }
        }
        // 1.7.0: asynchronous - fresh if in hand, else queued and pending.
        live = await liveRead(ctx, { endpoint: "clan", entityKey: clanTag });
      } else {
        clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      }
      const compact = args.verbosity === "compact";
      const applied = appliedBlock({
        clan_tag: clanTag,
        verbosity: compact ? "compact" : "full",
        live: args.live === true ? true : undefined,
      });

      // The cheap answer to a cheap question (#11): one indexed count.
      if (compact) {
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
        if (!row)
          throw notRecordedOrPending(
            live,
            `${clanTag} is not in the record.`,
            "live: true reads it from the game.",
          );
        return {
          clan_tag: clanTag,
          applied,
          ...(live ? { live_status: liveStatus(live) } : {}),
          name: row.name ?? null,
          member_count: row.member_count ?? 0,
          role_counts: {
            leader: row.leaders ?? 0,
            coLeader: row.co_leaders ?? 0,
            elder: row.elders ?? 0,
            member: row.members ?? 0,
          },
          // The clan's own poll clock, not a bare as_of.
          meta: await buildMeta(ctx.db, ctx.account, clanTag, ["clan"]),
        };
      }

      const clanRow = await ctx.db.query(
        `select name from clan where clan_tag = $1`,
        [clanTag],
      );
      if (!clanRow.rows[0])
        throw notRecordedOrPending(
          live,
          `${clanTag} is not in the record.`,
          "live: true reads it from the game.",
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
        applied,
        ...(live ? { live_status: liveStatus(live) } : {}),
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
          // The GAME's own activity stamp, not ours.
          last_seen_in_game: m.game_last_seen_at?.toISOString() ?? null,
        })),
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
        notes: notes(
          livePendingNote(live),
          "last_seen_in_game is the game's own lastSeen (when the player was last ACTIVE), captured from roster polls; last_recorded_battle only moves when a battle was captured; null means no polled roster has carried them.",
          "A member whose last_seen_in_game predates a race start is left out of that race's roster by the game (see war_current.members_not_in_race).",
          "recent_events are events observed since roster recording began (events_recorded_since), never a complete history.",
        ),
        docs: docsRef("recording", "the-games-own-last-seen"),
        meta: {
          ...(await buildMeta(ctx.db, ctx.account, clanTag, ["clan"])),
          ...(tz ? { timezone_applied: tz } : {}),
        },
      };
    },
  },

  clans_participation: {
    description:
      "Every open member's participation, week by week, in ONE call: per ISO week the battles played, ranked battles and the donation counter at week end; per recorded war week the decks used and each war day's decks (null where the day was not polled); per member the observed join, whether that join predates the recording, the last recorded battle and days since it. Facts with their windows and the recording horizon, no rating or ranking: the raw material for any clan's own participation rules. weeks 1 to 8, default 5; the current week is partial and says so. verbosity compact drops the per-day war arrays and points.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        weeks: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          default: 5,
          description:
            "How many ISO weeks back, the current partial week included.",
        },
        verbosity: VERBOSITY(
          "war_decks only; no per-day arrays, no war_points.",
        ),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const compact = args.verbosity === "compact";
      const weeks = Number(args.weeks ?? 5);
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8)
        throw new ToolFailure("bad_request", "weeks must be 1-8.");
      const clanRow = await ctx.db.query(
        `select c.name,
                (select min(joined_observed_at) from clan_membership where clan_tag = c.clan_tag) as first_roster_observed_at,
                (select min(created_at) from recording
                  where subject_type = 'clan' and subject_tag = c.clan_tag and status = 'active') as recording_active_since
         from clan c where c.clan_tag = $1`,
        [clanTag],
      );
      const clan = clanRow.rows[0];
      if (!clan)
        throw new ToolFailure(
          "not_recorded",
          `${clanTag} is not in the record.`,
          "elixir_track_clan({ clan_tag }) starts recording it.",
        );
      const now = new Date();
      const thisWeekStart = isoWeekStart(now);
      const from = new Date(
        thisWeekStart.getTime() - (weeks - 1) * 7 * 86400_000,
      );
      const weekBounds = [];
      for (let i = 0; i < weeks; i += 1) {
        const start = new Date(from.getTime() + i * 7 * 86400_000);
        const end = new Date(start.getTime() + 7 * 86400_000);
        weekBounds.push({
          iso_week: isoWeekLabel(start),
          from: start.toISOString(),
          to: end.toISOString(),
          complete: end <= now,
        });
      }
      const members = await ctx.db.query(
        `select cm.player_tag, p.name, cm.role, cm.joined_observed_at,
                (select max(b.battle_time) from battle_participant bp
                 join battle b on b.battle_id = bp.battle_id
                 where bp.player_tag = cm.player_tag) as last_battle
         from clan_membership cm
         join player p on p.player_tag = cm.player_tag
         where cm.clan_tag = $1 and cm.left_observed_at is null
         order by cm.player_tag`,
        [clanTag],
      );
      const tags = members.rows.map((m) => m.player_tag);
      // Battles per member per ISO week, ranked counted beside all.
      const battles = await ctx.db.query(
        `select bp.player_tag, date_trunc('week', bp.battle_time) as week_start,
                count(*)::int as battles,
                count(*) filter (where b.type = any($3))::int as ranked_battles
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where bp.player_tag = any($1) and bp.battle_time >= $2
         group by bp.player_tag, date_trunc('week', bp.battle_time)`,
        [tags, from, typesForModeGroup("ranked")],
      );
      // The donation counter at the end of each ISO week: the largest
      // daily snapshot inside it (the counter resets Mondays).
      const donations = await ctx.db.query(
        `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                max(donations)::int as donations, count(*)::int as snapshots
         from player_snapshot_daily
         where player_tag = any($1) and snapshot_kind = 'daily' and snapshot_date >= $2::date
         group by player_tag, date_trunc('week', snapshot_date::timestamp)`,
        [tags, from],
      );
      // War weeks the clan recorded inside the window, with each member's
      // decks and, where polled, each war day's decks.
      const warWeeks = await ctx.db.query(
        `select w.season_id, w.section_index, w.is_colosseum,
                w.started_observed_at, w.finished_observed_at
         from war_week w
         where w.clan_tag = $1
           and coalesce(w.finished_observed_at, w.started_observed_at, now()) >= $2
         order by w.season_id, w.section_index`,
        [clanTag, from],
      );
      const participation = await ctx.db.query(
        `select wp.player_tag, wp.season_id, wp.section_index, wp.decks_used, wp.points
         from war_participation wp
         where wp.clan_tag = $1 and wp.player_tag = any($2)
           and (wp.season_id, wp.section_index) in (
             select w.season_id, w.section_index from war_week w
             where w.clan_tag = $1
               and coalesce(w.finished_observed_at, w.started_observed_at, now()) >= $3)`,
        [clanTag, tags, from],
      );
      const attendance = await ctx.db.query(
        `select ad.player_tag, ad.season_id, ad.section_index, ad.war_day,
                ad.decks_used_today, ad.finalized
         from war_attendance_day ad
         where ad.clan_tag = $1 and ad.player_tag = any($2)
           and (ad.season_id, ad.section_index) in (
             select w.season_id, w.section_index from war_week w
             where w.clan_tag = $1
               and coalesce(w.finished_observed_at, w.started_observed_at, now()) >= $3)`,
        [clanTag, tags, from],
      );
      const battledDays = await ctx.db.query(
        `select bp.player_tag, b.season_id, b.section_index, b.war_day, count(*)::int as war_battles
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where bp.player_tag = any($1) and bp.clan_tag = $2
           and b.war_day is not null and bp.battle_time >= $3
         group by bp.player_tag, b.season_id, b.section_index, b.war_day`,
        [tags, clanTag, from],
      );

      const keyWeek = (d) => new Date(d).toISOString();
      const byMemberWeek = new Map();
      for (const r of battles.rows)
        byMemberWeek.set(`${r.player_tag}|${keyWeek(r.week_start)}`, r);
      const donationByWeek = new Map();
      for (const r of donations.rows)
        donationByWeek.set(`${r.player_tag}|${keyWeek(r.week_start)}`, r);
      const partByKey = new Map();
      for (const r of participation.rows)
        partByKey.set(`${r.player_tag}|${r.season_id}|${r.section_index}`, r);
      const daysByKey = new Map();
      for (const r of attendance.rows) {
        const k = `${r.player_tag}|${r.season_id}|${r.section_index}`;
        if (!daysByKey.has(k)) daysByKey.set(k, new Map());
        daysByKey.get(k).set(r.war_day, {
          decks_used_today: r.decks_used_today,
          finalized: r.finalized,
        });
      }
      const battledByKey = new Map();
      for (const r of battledDays.rows) {
        const k = `${r.player_tag}|${r.season_id}|${r.section_index}`;
        if (!battledByKey.has(k)) battledByKey.set(k, new Map());
        battledByKey.get(k).set(r.war_day, r.war_battles);
      }
      const firstRoster = clan.first_roster_observed_at
        ? new Date(clan.first_roster_observed_at)
        : null;
      const out = members.rows.map((m) => {
        const joined = m.joined_observed_at
          ? new Date(m.joined_observed_at)
          : null;
        // A member already present at the first roster poll joined at or
        // before it; their tenure is a lower bound, not a fact.
        const tenureKnown = Boolean(
          joined && firstRoster && joined.getTime() > firstRoster.getTime(),
        );
        const last = m.last_battle ? new Date(m.last_battle) : null;
        return {
          player_tag: m.player_tag,
          name: m.name,
          role: m.role,
          joined_observed_at: joined?.toISOString() ?? null,
          tenure_known: tenureKnown,
          days_in_clan_observed: joined
            ? Math.floor((now - joined) / 86400_000)
            : null,
          last_battle_time: last?.toISOString() ?? null,
          days_since_battle: last
            ? Number(((now - last) / 86400_000).toFixed(2))
            : null,
          // Columns aligned to the top-level `weeks` and `war_weeks` (one
          // entry each, in order): a full clan over eight weeks stays under
          // the response cap this way and not as rows.
          battles: weekBounds.map(
            (w) => byMemberWeek.get(`${m.player_tag}|${w.from}`)?.battles ?? 0,
          ),
          ranked_battles: weekBounds.map(
            (w) =>
              byMemberWeek.get(`${m.player_tag}|${w.from}`)?.ranked_battles ??
              0,
          ),
          donations: weekBounds.map(
            (w) =>
              donationByWeek.get(`${m.player_tag}|${w.from}`)?.donations ??
              null,
          ),
          war_decks: warWeeks.rows.map((w) => {
            const k = `${m.player_tag}|${w.season_id}|${w.section_index}`;
            return (
              partByKey.get(k)?.decks_used ??
              (daysByKey.get(k) || battledByKey.get(k) ? 0 : null)
            );
          }),
          ...(compact
            ? {}
            : {
                war_points: warWeeks.rows.map(
                  (w) =>
                    partByKey.get(
                      `${m.player_tag}|${w.season_id}|${w.section_index}`,
                    )?.points ?? null,
                ),
                war_decks_by_day: warWeeks.rows.map((w) => {
                  const days = daysByKey.get(
                    `${m.player_tag}|${w.season_id}|${w.section_index}`,
                  );
                  return [1, 2, 3, 4].map(
                    (day) => days?.get(day)?.decks_used_today ?? null,
                  );
                }),
                war_battles_by_day: warWeeks.rows.map((w) => {
                  const battled = battledByKey.get(
                    `${m.player_tag}|${w.season_id}|${w.section_index}`,
                  );
                  return [1, 2, 3, 4].map((day) => battled?.get(day) ?? 0);
                }),
              }),
        };
      });
      return {
        clan_tag: clanTag,
        name: clan.name ?? null,
        applied: appliedBlock({
          clan_tag: clanTag,
          weeks,
          verbosity: compact ? "compact" : "full",
          window: {
            from: from.toISOString(),
            to: null,
            source: "argument",
          },
        }),
        recording_active_since:
          clan.recording_active_since?.toISOString?.() ?? null,
        first_roster_observed_at: firstRoster?.toISOString() ?? null,
        weeks: weekBounds,
        war_weeks: warWeeks.rows.map((w) => ({
          season_id: w.season_id,
          section_index: w.section_index,
          is_colosseum: w.is_colosseum,
          started_observed_at: w.started_observed_at?.toISOString() ?? null,
          finished_observed_at: w.finished_observed_at?.toISOString() ?? null,
        })),
        member_count: out.length,
        members: out,
        notes: notes(
          "ISO weeks run Monday 00:00 UTC to Monday; war weeks run on the game's own grid and are listed separately with their observed bounds.",
          "donations is the game's weekly counter as of the last daily snapshot in that ISO week (it resets Mondays); null means no snapshot fell in the week.",
          "Per-member columns align to the top-level weeks and war_weeks, one entry each in order; war_decks_by_day holds war days 1-4 from roster polls during each day, null where that day was not polled, and war_battles_by_day the member's recorded war battles per day.",
          "tenure_known is false for a member already present at the first roster poll: days_in_clan_observed is then a lower bound.",
          "Counts cover RECORDED battles only; elixir_coverage per tag says how complete a member's log is.",
        ),
        docs: docsRef("recording", "participation-by-week"),
        meta: await buildMeta(ctx.db, ctx.account, clanTag, ["clan"]),
      };
    },
  },
};
