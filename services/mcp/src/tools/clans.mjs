/** clans_standings · clans_roster · clans_participation. Conventions
 *  (1.0.0): from/to + days sugar, `applied`, `notes[]` + `docs`,
 *  `verbosity` (replacing summary: true), `live: true` on the roster. */

import {
  normalizeTag,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { isoWeekLabel, isoWeekStart } from "../time.mjs";
import { MEMBERS_SQL, participationQueries } from "../participation-sql.mjs";
import { standingsQuery } from "../standings-sql.mjs";
import { hydrateClanEvents, CLAN_EVENT_COLUMNS } from "../event-payloads.mjs";
import { formatLocal } from "../time.mjs";
import { captureByPlayer, underCaptureNote } from "../coverage.mjs";
import {
  ToolFailure,
  TAG_RULE_HINT,
  MODE_SCHEMA,
  WINDOW_ARGS,
  VERBOSITY,
  entitledClan,
  buildMeta,
  resolveSeasonWindow,
  SEASON_ARG_SCHEMA,
  seasonFieldsForInstants,
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
  modeSplit,
  comparabilityNote,
  coverageBasis,
  coverageBasisNote,
} from "../controls.mjs";
import {
  weekKey,
  finishWarDays,
  decksAfterFinish,
  scoringDecks,
} from "./war/common.mjs";

const CLAN_TAG_SCHEMA = {
  type: "string",
  description: "Clan tag like #J2RGCRVG. Omit to mean your recorded clan.",
};

/** The war weeks war_scoring_decks rides on (full verbosity): the
 *  default window; past it the response outgrows the result cap. */
const SCORING_DECKS_WEEKS = 6;

/** Members on today's roster who joined inside the window, with the
 *  battles they played in it before joining (Gym #237: a member who
 *  joined on 09-23 ranked 14th for the week before with 19 battles, all
 *  played for another clan). The rows are today's roster; the note says
 *  who is counted from before they belonged. */
async function joinedMidWindowNote(db, clanTag, fromMs, toMs) {
  if (fromMs === null || fromMs === undefined) return null;
  const { rows } = await db.query(
    `select cm.player_tag, p.name, cm.joined_observed_at,
            (select count(*)::int from battle_participant bp
              where bp.player_tag = cm.player_tag
                and bp.battle_time >= $2 and bp.battle_time < least(cm.joined_observed_at, $3)
                -- Not a rejoiner's earlier battles in this clan (Gym #264).
                and bp.clan_tag is distinct from cm.clan_tag) as before_join,
            (select count(*)::int from battle_participant bp
              where bp.player_tag = cm.player_tag
                and bp.battle_time >= $2 and bp.battle_time < $3) as in_window
       from clan_membership cm
       join player p on p.player_tag = cm.player_tag
      where cm.clan_tag = $1 and cm.left_observed_at is null
        and cm.joined_observed_at > $2
      order by cm.joined_observed_at desc`,
    [clanTag, new Date(fromMs), new Date(toMs)],
  );
  const hit = rows.filter((r) => r.before_join > 0);
  if (!hit.length) return null;
  const list = hit
    .slice(0, 8)
    .map(
      (r) =>
        `${r.name ?? r.player_tag} ${r.player_tag} joined ${r.joined_observed_at.toISOString().slice(0, 10)} with ${r.before_join} of ${r.in_window} recorded battles in the window played before joining`,
    )
    .join("; ");
  return `Rows are today's members, and ${hit.length} of them joined after the window began, so their counts include battles from before they belonged to this clan: ${list}${hit.length > 8 ? `; and ${hit.length - 8} more` : ""}. Members who left since the window began are not listed.`;
}

/** Members whose battles are mostly not captured, said (Gym #196). */
async function memberCaptureNote(db, members, fromMs, toMs) {
  // The response's own window (Gym #236: it measured the last seven days
  // on every window, naming a member fully captured in the week asked
  // about and missing one who was not).
  const end = Math.min(toMs ?? Date.now(), Date.now());
  if (fromMs === null || fromMs === undefined || end <= fromMs) return null;
  const names = new Map(members.map((m) => [m.player_tag, m.name ?? null]));
  const capture = await captureByPlayer(db, [...names.keys()], {
    fromMs,
    toMs: end,
  });
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return underCaptureNote(
    capture,
    (tag) => names.get(tag),
    `this window (profile reads between ${day(fromMs)} and ${day(end)})`,
  );
}

/** A clan's own scores as its newest roster read carried them (Gym #294:
 *  a leader's agent summed member trophies for want of these). */
async function clanScores(db, clanTag) {
  const {
    rows: [r],
  } = await db.query(
    `select clan_score, clan_war_trophies, observed_at from clan_snapshot_daily
      where clan_tag = $1 order by observed_at desc limit 1`,
    [clanTag],
  );
  return {
    clan_score: r?.clan_score ?? null,
    clan_war_trophies: r?.clan_war_trophies ?? null,
    scores_observed_at: r?.observed_at?.toISOString() ?? null,
  };
}

const CLAN_SCORE_NOTE =
  "clan_score is the game's own clan score (the clans board of rankings_clan_ladder ranks by it), not the sum of member trophies; clan_war_trophies is the clanwars board's figure. Both as of scores_observed_at, the newest roster read.";

export const clansTools = {
  clans_standings: {
    description:
      "Clan-relative performance, yours by default: every open member's recorded W/L/D, win rate, ladder trophy net and current streak in ONE call over a window (default 30 days). For a 24-hour member scan use days: 1, min_battles: 1; from/to also supports shorter windows. Ranked with the clan median; members below min_battles are listed below the floor. Per-battle detail for one member is battles_performance.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: CLAN_TAG_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "Last N days (default 30); or use from/to.",
        },
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
      const win = await resolveSeasonWindow(ctx, args, {
        defaultDays: 30,
        seasonDefault: false,
        flavor: "ladder",
      });
      const minBattles = Number(args.min_battles ?? 10);
      if (!Number.isInteger(minBattles) || minBattles < 1 || minBattles > 200)
        throw new ToolFailure("bad_request", "min_battles must be 1-200.");
      requireEnum(args.mode, MODE_GROUPS, "mode");
      // The counts come from the daily rollup for the whole days inside
      // the window and the raw rows for its edge days (daily-sql.mjs,
      // plan step 14); until then the subquery scanned the CORPUS's
      // window and kept ~50 members of it. The streak is the run of
      // equal decided outcomes ending at the member's latest battle,
      // from the members' own raw rows (the 2026-09-16 timeline request
      // §2: a consumer called battles_performance per member for this).
      const query = standingsQuery({
        clanTag,
        from: win.from,
        to: win.to ?? null,
        mode: args.mode ?? null,
      });
      const { rows } = await ctx.db.query(query.text, query.values);
      const coverage = await coverageBasis(ctx.db, clanTag);
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
        // null, not 0, when the window holds no ladder battle: a sum over
        // nothing is not a net of nothing (3.16.0).
        // The name battles_performance uses (4.0.0).
        net_trophies: r.ladder_battles > 0 ? r.net_trophies : null,
        ladder_battles: r.ladder_battles,
        modes: modeSplit(r.modes ?? []),
        mean_level_gap:
          r.mean_level_gap === null ? null : Number(r.mean_level_gap),
        level_gap_battles: r.level_gap_battles,
        log_recorded: coverage.members.get(r.player_tag)?.log_recorded ?? false,
        recorded_since:
          coverage.members.get(r.player_tag)?.recorded_since ?? null,
        current_streak: r.streak_kind
          ? { kind: r.streak_kind, length: r.streak_len }
          : null,
      }));
      const rankedOnly = withRate
        .filter((m) => m.wins + m.losses >= minBattles)
        .sort((a, z) => z.win_rate - a.win_rate || z.battles - a.battles);
      // The percentile the note has always stated, served (review
      // 2026-09-19, defect 6): rank 1 reads 1, the last rank reads
      // 1/ranked_members.
      const ranked = rankedOnly.map((m, i) => ({
        ...m,
        rank: i + 1,
        percentile: Number((1 - i / rankedOnly.length).toFixed(3)),
      }));
      const unranked = withRate
        .filter((m) => m.wins + m.losses < minBattles)
        .sort((a, z) => z.battles - a.battles);
      // Comparable only within one mode and at similar gaps: the guard
      // names the two members that clash (3.16.0).
      const clash = comparabilityNote(
        ranked.map((m) => ({ ...m, label: m.name ?? m.player_tag })),
        { what: "member" },
      );
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
        comparable: clash === null,
        basis: coverage.basis,
        members: ranked,
        below_floor: unranked,
        notes: notes(
          await joinedMidWindowNote(
            ctx.db,
            clanTag,
            win.from ? win.from.getTime() : null,
            win.to ? win.to.getTime() : Date.now(),
          ),
          await memberCaptureNote(
            ctx.db,
            [...ranked, ...unranked],
            win.from ? win.from.getTime() : null,
            win.to ? win.to.getTime() : Date.now(),
          ),
          clash,
          win.seasonNotes,
          coverageBasisNote(coverage.basis),
          "Covers RECORDED battles only, and capture starts differ per member (recorded_since per member; elixir_coverage per tag).",
          "win_rate = wins/(wins+losses), draws excluded; percentile = 1 - (rank-1)/ranked_members; members below min_battles are in below_floor without a rank.",
          "net_trophies sums trophy_change on ladder battles in the window and is null when ladder_battles is 0; modes splits each member's battles by mode group and mean_level_gap is their deck's average level minus the opposing side's over their latest level_gap_battles (at most 50) battles in the window; current_streak is the run of equal decided outcomes ending at the member's latest recorded battle in the window, null with no decided battle.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  clans_roster: {
    description:
      "A clan's roster, yours by default: per member the role, latest trophies and donations, last recorded battle and the game's own last-seen, tenure, badge count and the lifetime block as of the latest profile poll (null for a member whose profile is not recorded), plus recent join, leave and role events. verbosity compact keeps the name, the member count and the role breakdown. live: true asks for a fresh read of ANY clan, recorded or not: served if in hand, otherwise queued while the record answers with live_status pending.",
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
        try {
          clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
        } catch (err) {
          if (err?.code === "not_recorded") {
            const retry = {
              ...args,
              clan_tag: normalizeTag(String(args.clan_tag)),
              live: true,
            };
            throw new ToolFailure(
              "not_recorded",
              err.message,
              `Retry clans_roster(${JSON.stringify(retry)}); if live_pending, wait retry_after_s and repeat. This reads the game without starting an ongoing clan watch.`,
            );
          }
          throw err;
        }
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
          `select c.name, c.type, c.location_id, c.description,
                  count(cm.player_tag)::int as member_count,
                  count(*) filter (where cm.role = 'leader')::int as leaders,
                  count(*) filter (where cm.role = 'coLeader')::int as co_leaders,
                  count(*) filter (where cm.role = 'elder')::int as elders,
                  count(*) filter (where cm.role = 'member')::int as members
           from clan c
           left join clan_membership cm
             on cm.clan_tag = c.clan_tag and cm.left_observed_at is null
           where c.clan_tag = $1
           group by c.name, c.type, c.location_id, c.description`,
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
          type: row.type ?? null,
          location_id: row.location_id ?? null,
          description: row.description ?? null,
          member_count: row.member_count ?? 0,
          ...(await clanScores(ctx.db, clanTag)),
          role_counts: {
            leader: row.leaders ?? 0,
            coLeader: row.co_leaders ?? 0,
            elder: row.elders ?? 0,
            member: row.members ?? 0,
          },
          // notes and docs at both sizes (Gym #112), as the other clans_*
          // tools keep them at compact.
          notes: notes(
            livePendingNote(live),
            "verbosity compact is the clan's header and role_counts; the full roster adds each member's trophies, activity stamps, lifetime block and recent_events.",
            CLAN_SCORE_NOTE,
          ),
          docs: docsRef("recording", "the-games-own-last-seen"),
          // The clan's own poll clock, not a bare as_of.
          meta: await buildMeta(ctx.db, ctx.account, clanTag, ["clan"]),
        };
      }

      const clanRow = await ctx.db.query(
        `select name, type, location_id, description from clan where clan_tag = $1`,
        [clanTag],
      );
      if (!clanRow.rows[0])
        throw notRecordedOrPending(
          live,
          `${clanTag} is not in the record.`,
          "live: true reads it from the game.",
        );
      // Per member: the latest row's trophies and donations (the roster
      // writes them at its own cadence since 0127), and, at full
      // verbosity, the lifetime block from the latest PROFILE row plus
      // the player's tenure and badge count (review 7.5: the site
      // rendered these from 46 profile reads a day).
      const roster = await ctx.db.query(
        `select cm.player_tag, cm.role, cm.joined_observed_at, p.name,
                (select min(x.joined_observed_at) from clan_membership x
                  where x.clan_tag = cm.clan_tag and x.player_tag = cm.player_tag) as first_joined_observed_at,
                p.game_last_seen_at, p.years_played, p.account_age_days,
                  p.war_day_wins, p.clan_cards_collected, p.legacy_trophy_road_high_score,
                  nn.nickname,
                  s.trophies, s.donations,
                  l.best_trophies, l.battle_count, l.wins, l.losses, l.three_crown_wins,
                  l.collection_level, l.king_tower_level, l.total_donations,
                  l.profile_observed_at,
                  (select count(*)::int from player_badge b where b.player_tag = cm.player_tag) as badge_count,
                  (select max(bp.battle_time) from battle_participant bp
                   where bp.player_tag = cm.player_tag) as last_battle
           from clan_membership cm
           join player p on p.player_tag = cm.player_tag
           left join player_nickname nn on nn.account_id = $2
             and nn.player_tag = cm.player_tag
           left join lateral (
             select trophies, donations from player_snapshot_daily
             where player_tag = cm.player_tag order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           left join lateral (
             select best_trophies, battle_count, wins, losses, three_crown_wins, collection_level,
                    king_tower_level, total_donations, profile_observed_at
             from player_snapshot_daily
             where player_tag = cm.player_tag and profile_observed_at is not null
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) l on true
           where cm.clan_tag = $1 and cm.left_observed_at is null
           order by cm.role desc, s.trophies desc nulls last`,
        [clanTag, ctx.account.accountId],
      );
      // The newest twenty by when they happened, said when cut (Gym #241:
      // two departures, two demotions and a join this month were cut
      // silently, and event_id order was not quite time order).
      const RECENT_EVENTS = 20;
      const events = await ctx.db.query(
        `select ${CLAN_EVENT_COLUMNS} from clan_event
         where clan_tag = $1 order by window_end desc, event_id desc limit ${RECENT_EVENTS + 1}`,
        [clanTag],
      );
      const eventsCut = events.rows.length > RECENT_EVENTS;
      events.rows = events.rows.slice(0, RECENT_EVENTS);
      await hydrateClanEvents(ctx.db, events.rows);
      const tz = ctx.account.timezone;
      return {
        clan_tag: clanTag,
        applied,
        ...(live ? { live_status: liveStatus(live) } : {}),
        name: clanRow.rows[0]?.name ?? null,
        // What a joiner asks first (3.15.0): open, invite only or closed;
        // where; and what the clan says about itself. As the last roster
        // poll carried them; null before 2026-09-17.
        type: clanRow.rows[0]?.type ?? null,
        location_id: clanRow.rows[0]?.location_id ?? null,
        description: clanRow.rows[0]?.description ?? null,
        member_count: roster.rows.length,
        ...(await clanScores(ctx.db, clanTag)),
        // At both sizes (Gym #112): compact had it, full did not.
        role_counts: {
          leader: roster.rows.filter((m) => m.role === "leader").length,
          coLeader: roster.rows.filter((m) => m.role === "coLeader").length,
          elder: roster.rows.filter((m) => m.role === "elder").length,
          member: roster.rows.filter((m) => m.role === "member").length,
        },
        members: roster.rows.map((m) => ({
          player_tag: m.player_tag,
          name: m.name,
          ...(m.nickname ? { nickname: m.nickname } : {}),
          role: m.role,
          trophies: m.trophies,
          donations_this_week: m.donations,
          // When the record FIRST saw them in the clan, across stints; a
          // member who left and came back is not a new recruit (Gym #264).
          first_observed_in_clan:
            (
              m.first_joined_observed_at ?? m.joined_observed_at
            )?.toISOString() ?? null,
          ...(m.first_joined_observed_at &&
          m.joined_observed_at &&
          m.first_joined_observed_at.getTime() !==
            m.joined_observed_at.getTime()
            ? { rejoined_observed_at: m.joined_observed_at.toISOString() }
            : {}),
          last_recorded_battle: m.last_battle?.toISOString() ?? null,
          // The GAME's own activity stamp, not ours.
          last_seen_in_game: m.game_last_seen_at?.toISOString() ?? null,
          years_played: m.years_played ?? null,
          account_age_days: m.account_age_days ?? null,
          badge_count: m.badge_count ?? 0,
          // The lifetime block as of the latest profile poll; null for a
          // member whose profile is not recorded.
          lifetime: m.profile_observed_at
            ? {
                // The stamp under the name every series point uses
                // (3.17.0; the as_of twin retired at 4.0.0).
                profile_observed_at: m.profile_observed_at.toISOString(),
                best_trophies: m.best_trophies,
                battle_count: m.battle_count,
                wins: m.wins,
                losses: m.losses,
                three_crown_wins: m.three_crown_wins,
                collection_level: m.collection_level,
                king_tower_level: m.king_tower_level,
                total_donations: m.total_donations,
                war_day_wins: m.war_day_wins,
                clan_cards_collected: m.clan_cards_collected,
                legacy_trophy_road_high_score: m.legacy_trophy_road_high_score,
              }
            : null,
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
          CLAN_SCORE_NOTE,
          eventsCut
            ? `recent_events holds the newest ${RECENT_EVENTS}, back to ${events.rows.at(-1)?.window_end.toISOString()}; older ones are recorded but not listed here: elixir_timeline filtered to the roster section reads a window's joins, departures and role changes in full.`
            : null,
          "war_day_wins and clan_cards_collected are the game's counters from the retired Clan Wars format, frozen since it ended: 0 on newer accounts, never counting River Race battles or donations (Gym #131). War results: clans_participation or battles_performance mode war.",
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
      "Every open member's participation, week by week, for the caller's clan by default, in ONE call: per ISO week the battles played, ranked battles and the donation counter at week end; per recorded war week the decks used and each war day's decks (null where the day was not polled); per member the observed join, whether it predates the recording, the last recorded battle and days since it. Facts with their windows and the recording horizon, never a rating. weeks 1 to 8, default 5; the current week is partial and says so. verbosity compact drops the per-day war arrays and points.",
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
          // The mark every clipped bucket carries (4.0.0; complete before):
          // the current ISO week is the one the window clips.
          ...(end > now
            ? {
                partial: true,
                covers: { from: start.toISOString(), to: now.toISOString() },
              }
            : {}),
        });
      }
      const seasonFields = await seasonFieldsForInstants(ctx.db, from, null, {
        flavor: "plain",
      });
      const members = await ctx.db.query(MEMBERS_SQL, [clanTag]);
      const tags = members.rows.map((m) => m.player_tag);
      // Whether the members' logs are recorded at all (3.16.0): for an
      // activity-scope clan every count below is zero by construction.
      const coverage = await coverageBasis(ctx.db, clanTag);
      // The six reads that follow, from participation-sql.mjs so the
      // migrate Lambda's explain_participation diagnostic reads the same
      // plans this serves.
      const reads = participationQueries({
        clanTag,
        tags,
        from,
        rankedTypes: typesForModeGroup("ranked"),
      });
      const run = (name) => {
        const q = reads.find((r) => r.name === name);
        return ctx.db.query(q.text, q.values);
      };
      const combined = await run("battles_by_week_and_war_day");
      const battles = {
        rows: combined.rows.filter((r) => r.kind === "week"),
      };
      // union all names columns after the first branch: the war-day
      // count arrives as `battles`.
      const battledDays = {
        rows: combined.rows
          .filter((r) => r.kind === "war_day")
          .map((r) => ({ ...r, war_battles: r.battles })),
      };
      const donations = await run("donations_by_week");
      const warWeeks = await run("war_weeks");
      // The finish under each war week (Gym #110): decks played after the
      // boat crossed earn nothing, so war_points over war_decks is not a
      // rate on a finished week. The same helpers war_history uses.
      const finishDays = await finishWarDays(ctx.db, clanTag, warWeeks.rows);
      const afterFinish = await decksAfterFinish(ctx.db, clanTag, finishDays);
      const finishedEarly = (w) =>
        w.is_colosseum || w.finished_observed_at === null
          ? null
          : finishDays.has(weekKey(w));
      const participation = await run("war_participation");
      const attendance = await run("war_attendance");

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
      // Tenure is the CURRENT stint (Jamie 2026-09-24, Gym #264): a leave
      // and rejoin within 7 days is the same stint, so leaving cannot
      // reset a member's new-member grace; first_joined_at keeps the
      // history beside it.
      const { rows: stintRows } = await ctx.db.query(
        `select player_tag, joined_observed_at, left_observed_at
           from clan_membership
          where clan_tag = $1 and player_tag = any($2::text[])
          order by player_tag, joined_observed_at`,
        [clanTag, members.rows.map((m) => m.player_tag)],
      );
      const stints = new Map();
      for (const r of stintRows) {
        if (!stints.has(r.player_tag)) stints.set(r.player_tag, []);
        stints.get(r.player_tag).push(r);
      }
      const SAME_STINT_MS = 7 * 86400_000;
      const stintOf = (tag, openJoined) => {
        const rows = stints.get(tag) ?? [];
        let start = openJoined ? new Date(openJoined) : null;
        for (let i = rows.length - 1; i >= 0 && start; i -= 1) {
          const r = rows[i];
          if (!r.left_observed_at) continue;
          const gap = start.getTime() - new Date(r.left_observed_at).getTime();
          if (gap >= 0 && gap <= SAME_STINT_MS)
            start = new Date(r.joined_observed_at);
          else if (new Date(r.left_observed_at) < start) break;
        }
        return {
          start,
          first: rows.length ? new Date(rows[0].joined_observed_at) : start,
        };
      };
      const out = members.rows.map((m) => {
        const stint = stintOf(m.player_tag, m.joined_observed_at);
        const joined = stint.start;
        // A member already present at the first roster poll joined at or
        // before it; their tenure is a lower bound, not a fact.
        const tenureKnown = Boolean(
          joined && firstRoster && joined.getTime() > firstRoster.getTime(),
        );
        const last = m.last_battle ? new Date(m.last_battle) : null;
        const lastInClan = m.last_battle_in_clan
          ? new Date(m.last_battle_in_clan)
          : null;
        const cov = coverage.members.get(m.player_tag);
        return {
          player_tag: m.player_tag,
          name: m.name,
          role: m.role,
          joined_observed_at: joined?.toISOString() ?? null,
          first_joined_at: stint.first?.toISOString() ?? null,
          tenure_known: tenureKnown,
          days_in_clan_observed: joined
            ? Math.floor((now - joined) / 86400_000)
            : null,
          log_recorded: cov?.log_recorded ?? false,
          recorded_since: cov?.recorded_since ?? null,
          last_battle_time: last?.toISOString() ?? null,
          last_battle_time_in_clan: lastInClan?.toISOString() ?? null,
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
                // Up to five war weeks (the default): at six to eight the
                // full response ran past the result cap (6.23.0 gate);
                // war_history's scoring_decks has every week.
                ...(warWeeks.rows.length <= SCORING_DECKS_WEEKS
                  ? {
                      war_scoring_decks: warWeeks.rows.map((w) => {
                        const k = `${m.player_tag}|${w.season_id}|${w.section_index}`;
                        const used =
                          partByKey.get(k)?.decks_used ??
                          (daysByKey.get(k) || battledByKey.get(k) ? 0 : null);
                        return scoringDecks({
                          decksUsed: used,
                          finished: finishedEarly(w),
                          finishDay: finishDays.get(weekKey(w)) ?? null,
                          after: afterFinish.get(weekKey(w)),
                          playerTag: m.player_tag,
                        });
                      }),
                    }
                  : {}),
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
          // Days battled per war week (3.16.0), the count war_history
          // computes: a poll that saw decks used OR a recorded war battle;
          // null when the week has no coverage from either source, so a
          // consumer never spreads a weekly total over days.
          war_days_battled: warWeeks.rows.map((w) => {
            const k = `${m.player_tag}|${w.season_id}|${w.section_index}`;
            const days = daysByKey.get(k);
            const battled = battledByKey.get(k);
            if (!days && !battled) return null;
            const seen = new Set();
            for (const [day, d] of days ?? [])
              if (d.decks_used_today > 0) seen.add(day);
            for (const [day, n] of battled ?? []) if (n > 0) seen.add(day);
            return seen.size;
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
            source: args.weeks !== undefined ? "argument" : "default",
            ...seasonFields.echo,
          },
        }),
        recording_active_since:
          clan.recording_active_since?.toISOString?.() ?? null,
        first_roster_observed_at: firstRoster?.toISOString() ?? null,
        basis: coverage.basis,
        weeks: weekBounds,
        war_weeks: warWeeks.rows.map((w) => ({
          season_id: w.season_id,
          section_index: w.section_index,
          is_colosseum: w.is_colosseum,
          started_observed_at: w.started_observed_at?.toISOString() ?? null,
          finished_observed_at: w.finished_observed_at?.toISOString() ?? null,
          finished_early: finishedEarly(w),
          finish_war_day: finishDays.get(weekKey(w)) ?? null,
        })),
        member_count: out.length,
        members: out,
        notes: notes(
          await joinedMidWindowNote(
            ctx.db,
            clanTag,
            from.getTime(),
            Date.now(),
          ),
          await memberCaptureNote(ctx.db, out, from.getTime(), Date.now()),
          seasonFields.seasonNotes,
          (() => {
            // ONE sentence for every finished week: a note per week pushed
            // the eight-week full read (Elixir Clan's call) past the
            // result cap (6.23.0).
            const done = warWeeks.rows.filter((w) => finishedEarly(w) === true);
            return done.length
              ? `The boat crossed the finish line early in ${done.map((w) => `${w.season_id}/${w.section_index} (war day ${finishDays.get(weekKey(w))})`).join(", ")}: decks played on the days after it earned 0 points, so war_points / war_decks is not a rate for those weeks - use war_scoring_decks (full verbosity, up to ${SCORING_DECKS_WEEKS} war weeks) or war_history.scoring_decks.`
              : null;
          })(),
          "ISO weeks run Monday 00:00 UTC to Monday; war weeks run on the game's own grid and are listed separately with their observed bounds.",
          compact
            ? null
            : "war_points per war week is the member's period points (the war_history and war_current `points` figure, the API's periodPoints), never fame.",
          "donations is the highest value the game's weekly counter reached in that week's game days (it only climbs until the weekly reset around the start of Monday UTC, so the highest read is a lower bound on the week's total: donations after the last read before the reset are not in it); null means no snapshot fell in the week.",
          "Per-member columns align to the top-level weeks and war_weeks, one entry each in order; war_decks_by_day holds war days 1-4 from roster polls during each day, null where that day was not polled, and war_battles_by_day the member's recorded war battles per day.",
          "tenure_known is false for a member already present at the first roster poll: days_in_clan_observed is then a lower bound.",
          "joined_observed_at and days_in_clan_observed are the member's CURRENT stint: a member who left and came back counts from the rejoin, except that a rejoin within 7 days of leaving continues the stint before it. first_joined_at is the member's first recorded join here (clans_roster.first_observed_in_clan is the same instant).",
          coverageBasisNote(coverage.basis),
          "Counts cover RECORDED battles only (log_recorded and recorded_since per member say whose log is recorded and since when; elixir_coverage per tag says how complete it is); war_days_battled per war week counts the days a member fought from polls and recorded battles, null when neither source covered the week; last_battle_time_in_clan is the last recorded battle played as a member of this clan.",
        ),
        docs: docsRef("recording", "participation-by-week"),
        meta: await buildMeta(ctx.db, ctx.account, clanTag, ["clan"]),
      };
    },
  },
};
