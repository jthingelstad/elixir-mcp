import {
  MODE_GROUPS,
  cardDisplayName,
  responseMeta,
  typesForModeGroup,
  EVENT_MODE_GROUP,
} from "@elixir-mcp/contracts";
import {
  ARCHETYPE_ARG,
  ARCHETYPE_NOTE,
  META_METHODOLOGY,
  MODE_SCHEMA,
  SEASON_ARG_SCHEMA,
  SEGMENT_DOCS,
  SEGMENT_NOTES,
  collectionSegmentNote,
  SEGMENT_SCHEMA,
  VERBOSITY,
  WINDOW_ARGS,
  appliedBlock,
  corpusPrior,
  deckFit,
  deckIdentities,
  deckStamps,
  decksContaining,
  ebShrink,
  excludedBreakdown,
  fieldedLevel,
  notes,
  populationBlock,
  requireEnum,
  resolveArchetypeArg,
  resolveFitFor,
  resolveSeasonWindow,
  segmentFilter,
  stampMatches,
  ToolFailure,
} from "../shared.mjs";
import {
  RANKED_NO_BAND_NOTE,
  TROPHY_BAND_NAMES,
  popBandClause,
  popWindow,
  rawScanMemory,
  rollupDeckModes,
  rollupDecks,
  rollupModeGroups,
  seasonPrior,
  seasonRollup,
  trophyBandClause,
} from "../../meta-season.mjs";
import {
  comparabilityNote,
  dominantMode,
  modeGaps,
  modeSplit,
  pooledModesNote,
  shortHash,
  singlePlayerNote,
} from "../../controls.mjs";
import {
  META_EVENT_NOTE,
  metaPopulationClause,
  outsideMetaCount,
  outsideMetaNote,
  participantModeClause,
} from "../../mode-filter.mjs";
import {
  BAND_FALLBACK_NOTE,
  CARD_IDS_ARG,
  COMPACT_DESC,
  FIT_FOR_SCHEMA,
  GROUP_BY_SCHEMA,
  META_TROPHY_BAND_SCHEMA,
  NO_FIT_NOTE,
  compactDeckRow,
  fitNotes,
  groupByArchetype,
} from "./common.mjs";

export const battles_meta_decks = {
  description:
    "Observed deck meta for a named population: segment 'mine' (your clan), 'corpus' (the whole recorded corpus, on purpose) or {clan_tag | player_tag | collection}. Per exact deck identity: decided player-battle observations (not unique matches), record, distinct players, usage share, raw and shrunk win rates. Default window: the current season to date; season selects another. No tier lists: what the recorded data shows, with sample sizes.",
  inputSchema: {
    type: "object",
    properties: {
      segment: SEGMENT_SCHEMA,
      ...WINDOW_ARGS,
      season: SEASON_ARG_SCHEMA,
      mode: MODE_SCHEMA,
      min_battles: {
        type: "integer",
        minimum: 1,
        default: 5,
        description: "Decided observations a deck needs to be listed.",
      },
      min_players: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 1,
        description:
          'Distinct players a deck needs to be listed (7.1.6). 2 or more keeps decks played across players, which is what "what deck should I play" asks; 1 lists every deck, one player\'s own included.',
      },
      sort: {
        type: "string",
        enum: ["battles", "shrunk_win_rate", "players"],
        default: "battles",
      },
      limit: { type: "integer", minimum: 1, maximum: 40, default: 20 },
      trophy_band: META_TROPHY_BAND_SCHEMA,
      containing: {
        ...CARD_IDS_ARG,
        description:
          "Only decks whose played cards include ALL these card ids, any form, tower troop excluded (the with_cards semantics of battles_query). Applied after aggregation: usage_share and decided_battles stay the population's.",
      },
      fit_for: FIT_FOR_SCHEMA,
      archetype: ARCHETYPE_ARG,
      group_by: GROUP_BY_SCHEMA,
      verbosity: VERBOSITY(COMPACT_DESC),
    },
    required: ["segment"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const compact = args.verbosity === "compact";
    const params = [];
    const seg = await segmentFilter(ctx, args, params);
    const win = await resolveSeasonWindow(ctx, args);
    const fit =
      args.fit_for === undefined
        ? null
        : await resolveFitFor(ctx.db, args.fit_for);
    const archetype =
      args.archetype === undefined
        ? null
        : await resolveArchetypeArg(ctx.db, args.archetype);
    // A corpus window inside the running season reads the population
    // table (feedback #77-#79); its scope is the season key and a
    // game-day range, and the band is a column.
    const pop = await popWindow(ctx.db, { win, seg });
    const scope = []; // segment + window + mode: the population considered
    if (seg.where) scope.push(seg.where);
    if (pop) scope.push(...pop.scope(params));
    const from = win.from.toISOString();
    params.push(from);
    scope.push(`${seg.timeColumn} >= $${params.length}`);
    const to = win.to;
    if (to) {
      params.push(to);
      scope.push(`${seg.timeColumn} < $${params.length}`);
    }
    requireEnum(args.mode, MODE_GROUPS, "mode");
    // Event content is outside the meta population (6.17.0): mode event
    // answers empty and says why (#148), never a silent zero. The
    // population table and the season rollup already exclude it; a raw
    // read excludes it below with the rollup's own rule.
    if (args.mode === EVENT_MODE_GROUP) scope.push("false");
    else if (args.mode && pop) {
      params.push(typesForModeGroup(args.mode));
      scope.push(`bp.type = any($${params.length})`);
    } else if (args.mode) scope.push(participantModeClause(args.mode, params));
    // A raw read considers the meta population the rollup is built from
    // (no event content, chosen decks only), so `excluded` and `considered`
    // reconcile with decided_battles as they do on a season read.
    if (!pop) scope.push(metaPopulationClause());
    requireEnum(args.trophy_band, TROPHY_BAND_NAMES, "trophy_band");
    if (args.trophy_band)
      scope.push(
        pop
          ? popBandClause(args.trophy_band, params)
          : trophyBandClause(args.trophy_band, params),
      );
    const where = [
      ...scope,
      "bp.deck_hash is not null",
      "bp.outcome in ('win','loss')",
      "bp.type_class = 'pvp'",
    ];
    const minBattles = args.min_battles ?? 5;
    // A corpus read over one season comes from the rollup (0121); a
    // segment or an explicit window scans the raw rows as before. A
    // banded read (0135) comes from the band tables once built.
    const rolled = await seasonRollup(ctx.db, {
      win,
      seg,
      mode: args.mode,
      trophyBand: args.trophy_band ?? null,
    });
    const bandPending = rolled?.pending === true;
    const roll = bandPending ? null : rolled;
    let rows;
    let excluded;
    let prior;
    let totalDecided;
    let totalWins;
    let modeGroups = null;
    let playersInWindow = null;
    if (roll) {
      ({ excluded, prior } = roll);
      rows = await rollupDecks(ctx.db, roll, { minBattles });
      totalDecided = prior.decided;
      totalWins = Math.round((prior.mean ?? 0) * prior.decided);
      playersInWindow = roll.players;
      if (!args.mode) modeGroups = await rollupModeGroups(ctx.db, roll);
    } else {
      await rawScanMemory(ctx.db);
      const { prior: populationPrior, ...breakdown } = await excludedBreakdown(
        ctx.db,
        scope,
        params,
        {
          withPrior: !seg.where,
          source: pop ? "meta_season_pop" : "battle_participant",
        },
      );
      excluded = breakdown;
      // What the population rule left out, said (Gym #188). A segment
      // read only: a corpus window would pay a third corpus scan.
      if (!pop && seg.where)
        excluded.outside_meta = await outsideMetaCount(ctx.db, scope, params);
      prior =
        populationPrior ??
        (await seasonPrior(ctx.db, { win, mode: args.mode })) ??
        (await corpusPrior(ctx.db, {
          from,
          to,
          types: args.mode ? typesForModeGroup(args.mode) : null,
        }));
      // The participant carries everything this aggregate needs (0095,
      // 0099: type_class and type); no join to battle.
      // ONE scan, grouped by (deck, type): the per-deck row, its mode
      // split and the window's per-type groups all fold from it (3.16.0);
      // the level gap is the lateral avg battles_decks uses (3.13.0), or
      // the population table's own column.
      const { rows: byDeckType } = await ctx.db.query(
        `with d as (
             select bp.deck_hash, bp.type, bp.player_tag,
                    count(*)::int as battles,
                    count(*) filter (where bp.outcome = 'win')::int as wins,
                    count(*) filter (where bp.outcome = 'loss')::int as losses,
                    min(bp.battle_time) as first_used,
                    max(bp.battle_time) as last_used,
                    ${
                      pop
                        ? "sum(bp.level_gap) as gap_sum, count(bp.level_gap)::int as gap_n from meta_season_pop bp"
                        : `sum(bp.deck_avg_level - lv.lvl) as gap_sum,
                    count(lv.lvl)::int as gap_n
             from battle_participant bp
             cross join lateral (
             -- The other side's level, stamped at ingest (0156).
             select case when bp.deck_avg_level is not null
                         then bp.opp_deck_avg_level end as lvl) lv`
                    }
             where ${where.join(" and ")}
             group by bp.deck_hash, bp.type, bp.player_tag),
           -- The window's totals and its per-type groups once, over
           -- every deck; the deck rows below are the ones over
           -- min_battles. Both used to be correlated subqueries per
           -- (deck, type) row - quadratic on the corpus, and 100k+
           -- deck rows shipped to the handler to sum (6.12.0).
           w as (
             select coalesce(sum(battles), 0)::int as decided,
                    coalesce(sum(wins), 0)::int as wins,
                    count(distinct player_tag)::int as players,
                    (select jsonb_agg(jsonb_build_object('type', g.type, 'battles', g.battles,
                                                         'gap_sum', g.gap_sum, 'gap_n', g.gap_n))
                       from (select type, sum(battles)::int as battles,
                                    sum(gap_sum) as gap_sum, sum(gap_n)::int as gap_n
                               from d group by type) g) as by_type
             from d),
           dp as (
             select deck_hash, count(distinct player_tag)::int as deck_players
             from d group by deck_hash having sum(battles) >= $${params.length + 1}),
           decks as (
             select d.deck_hash, d.type,
                    sum(d.battles)::int as battles, sum(d.wins)::int as wins, sum(d.losses)::int as losses,
                    count(distinct d.player_tag)::int as players,
                    min(d.first_used) as first_used, max(d.last_used) as last_used,
                    sum(d.gap_sum) as gap_sum, sum(d.gap_n)::int as gap_n,
                    dp.deck_players
             from d join dp on dp.deck_hash = d.deck_hash
             group by d.deck_hash, d.type, dp.deck_players)
           -- The window row rides every deck row, and stands alone (a
           -- null deck_hash) when no deck is over min_battles.
           select w.players as window_players, w.decided as window_decided,
                  w.wins as window_wins, w.by_type as window_types,
                  decks.*
           from w left join decks on true`,
        [...params, minBattles],
      );
      const window = byDeckType[0] ?? {};
      const byDeck = new Map();
      for (const t of byDeckType) {
        if (t.deck_hash === null) continue;
        const cur = byDeck.get(t.deck_hash) ?? {
          deck_hash: t.deck_hash,
          battles: 0,
          wins: 0,
          losses: 0,
          players: t.deck_players,
          first_used: t.first_used,
          last_used: t.last_used,
          gap_sum: 0,
          gap_n: 0,
          types: [],
        };
        cur.battles += t.battles;
        cur.wins += t.wins;
        cur.losses += t.losses;
        if (t.first_used < cur.first_used) cur.first_used = t.first_used;
        if (t.last_used > cur.last_used) cur.last_used = t.last_used;
        cur.gap_sum += Number(t.gap_sum ?? 0);
        cur.gap_n += t.gap_n;
        cur.types.push(t);
        byDeck.set(t.deck_hash, cur);
      }
      rows = [...byDeck.values()].map((r) => ({
        ...r,
        // + 0 folds a -0 to 0 so the two paths compare equal.
        mean_level_gap:
          r.gap_n > 0 ? Number((r.gap_sum / r.gap_n).toFixed(2)) + 0 : null,
        level_gap_battles: r.gap_n,
      }));
      playersInWindow = window.window_players ?? 0;
      totalDecided = window.window_decided ?? 0;
      totalWins = window.window_wins ?? 0;
      if (!args.mode)
        modeGroups = modeGaps(
          (window.window_types ?? []).map((g) => ({
            type: g.type,
            battles: g.battles,
            level_battles: g.gap_n,
            mean_level_gap: g.gap_n > 0 ? Number(g.gap_sum) / g.gap_n : null,
          })),
        );
    }
    if (args.containing) {
      const keep = await decksContaining(ctx.db, args.containing);
      rows = rows.filter((r) => keep.has(r.deck_hash));
    }
    const mean = totalDecided > 0 ? totalWins / totalDecided : 0.5;
    const priorMean = prior.mean ?? 0.5;
    const sufficient = totalDecided >= META_METHODOLOGY.segment_min_decided;
    let shaped = rows
      .filter((r) => r.battles >= minBattles)
      .map((r) => ({
        deck_hash: r.deck_hash,
        battles: r.battles,
        wins: r.wins,
        losses: r.losses,
        players: r.players,
        usage_share:
          totalDecided > 0
            ? Number((r.battles / totalDecided).toFixed(3))
            : null,
        win_rate:
          r.wins + r.losses > 0
            ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
            : null,
        ...(sufficient
          ? {
              shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, priorMean),
            }
          : {}),
        first_used: r.first_used.toISOString(),
        last_used: r.last_used.toISOString(),
        mean_level_gap:
          r.mean_level_gap === null || r.mean_level_gap === undefined
            ? null
            : Number(r.mean_level_gap),
        level_gap_battles: r.level_gap_battles ?? 0,
      }));
    const sort = args.sort ?? "battles";
    shaped.sort(
      (a, z) =>
        (sort === "shrunk_win_rate"
          ? (z.shrunk_win_rate ?? z.win_rate) -
            (a.shrunk_win_rate ?? a.win_rate)
          : sort === "players"
            ? (z.players ?? 0) - (a.players ?? 0)
            : z.battles - a.battles) ||
        (a.deck_hash < z.deck_hash ? -1 : a.deck_hash > z.deck_hash ? 1 : 0),
    );
    const limit = Math.min(args.limit ?? 20, 40);
    // One player's own deck reads as meta at the top of a busy list (Gym
    // #256: 13-15 of every 17-20 rows were one player's, one of them a
    // 24-0 bridge spam). min_players filters, and the note says it.
    const minPlayers = Number(args.min_players ?? 1);
    if (!Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > 50)
      throw new ToolFailure("bad_request", "min_players must be 1-50.");
    const beforePlayers = shaped;
    if (minPlayers > 1)
      shaped = shaped.filter((r) => (r.players ?? 0) >= minPlayers);
    // The archetype filter (6.5.0) reads the label off each identity,
    // so with one asked the identities are fetched for every candidate
    // row and the filter runs before the limit; without one, for the
    // returned rows only, as before.
    // Over the stamp (0148), so the whole population is filtered.
    let archetypeCandidates = null;
    if (archetype) {
      archetypeCandidates = shaped.length;
      const stamps = await deckStamps(
        ctx.db,
        shaped.map((r) => r.deck_hash),
      );
      shaped = shaped.filter((r) =>
        stampMatches(stamps.get(r.deck_hash), archetype),
      );
    }
    // group_by (6.6.0): fold every deck in scope (over min_battles) by
    // its stamp; the deck rows are not returned.
    requireEnum(args.group_by, ["archetype", "family"], "group_by");
    const grouped = args.group_by
      ? await groupByArchetype(ctx.db, {
          groupBy: args.group_by,
          rows: shaped,
          where,
          params,
          withMembers: Boolean(seg.where),
          limit,
        })
      : null;
    if (grouped) shaped = [];
    shaped = shaped.slice(0, limit);
    // The identity's cards come from deck_card (0091), for the returned
    // rows only - no exemplar, no participant JSON. The row's mode
    // split (3.16.0): the rollup's per-group keys, or one group-by over
    // the returned decks' raw rows.
    const hashes = shaped.map((r) => r.deck_hash);
    const identities = await deckIdentities(ctx.db, hashes);
    const modesByDeck = roll
      ? await rollupDeckModes(ctx.db, roll, hashes)
      : new Map(rows.map((r) => [r.deck_hash, r.types]));
    shaped = shaped.map((row) => {
      const modes = modeSplit(modesByDeck.get(row.deck_hash) ?? []);
      return {
        ...row,
        modes,
        dominant_mode: dominantMode(modes),
        ...(identities.get(row.deck_hash) ?? { cards: [] }),
      };
    });
    // The fit (6.4.0): what the player holds rides each card, each
    // row says what it would field at and what upgrades would open,
    // and a row the player cannot field is not in decks[] at all.
    let fitBlock = null;
    let unfieldable = [];
    if (fit) {
      const fielded = await fieldedLevel(ctx.db, fit.tag, {
        from,
        to,
        types: args.mode ? typesForModeGroup(args.mode) : null,
      });
      // What the player already fields, by shape (6.6.0, design §12.2):
      // a row in a family they play costs the least to adopt.
      const { rows: ownDecks } = await ctx.db.query(
        `select distinct deck_hash from battle_participant
           where player_tag = $1 and battle_time >= $2
             and ($3::timestamptz is null or battle_time < $3)
             and ($4::text[] is null or type = any($4))
             and type_class = 'pvp' and deck_hash is not null`,
        [
          fit.tag,
          from,
          to ?? null,
          args.mode ? typesForModeGroup(args.mode) : null,
        ],
      );
      const ownStamps = await deckStamps(
        ctx.db,
        ownDecks.map((r) => r.deck_hash),
      );
      const playsFamily = new Set(
        [...ownStamps.values()].map((st) => st.family),
      );
      const playsLabel = new Set([...ownStamps.values()].map((st) => st.label));
      // The win conditions they field, form included (6.13.0, the
      // Gym's open question 1): the card that is leveled and learned,
      // whatever family it is played in. From the identities, since
      // the stamp keeps ids without form.
      const ownIdentities = await deckIdentities(
        ctx.db,
        ownDecks.map((r) => r.deck_hash),
      );
      const playsWin = new Map();
      for (const identity of ownIdentities.values())
        for (const w of identity.archetype?.win_conditions ?? [])
          playsWin.set(`${w.id}|${w.form}`, cardDisplayName(w));
      fitBlock = {
        player_tag: fit.tag,
        collection_as_of: fit.as_of,
        fielded_mean_level: fielded.mean_level,
        // The level fielded NOW (Gym #133, #171): players_collection's
        // own recent mean, the benchmark a levelling account is judged by.
        recent_mean_level: fielded.recent_mean_level,
        fielded_battles: fielded.battles,
        plays: {
          families: [...playsFamily].sort(),
          win_conditions: [...new Set(playsWin.values())].sort(),
          archetypes: [...playsLabel].sort(),
        },
      };
      shaped = shaped.map((row) => ({
        ...row,
        cards: row.cards.map((c) => ({
          ...c,
          held_level: fit.held.get(c.id)?.level ?? null,
        })),
        fit: {
          // The upgrade target is the level fielded now when it is known.
          ...deckFit(
            row.cards,
            fit.held,
            fielded.recent_mean_level ?? fielded.mean_level,
          ),
          plays_family: playsFamily.has(row.archetype?.family),
          plays_win_condition: (row.archetype?.win_conditions ?? []).some((w) =>
            playsWin.has(`${w.id}|${w.form}`),
          ),
          plays_archetype: playsLabel.has(row.archetype?.label),
        },
      }));
      unfieldable = shaped.filter((r) => !r.fit.fieldable);
      shaped = shaped.filter((r) => r.fit.fieldable);
    }
    const clash = comparabilityNote(
      shaped.map((r) => ({ ...r, label: shortHash(r.deck_hash) })),
    );
    // A corpus read says whose neighbourhood it describes (3.16.0).
    const population = seg.where
      ? null
      : await populationBlock(ctx.db, { playersInWindow });
    const fitNote = fitBlock
      ? fitNotes(fitBlock, shaped, unfieldable)
      : NO_FIT_NOTE;
    if (compact) {
      shaped = shaped.map(compactDeckRow);
      unfieldable = unfieldable.map(compactDeckRow);
    }
    return {
      applied: appliedBlock({
        segment: seg.echo,
        window: win.echo,
        mode: args.mode,
        trophy_band: args.trophy_band,
        containing: args.containing,
        fit_for: fit?.tag,
        archetype: archetype ?? undefined,
        group_by: args.group_by,
        min_battles: minBattles,
        sort,
        limit,
        verbosity: compact ? "compact" : "full",
      }),
      ...(population ? { population } : {}),
      ...(compact ? {} : { methodology: META_METHODOLOGY }),
      decided_battles: totalDecided,
      segment_win_rate: totalDecided > 0 ? Number(mean.toFixed(3)) : null,
      prior_win_rate: Number(priorMean.toFixed(3)),
      prior_basis: prior.mean === null ? "neutral_0.5" : "corpus_window",
      ...(sufficient
        ? {}
        : {
            insufficient_sample: true,
            insufficient_sample_floor: META_METHODOLOGY.segment_min_decided,
          }),
      excluded,
      ...(roll ? { players_as_of: roll.players_as_of } : {}),
      comparable: clash === null,
      ...(modeGroups && !compact ? { modes_in_window: modeGroups } : {}),
      ...(fitBlock ? { fit_for: fitBlock } : {}),
      ...(grouped ? { archetypes: grouped.rows } : {}),
      decks: shaped,
      ...(fitBlock ? { unfieldable } : {}),
      notes: notes(
        (() => {
          const solo = beforePlayers
            .slice(0, limit)
            .filter((r) => (r.players ?? 0) <= 1).length;
          return minPlayers === 1 &&
            !seg.echo?.player_tag &&
            solo * 2 > Math.min(limit, beforePlayers.length)
            ? `${solo} of the first ${Math.min(limit, beforePlayers.length)} rows are one player's own deck (players 1): they describe that player, not what this population plays. Pass min_players 2 (or sort players) for decks played across players.`
            : minPlayers > 1
              ? `Rows with fewer than ${minPlayers} distinct players are left out (min_players): ${beforePlayers.length - shaped.length} of the decks over min_battles.`
              : null;
        })(),
        outsideMetaNote(excluded?.outside_meta ?? 0),
        args.mode === EVENT_MODE_GROUP ? META_EVENT_NOTE : null,
        grouped ? grouped.folded : null,
        fitNote,
        ARCHETYPE_NOTE,
        archetype
          ? `archetype '${archetype.requested}' resolved to ${archetype.family ? archetype.family.replace("_", " ") : "any family"}${archetype.win_conditions.length ? ` with ${archetype.win_conditions.map((w) => w.name).join(" and ")}` : ""} (${archetype.resolved_from}); the filter ran over all ${archetypeCandidates} decks over min_battles, and decided_battles and usage_share stay the population's.`
          : null,
        clash,
        modeGroups ? pooledModesNote(modeGroups) : null,
        seg.where ? singlePlayerNote(shaped) : null,
        bandPending ? BAND_FALLBACK_NOTE : null,
        // A band on ranked or tournament answers 0 by rule; say why (#204).
        args.trophy_band && args.mode !== "ladder" ? RANKED_NO_BAND_NOTE : null,
        args.trophy_band && roll
          ? "excluded counts the season and mode, not the band (a duel or a boat battle has no band); decided_battles and every row are the band's."
          : null,
        SEGMENT_NOTES,
        collectionSegmentNote(seg),
        win.seasonNotes,
        roll?.note,
        pop?.note,
      ),
      docs: SEGMENT_DOCS,
      meta: responseMeta({
        as_of: new Date().toISOString(),
        ...(win.timezone ? { timezone_applied: win.timezone } : {}),
      }),
    };
  },
};
