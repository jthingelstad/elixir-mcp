import { readRecordedProfile } from "../../../ingest/src/recorded-profile.mjs";
/** players_summary · players_profile · players_timeline ·
 *  players_collection · players_names · players_search. Conventions
 *  (1.0.0): `applied`, `notes[]` + `docs`, `verbosity`. */

import {
  MAX_DISPLAY_LEVEL,
  cardForms,
  normalizeTag,
  responseMeta,
} from "@elixir-mcp/contracts";
import {
  PLAYER_METRICS,
  metricSelect,
  KINDS,
  KIND_SCHEMA,
  GRANULARITY_SCHEMA,
  DAY_WINDOW_ARGS,
  STAMP_COLUMNS,
  GAME_DAY_NOTE,
  dayWindow,
  pointStamps,
  metricValue,
  botSourceNote,
} from "../daily-series.mjs";
import {
  TIMEZONE_SCHEMA,
  VERBOSITY,
  requireEnum,
  ToolFailure,
  liveRead,
  liveStatus,
  livePendingNote,
  notRecordedOrPending,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  DISPLAY_NAME_SCHEMA,
  subject,
  buildMeta,
  zoneFor,
  appliedBlock,
  notes,
  docsRef,
  deckIdentities,
  seasonFieldsForDays,
} from "./shared.mjs";
import { dailySql } from "../daily-sql.mjs";
import {
  modeSplit,
  dominantMode,
  comparabilityNote,
  shortHash,
  trophyFloor,
  trophyFloorNote,
} from "../controls.mjs";
import { iconUrlsOf } from "./cards.mjs";

/** Escape LIKE/ILIKE metacharacters so user text matches literally
 *  (Postgres' default escape character is the backslash). */
function likeLiteral(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

const FORMS_DOCS = docsRef("battles", "deck-identity-and-forms");

export const playersTools = {
  players_summary: {
    description:
      "The headline in one call: current trophies and clan, last-30-days record and win rate, and the most-played deck with its record. Start here for “how am I doing?”; drill in with battles_performance / battles_decks.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
          args.display_name,
        )
      ).tag;
      const asOf = new Date();
      const snap = await ctx.db.query(
        `select p.name, p.last_known_clan_tag, cl.name as clan_name,
                  s.trophies, s.snapshot_date, nn.nickname
           from player p
           left join clan cl on cl.clan_tag = p.last_known_clan_tag
           left join player_nickname nn on nn.account_id = $2
             and nn.player_tag = p.player_tag
           left join lateral (
             select trophies, snapshot_date from player_snapshot_daily
             where player_tag = p.player_tag
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where p.player_tag = $1`,
        [tag, ctx.account.accountId],
      );
      // The 30-day record from the daily rollup for the whole days and
      // the raw rows for the edge day (daily-sql.mjs, plan step 14);
      // first_recorded is one index probe.
      const since = new Date(Date.now() - 30 * 86_400_000);
      const record = await ctx.db.query(
        `with d as ${dailySql({ players: "array[$1]", from: "$2", to: "null" })}
         select coalesce(sum(d.battles), 0)::int as battles,
                coalesce(sum(d.wins), 0)::int as wins,
                coalesce(sum(d.losses), 0)::int as losses,
                coalesce(sum(d.draws), 0)::int as draws,
                coalesce(sum(d.trophy_delta), 0)::int as net_trophies,
                (select min(battle_time) from battle_participant
                  where player_tag = $1 and battle_time >= $2) as first_recorded
         from d`,
        [tag, since],
      );
      // The control next to the number (3.16.0): the window's mode split
      // from the same rollup rows, and the floor the player stood on.
      const modeRows = await ctx.db.query(
        `with d as ${dailySql({ players: "array[$1]", from: "$2", to: "null" })}
         select d.mode_group, sum(d.battles)::int as battles,
                sum(d.wins)::int as wins, sum(d.losses)::int as losses
         from d group by d.mode_group`,
        [tag, since],
      );
      const floor = await trophyFloor(ctx.db, tag, { from: since, to: null });
      const deck = await ctx.db.query(
        `select bp.deck_hash, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  (select json_agg(json_build_object('type', t.type, 'battles', t.n,
                                                     'wins', t.w, 'losses', t.l))
                     from (select x.type, count(*)::int as n,
                                  count(*) filter (where x.outcome = 'win')::int as w,
                                  count(*) filter (where x.outcome = 'loss')::int as l
                             from battle_participant x
                            where x.player_tag = $1 and x.deck_hash = bp.deck_hash
                              and x.battle_time > now() - interval '30 days'
                            group by x.type) t) as by_type,
                  round(avg(bp.deck_avg_level - lv.lvl)::numeric, 2) as mean_level_gap
           from battle_participant bp
         left join lateral (
           select avg(o.deck_avg_level) as lvl from battle_participant o
           where o.battle_id = bp.battle_id and o.side <> bp.side
             and bp.deck_avg_level is not null) lv on true
           where bp.player_tag = $1 and bp.deck_hash is not null
             and bp.battle_time > now() - interval '30 days'
           group by bp.deck_hash order by count(*) desc limit 2`,
        [tag],
      );
      const best = await ctx.db.query(
        `select bp.deck_hash, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  (select json_agg(json_build_object('type', t.type, 'battles', t.n,
                                                     'wins', t.w, 'losses', t.l))
                     from (select x.type, count(*)::int as n,
                                  count(*) filter (where x.outcome = 'win')::int as w,
                                  count(*) filter (where x.outcome = 'loss')::int as l
                             from battle_participant x
                            where x.player_tag = $1 and x.deck_hash = bp.deck_hash
                              and x.battle_time > now() - interval '30 days'
                            group by x.type) t) as by_type,
                  round(avg(bp.deck_avg_level - lv.lvl)::numeric, 2) as mean_level_gap
           from battle_participant bp
         left join lateral (
           select avg(o.deck_avg_level) as lvl from battle_participant o
           where o.battle_id = bp.battle_id and o.side <> bp.side
             and bp.deck_avg_level is not null) lv on true
           where bp.player_tag = $1 and bp.deck_hash is not null
             and bp.battle_time > now() - interval '30 days'
           group by bp.deck_hash
           having count(*) >= 10 and count(*) filter (where bp.outcome in ('win','loss')) > 0
           order by (count(*) filter (where bp.outcome = 'win'))::numeric
                    / greatest(count(*) filter (where bp.outcome in ('win','loss')), 1) desc
           limit 1`,
        [tag],
      );
      const p0 = snap.rows[0];
      if (!p0)
        throw new ToolFailure(
          "not_recorded",
          `${tag} is not in the record yet.`,
          "players_profile({ player_tag, live: true }) reads any tag from the game.",
        );
      const r = record.rows[0];
      const d = deck.rows[0];
      const b = best.rows[0];
      const identities = await deckIdentities(ctx.db, [
        d?.deck_hash,
        b?.deck_hash,
      ]);
      const deckShape = (row) => {
        if (!row) return null;
        const modes = row.by_type ? modeSplit(row.by_type) : undefined;
        return {
          deck_hash: row.deck_hash,
          cards: (identities.get(row.deck_hash)?.cards ?? []).map(
            ({ id, name }) => ({ id, name }),
          ),
          battles: row.battles,
          win_rate:
            row.wins + row.losses > 0
              ? Number((row.wins / (row.wins + row.losses)).toFixed(3))
              : null,
          ...(modes ? { modes, dominant_mode: dominantMode(modes) } : {}),
          // The level gap the deck fought at (3.17.0): what
          // comparabilityNote needs to name a real gap between the two
          // decks, as battles_decks carries per row.
          mean_level_gap:
            row.mean_level_gap === null ? null : Number(row.mean_level_gap),
        };
      };
      const windowModes = modeSplit(modeRows.rows);
      const topDeck = deckShape(d);
      const bestDeck = b && b.deck_hash !== d?.deck_hash ? deckShape(b) : null;
      const deckClash = comparabilityNote(
        [topDeck, bestDeck]
          .filter(Boolean)
          .map((x) => ({ ...x, label: shortHash(x.deck_hash) })),
      );
      return {
        player_tag: tag,
        name: p0.name,
        ...(p0.nickname ? { nickname: p0.nickname } : {}),
        clan: p0.last_known_clan_tag
          ? { clan_tag: p0.last_known_clan_tag, name: p0.clan_name }
          : null,
        trophies: p0.trophies,
        trophies_as_of: p0.snapshot_date
          ? p0.snapshot_date.toISOString().slice(0, 10)
          : null,
        applied: appliedBlock({
          window: {
            from: new Date(asOf.getTime() - 30 * 86400_000).toISOString(),
            to: asOf.toISOString(),
            source: "fixed",
            days: 30,
          },
        }),
        last_30_days: {
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          net_trophies: r.net_trophies,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          first_recorded: r.first_recorded?.toISOString() ?? null,
          modes: windowModes,
        },
        ...(floor ? { trophy_floor: floor } : {}),
        top_deck: topDeck,
        // most-played is often NOT the best-performing deck.
        best_deck: bestDeck,
        notes: notes(
          "Counts include every recorded battle (war modes carry no trophies); win_rate = wins/(wins+losses), draws excluded.",
          "best_deck needs 10+ battles in the window and is omitted when it IS the top deck.",
          deckClash,
          trophyFloorNote(floor),
          "History may predate active recording; elixir_coverage has the capture story.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: await buildMeta(ctx.db, ctx.account, tag, [
          "player",
          "player_battlelog",
        ]),
      };
    },
  },

  players_profile: {
    description:
      "Latest recorded profile snapshot for a tag: trophies, Path of Legends, league stats, donations, lifetime counters, collection level, clan (with badge and the player's role), attributes (arena, best trophies, favourite card, account age) and current badge state, as of the last profile poll. live: true asks for a fresh read of ANY tag, recorded or not: served if in hand, otherwise queued while the record answers with live_status pending (live_pending if nothing is recorded yet). For tag-to-name only, players_names resolves up to 100 tags without the live lane.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        live: {
          type: "boolean",
          description:
            "Ask for a read no older than a minute; works for a player nobody records. Served if in hand, otherwise queued while the record answers with live_status pending (live_pending if nothing is recorded yet).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
          args.display_name,
        )
      ).tag;
      // live: true (1.7.0, asynchronous): a fresh read is served from the
      // record it just updated; otherwise one is queued and the record as
      // it stands answers now, with live_status saying when to call again.
      const live =
        args.live === true
          ? await liveRead(ctx, { endpoint: "player", entityKey: tag })
          : null;
      const row = await readRecordedProfile(ctx.db, tag);
      if (!row)
        throw notRecordedOrPending(
          live,
          `${tag} is not in the record yet.`,
          "live: true reads any tag from the game.",
        );
      if (!row.snapshot_date) {
        throw notRecordedOrPending(
          live,
          `${tag} is known but has no profile snapshot yet.`,
          "Recording may have just started; try elixir_coverage, or live: true.",
        );
      }
      return {
        player_tag: row.player_tag,
        name: row.name,
        applied: appliedBlock({ live: args.live === true ? true : undefined }),
        ...(live ? { live_status: liveStatus(live) } : {}),
        clan: row.last_known_clan_tag
          ? {
              clan_tag: row.last_known_clan_tag,
              name: row.clan_name,
              badge_id: row.clan_badge_id,
              role: row.last_known_clan_role,
            }
          : null,
        last_seen_in_game: row.game_last_seen_at?.toISOString() ?? null,
        // The player as a game entity, separate from the daily numbers.
        // Ids only: names and icons resolve from cards_catalog.
        attributes: {
          arena_id: row.arena_id,
          best_trophies: row.best_trophies,
          favorite_card_id: row.favorite_card_id,
          years_played: row.years_played,
          account_age_days: row.account_age_days,
          // The frozen career counters the profile carries (0127): war
          // day wins, cards donated to clans, the old Trophy Road best.
          war_day_wins: row.war_day_wins,
          clan_cards_collected: row.clan_cards_collected,
          legacy_trophy_road_high_score: row.legacy_trophy_road_high_score,
        },
        badges: row.badges ?? [],
        snapshot: {
          date: row.snapshot_date.toISOString().slice(0, 10),
          trophies: row.trophies,
          // {current, best} as always, plus the last twelve season finals
          // the record kept (player_pol_season, 0130), newest first.
          path_of_legend: { ...row.pol, seasons: row.pol_seasons ?? [] },
          league_statistics: row.league_stats,
          donations_this_week: row.donations,
          donations_received_this_week: row.donations_received,
          lifetime: row.lifetime,
        },
        notes: notes(
          livePendingNote(live),
          "last_seen_in_game is the game's own lastSeen from clan roster polls (when the player was last active); null until a polled roster carried them.",
          "attributes and clan carry ids only; names and icons resolve through cards_catalog.",
          "path_of_legend.seasons lists the last twelve season finals the record kept (the API's lastPathOfLegendSeasonResult, read in the following month; rank null unless globally ranked), newest first; empty for a player recorded after their last final or never ranked.",
        ),
        docs: docsRef("recording", "the-games-own-last-seen"),
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
      };
    },
  },

  players_timeline: {
    description:
      "Time series from daily snapshots, one point per game day, for the caller by default: trophies, or any of the day row's metrics (the roster's trophies, donations, arena, clan and rank; the profile's lifetime block and Path of Legends standing; the seasonal trophies; the full list is on recording#daily-series). Every point carries observed_at, profile_observed_at (null on a roster-only day) and roster_observed_at. progress_key adds the side-mode progress series; kind selects the pre_reset or season_roll row; granularity week keeps the last row of each ISO week.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        metrics: {
          type: "array",
          items: { type: "string", enum: PLAYER_METRICS },
          default: ["trophies"],
          description:
            "Which series to return; default trophies. Roster columns (written every roster poll of the member's clan): trophies, donations, donations_received, arena_id, clan_tag, clan_rank, previous_clan_rank, game_last_seen_at. Lifetime (the profile poll of a recorded player): best_trophies, battle_count, wins, losses, three_crown_wins, star_points, exp_points, collection_level, king_tower_level, total_donations, challenge_cards_won, challenge_max_wins, tournament_cards_won, tournament_battle_count. Path of Legends: league_number (the league, 1 = unranked; the name the battle row uses), pol_trophies, pol_rank. Seasonal Trophy Road: season_trophies, season_best_trophies.",
        },
        ...DAY_WINDOW_ARGS,
        timezone: TIMEZONE_SCHEMA,
        granularity: GRANULARITY_SCHEMA,
        kind: KIND_SCHEMA,
        progress_key: {
          type: "string",
          maxLength: 60,
          description:
            "A Player.progress key as the API spells it (2v2League_202609, seasonal-trophy-road-202609, AutoChess_2026_Season_11, or '' for the Merge Tactics pre-season arena) or 'all': adds progress[] with that bucket's trophies, best_trophies and arena_id per day. A bucket at zero writes no row.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, rawArgs) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          rawArgs.player_tag,
          "summary",
          rawArgs.on_behalf_of,
        )
      ).tag;
      const tz = zoneFor(ctx, rawArgs);
      const win = dayWindow(rawArgs);
      requireEnum(rawArgs.granularity, ["day", "week"], "granularity");
      requireEnum(rawArgs.kind, KINDS, "kind");
      for (const metric of rawArgs.metrics ?? [])
        requireEnum(metric, PLAYER_METRICS, "metric");
      const metrics =
        Array.isArray(rawArgs.metrics) && rawArgs.metrics.length > 0
          ? rawArgs.metrics
          : ["trophies"];
      const kind = rawArgs.kind ?? "daily";
      const where = [`player_tag = $1`, `snapshot_kind = $2`];
      const params = [tag, kind];
      if (win.from) {
        params.push(win.from);
        where.push(`snapshot_date >= $${params.length}::date`);
      }
      if (win.to) {
        params.push(win.to);
        where.push(`snapshot_date <= $${params.length}::date`);
      }
      // Epoch disclosure: snapshots start later than battles; never let a
      // truncated series read as smooth history.
      const { rows: epoch } = await ctx.db.query(
        `select min(snapshot_date)::text as first from player_snapshot_daily
         where player_tag = $1 and snapshot_kind = 'daily'`,
        [tag],
      );
      const snapshotsFrom = epoch[0]?.first ?? null;
      const weekly = rawArgs.granularity === "week";
      const cols = `snapshot_date, ${STAMP_COLUMNS}, ${metricSelect()}`;
      const { rows } = await ctx.db.query(
        weekly
          ? `select distinct on (date_trunc('week', snapshot_date))
               ${cols}, to_char(snapshot_date, 'IYYY-"W"IW') as iso_week
             from player_snapshot_daily where ${where.join(" and ")}
             order by date_trunc('week', snapshot_date), snapshot_date desc`
          : `select ${cols} from player_snapshot_daily where ${where.join(" and ")}
             order by snapshot_date`,
        params,
      );
      const points = (
        weekly ? rows.sort((a, z) => a.snapshot_date - z.snapshot_date) : rows
      ).map((r) => ({
        day: r.snapshot_date.toISOString().slice(0, 10),
        ...(weekly ? { iso_week: r.iso_week } : {}),
        ...pointStamps(r),
        ...Object.fromEntries(metrics.map((m) => [m, metricValue(r, m)])),
      }));
      // The progress series (0129): one bucket, or every bucket the
      // player has had, per day in the same window and kind (pre_reset
      // does not exist there: nothing in a bucket is weekly).
      let progress;
      if (rawArgs.progress_key !== undefined) {
        const key = String(rawArgs.progress_key);
        const pWhere = [`player_tag = $1`, `snapshot_kind = $2`];
        const pParams = [tag, kind === "pre_reset" ? "daily" : kind];
        if (key !== "all") {
          pParams.push(key);
          pWhere.push(`progress_key = $${pParams.length}`);
        }
        if (win.from) {
          pParams.push(win.from);
          pWhere.push(`day >= $${pParams.length}::date`);
        }
        if (win.to) {
          pParams.push(win.to);
          pWhere.push(`day <= $${pParams.length}::date`);
        }
        const { rows: prog } = await ctx.db.query(
          `select p.progress_key, m.mode, m.season_month, p.day, p.observed_at,
                  p.trophies, p.best_trophies, p.arena_id
             from player_progress_daily p
             join mode_season m on m.progress_key = p.progress_key
            where ${pWhere.join(" and ")}
            order by p.progress_key, p.day`,
          pParams,
        );
        progress = prog.map((r) => ({
          key: r.progress_key,
          mode: r.mode,
          season_month: r.season_month,
          day: r.day.toISOString().slice(0, 10),
          observed_at: r.observed_at.toISOString(),
          trophies: r.trophies,
          best_trophies: r.best_trophies,
          arena_id: r.arena_id,
        }));
      }
      const seasonFields = await seasonFieldsForDays(
        ctx.db,
        win.from ?? snapshotsFrom ?? new Date().toISOString().slice(0, 10),
        win.to,
      );
      const rosterOnly = points.filter(
        (p) => p.profile_observed_at === null,
      ).length;
      return {
        player_tag: tag,
        applied: appliedBlock({
          window: {
            from: win.from,
            to: win.to,
            source: win.source,
            ...(tz ? { timezone: tz } : {}),
            ...win.echoExtra,
            ...seasonFields.echo,
          },
          granularity: weekly ? "week" : "day",
          kind,
          metrics,
          ...(rawArgs.progress_key !== undefined
            ? { progress_key: String(rawArgs.progress_key) }
            : {}),
        }),
        snapshots_available_from: snapshotsFrom,
        series: points,
        ...(progress ? { progress } : {}),
        notes: notes(
          win.floorNote,
          snapshotsFrom && win.from && win.from < snapshotsFrom
            ? `Requested from ${win.from}, but daily snapshots begin ${snapshotsFrom}; earlier dates have battles (see elixir_coverage) but no snapshots.`
            : null,
          metrics.includes("donations")
            ? "donations is the weekly counter as of each snapshot; it resets Mondays around 00:10 UTC (kind: pre_reset is the row from the hour before)."
            : null,
          rosterOnly > 0
            ? `${rosterOnly} of ${points.length} points are roster-only (profile_observed_at null): the roster's columns are the day's, the lifetime block is null there.`
            : null,
          botSourceNote(points),
          ...seasonFields.seasonNotes,
          GAME_DAY_NOTE,
        ),
        docs: docsRef("recording", "daily-series"),
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"], {
          timezone: tz,
          windowTo: win.to,
        }),
      };
    },
  },

  players_collection: {
    description:
      "Full card collection as last recorded: levels (in-game 1-16 scale), counts, forms, star levels, collection level. evolutionLevel / maxEvolutionLevel are FORM bit fields (1 = Evolution, 2 = Hero, 3 = both), decoded into forms_unlocked / forms_available. verbosity compact keeps id, name, level and forms per card.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        verbosity: VERBOSITY(
          "each card as id, name, level, forms_unlocked only; support_cards likewise.",
        ),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
          args.display_name,
        )
      ).tag;
      // The collection is a table (0076), joined to the catalog for the
      // static facts; levels are already on the 1-16 scale.
      const { rows } = await ctx.db.query(
        `select pc.card_id, pc.level, pc.count, pc.evolution_level, pc.star_level, pc.observed_at,
                c.name, c.kind, c.rarity, c.elixir_cost, c.max_level, c.max_evolution_level,
               c.icon_medium, c.icon_evolution_medium, c.icon_hero_medium
         from player_card pc
         left join card c on c.card_id = pc.card_id
         where pc.player_tag = $1
         order by pc.card_id`,
        [tag],
      );
      if (rows.length === 0) {
        throw new ToolFailure(
          "not_recorded",
          `No collection recorded for ${tag} yet.`,
          "The collection is read from the player's profile; players_profile({ live: true }) fetches one now.",
        );
      }
      const { rows: lvl } = await ctx.db.query(
        `select collection_level
         from player_snapshot_daily where player_tag = $1 and profile_observed_at is not null
         order by snapshot_date desc, snapshot_kind desc limit 1`,
        [tag],
      );
      const asOf = rows.reduce(
        (m, r) => (r.observed_at > m ? r.observed_at : m),
        rows[0].observed_at,
      );
      const compact = args.verbosity === "compact";
      const shape = (r) => {
        const full = {
          id: r.card_id,
          name: r.name ?? null,
          level: r.level,
          maxLevel: MAX_DISPLAY_LEVEL,
          ...(r.max_level !== null ? { maxLevelRarityScale: r.max_level } : {}),
          ...(r.count !== null ? { count: r.count } : {}),
          ...(r.star_level !== null ? { starLevel: r.star_level } : {}),
          ...(r.evolution_level !== null
            ? { evolutionLevel: r.evolution_level }
            : {}),
          ...(r.max_evolution_level !== null
            ? { maxEvolutionLevel: r.max_evolution_level }
            : {}),
          ...(r.rarity ? { rarity: r.rarity } : {}),
          ...(r.elixir_cost !== null ? { elixirCost: r.elixir_cost } : {}),
          ...(iconUrlsOf(r) ? { iconUrls: iconUrlsOf(r) } : {}),
          forms_available: cardForms(r.max_evolution_level),
          forms_unlocked: cardForms(r.evolution_level),
        };
        return compact
          ? {
              id: full.id,
              name: full.name,
              level: full.level,
              forms_unlocked: full.forms_unlocked,
            }
          : full;
      };
      return {
        player_tag: tag,
        applied: appliedBlock({ verbosity: compact ? "compact" : "full" }),
        collection_level: lvl[0]?.collection_level ?? null,
        cards: rows.filter((r) => r.kind !== "support").map(shape),
        support_cards: rows.filter((r) => r.kind === "support").map(shape),
        as_of_payload: asOf.toISOString(),
        notes: notes(
          "forms_available decodes maxEvolutionLevel (which forms exist), forms_unlocked decodes evolutionLevel (which the player holds); both are bit fields, never levels or progress.",
          "Levels are the in-game 1-16 scale; starLevel is cosmetic.",
        ),
        docs: FORMS_DOCS,
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
      };
    },
  },

  players_names: {
    description:
      "Bulk tag-to-name resolution from the corpus: up to 100 tags in, for each the last-observed name and where it came from, plus an explicit unknown list. Costs nothing from the live lane; resolving a miss is then a deliberate players_profile({ live: true }) per tag. The inverse of players_search.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
          description: "One to one hundred player tags.",
        },
      },
      required: ["player_tags"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const raw = Array.isArray(args.player_tags) ? args.player_tags : [];
      if (raw.length === 0 || raw.length > 100)
        throw new ToolFailure("bad_request", "player_tags takes 1-100 tags.");
      const tags = [];
      for (const t of raw) {
        try {
          tags.push(normalizeTag(String(t)));
        } catch {
          throw new ToolFailure("invalid_tag", `Invalid tag: ${t}`);
        }
      }
      const unique = [...new Set(tags)];
      const { rows } = await ctx.db.query(
        `select p.player_tag, p.name, p.last_seen_at, nn.nickname,
                p.last_known_clan_tag as clan_tag,
                (select max(s.snapshot_date) from player_snapshot_daily s
                 where s.player_tag = p.player_tag) as profile_seen,
                (select max(bp.battle_time) from battle_participant bp
                 where bp.player_tag = p.player_tag) as battle_seen
         from player p
         left join player_nickname nn on nn.account_id = $2 and nn.player_tag = p.player_tag
         where p.player_tag = any($1)`,
        [unique, ctx.account.accountId],
      );
      const byTag = new Map(rows.map((r) => [r.player_tag, r]));
      const names = [];
      const unknown = [];
      for (const tag of unique) {
        const r = byTag.get(tag);
        if (r && r.name !== null) {
          names.push({
            player_tag: tag,
            name: r.name,
            ...(r.nickname ? { nickname: r.nickname } : {}),
            clan_tag: r.clan_tag,
            source: r.profile_seen
              ? "profile"
              : r.battle_seen
                ? "battlelog"
                : "roster",
            last_seen: r.last_seen_at?.toISOString() ?? null,
          });
        } else {
          unknown.push({
            player_tag: tag,
            in_corpus: Boolean(r),
          });
        }
      }
      return {
        applied: appliedBlock({ player_tags: unique }),
        names,
        unknown,
        notes: notes(
          "Names are as last observed by any recording; a rename since is invisible until the tag is seen again.",
          "unknown.in_corpus true means the tag appears in recorded battles but no observation carried its name; players_profile({ live: true }) resolves one at the cost of a live fetch.",
        ),
        docs: docsRef("glossary"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  players_search: {
    description:
      'Name-to-tag resolution across the whole recorded corpus: case-insensitive substring on last-observed display names AND your private nicknames, nicknames ranked first ("tyler" finds the player you call Tyler). Unknown names return an honest empty list, never a guess. The inverse (tags to names, in bulk) is players_names.',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 50,
          description: "Part of a name or nickname.",
        },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const q = String(args.query ?? "").trim();
      if (!q) throw new ToolFailure("bad_request", "query is empty.");
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20);
      // The query is a literal, never a pattern.
      const pattern = `%${likeLiteral(q)}%`;
      const { rows } = await ctx.db.query(
        `with hits as (
           select p.player_tag, p.name, nn.nickname,
                  case
                    when nn.nickname ilike $2 then 'nickname'
                    when exists (select 1 from claim c
                                 where c.account_id = $1 and c.player_tag = p.player_tag)
                      then 'claim'
                    when exists (select 1 from claim c
                                 join clan_membership cm on cm.player_tag = c.player_tag
                                   and cm.left_observed_at is null
                                 join clan_membership cm2 on cm2.clan_tag = cm.clan_tag
                                   and cm2.left_observed_at is null
                                 where c.account_id = $1 and cm2.player_tag = p.player_tag)
                      then 'clanmate'
                    else 'corpus'
                  end as source
           from player p
           left join player_nickname nn on nn.account_id = $1
             and nn.player_tag = p.player_tag
           where p.name ilike $2 or nn.nickname ilike $2)
         select h.player_tag, h.name, h.nickname, h.source,
                (select cm.clan_tag from clan_membership cm
                 where cm.player_tag = h.player_tag and cm.left_observed_at is null
                 limit 1) as clan_tag
         from hits h
         order by case h.source when 'nickname' then -1 when 'claim' then 0 when 'clanmate' then 1 else 2 end,
                  h.name
         limit $3`,
        [ctx.account.accountId, pattern, limit],
      );
      return {
        applied: appliedBlock({ query: q, limit }),
        matches: rows,
        notes: notes(
          rows.length === 0
            ? "No recorded player matches that name; names change, tags are permanent, and only players the service has observed are findable."
            : "Your own players and clanmates rank first (source: nickname | claim | clanmate | corpus); names are as last observed.",
        ),
        docs: docsRef("protocol", "argument-conventions"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
