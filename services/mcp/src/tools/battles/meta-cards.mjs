import {
  MODE_GROUPS,
  formName,
  responseMeta,
  typesForModeGroup,
  EVENT_MODE_GROUP,
  cardType,
} from "@elixir-mcp/contracts";
import {
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
  ebShrink,
  excludedBreakdown,
  fieldedLevel,
  heldCard,
  notes,
  PARTICIPANT_GAMES,
  POP_GAMES,
  populationBlock,
  requireEnum,
  resolveFitFor,
  resolveSeasonWindow,
  segmentFilter,
} from "../shared.mjs";
import {
  RANKED_NO_BAND_NOTE,
  CAP_BAND_NOTE,
  TROPHY_BAND_NAMES,
  popBandClause,
  popWindow,
  rawScanMemory,
  rollupCardModes,
  rollupCards,
  rollupModeGroups,
  seasonPrior,
  seasonRollup,
  trophyBandClause,
} from "../../meta-season.mjs";
import {
  comparabilityNote,
  modeGaps,
  modeSplit,
  pooledModesNote,
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
  COMPACT_CARDS_DESC,
  FIT_FOR_SCHEMA,
  FORM_ROWS_NOTE,
  META_TROPHY_BAND_SCHEMA,
  NO_FIT_CARDS_NOTE,
  cardFitNote,
  compactCardRow,
} from "./common.mjs";

export const battles_meta_cards = {
  description:
    "Observed card meta for a named population: segment 'mine', 'corpus' or {clan_tag | player_tag | collection}. Per card AND form (forms never merge): usage share among decided player-battle observations, distinct players, raw and shrunk win rates. Default window: the current season to date; season selects another. What the recorded data shows, with sample sizes; never a tier list.",
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
        default: 10,
        description: "Decided observations a card needs to be listed.",
      },
      sort: {
        type: "string",
        enum: ["usage", "shrunk_win_rate"],
        default: "usage",
      },
      limit: { type: "integer", minimum: 1, maximum: 130, default: 30 },
      trophy_band: META_TROPHY_BAND_SCHEMA,
      cards: {
        ...CARD_IDS_ARG,
        description:
          "Only these card ids (every form of each). Applied after aggregation: usage_share and decided_battles stay the population's; min_battles still applies.",
      },
      fit_for: FIT_FOR_SCHEMA,
      tower_troops: {
        type: "boolean",
        default: false,
        description:
          "Rows are the tower troops (the ninth card of a deck) instead of the eight deck cards: usage and win rate of each over the same population, window and mode. cards then takes tower troop ids.",
      },
      verbosity: VERBOSITY(COMPACT_CARDS_DESC),
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
    const pop = await popWindow(ctx.db, { win, seg });
    const scope = [];
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
    const minBattles = args.min_battles ?? 10;
    // The tower troop is the deck's ninth card (Jamie 2026-09-24): its
    // rows come from each deck's tower_troop_id over the same population.
    // The season rollup holds only the eight deck cards, so a tower troop
    // read always takes the population or raw path.
    const towers = args.tower_troops === true;
    const rolled = towers
      ? null
      : await seasonRollup(ctx.db, {
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
    // Of decided_battles, how many were duel rounds (9.11.0).
    let duelRounds = null;
    let totalDecided;
    let totalWins;
    let modeGroups = null;
    let playersInWindow = null;
    if (roll) {
      ({ excluded, prior } = roll);
      duelRounds = roll.duel_rounds;
      rows = await rollupCards(ctx.db, roll, { minBattles });
      totalDecided = prior.decided;
      totalWins = Math.round((prior.mean ?? 0) * prior.decided);
      playersInWindow = roll.players;
      if (!args.mode) modeGroups = await rollupModeGroups(ctx.db, roll);
    } else {
      await rawScanMemory(ctx.db);
      const {
        prior: populationPrior,
        duel_rounds: rawRounds,
        ...breakdown
      } = await excludedBreakdown(ctx.db, scope, params, {
        withPrior: !seg.where,
        source: pop ? "meta_season_pop" : "battle_participant",
      });
      excluded = breakdown;
      duelRounds = rawRounds;
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
      // Deck-first: the window's participants collapse to (deck, player)
      // pairs, and the identity's cards come from deck_card - one row per
      // card per deck, not one probe per card per participant. A deck's
      // cards are exactly its round-0, slot > 0 played cards, so the
      // counts are the per-participant counts.
      // ONE scan into (deck, player, type) pairs; the card rows, their
      // mode splits and the window's per-type groups fold from the
      // materialised CTE (3.16.0). The level gap is the lateral avg
      // battles_decks uses (3.13.0).
      ({ rows } = await ctx.db.query(
        `with pairs as (
           select bp.deck_hash, bp.player_tag, bp.type,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  -- A duel's rounds are games (9.11.0, #363).
                  count(*) filter (where bp.round > 0)::int as rounds,
                  ${
                    pop
                      ? `sum(bp.level_gap) as gap_sum, count(bp.level_gap)::int as gap_n from ${POP_GAMES} bp`
                      : `sum(bp.deck_avg_level - lv.lvl) as gap_sum,
                  count(lv.lvl)::int as gap_n
           from ${PARTICIPANT_GAMES} bp
           cross join lateral (
             -- The other side's level, stamped at ingest (0156).
             select case when bp.deck_avg_level is not null
                         then bp.opp_deck_avg_level end as lvl) lv`
                  }
           where ${where.join(" and ")}
           group by bp.deck_hash, bp.player_tag, bp.type),
         totals as (
           select coalesce(sum(battles), 0)::int as decided,
                  coalesce(sum(wins), 0)::int as wins,
                  count(distinct player_tag)::int as players,
                  (select jsonb_agg(jsonb_build_object('type', g.type, 'battles', g.battles,
                                                       'level_battles', g.gap_n,
                                                       'mean_level_gap', g.gap))
                     from (select type, sum(battles)::int as battles, sum(gap_n)::int as gap_n,
                                  round((sum(gap_sum) / nullif(sum(gap_n), 0))::numeric, 2) as gap
                             from pairs group by type) g) as by_type
           from pairs),
         -- The pairs joined to the identities' cards ONCE, into a set both
         -- aggregates read: the planner hashed all of deck_card twice (one
         -- join per aggregate, 18.6 s on a 7-day corpus window), and an
         -- index probe per deck is worse (65k decks in such a window, 47 s
         -- of heap fetches). Measured live 2026-09-21 with {explain_meta}.
         joined as materialized (
           ${
             towers
               ? `select d.tower_troop_id as card_id, 0 as form, p.type, p.player_tag, p.battles, p.wins, p.gap_sum, p.gap_n, p.rounds
           from pairs p join deck d on d.deck_hash = p.deck_hash
           where d.tower_troop_id is not null`
               : `select dc.card_id, dc.form, p.type, p.player_tag, p.battles, p.wins, p.gap_sum, p.gap_n, p.rounds
           from pairs p join deck_card dc on dc.deck_hash = p.deck_hash`
           }),
         per_type as (
           select card_id, form, type,
                  sum(battles)::int as battles, sum(wins)::int as wins,
                  sum(gap_sum) as gap_sum, sum(gap_n)::int as gap_n,
                  sum(rounds)::int as rounds
           from joined group by card_id, form, type),
         per_card as (
           select card_id, form, count(distinct player_tag)::int as players
           from joined group by card_id, form)
         select pt.card_id, c.name, pt.form as evolution,
                sum(pt.battles)::int as battles,
                sum(pt.wins)::int as wins,
                sum(pt.battles - pt.wins)::int as losses,
                pc.players,
                sum(pt.rounds)::int as duel_rounds,
                round((sum(pt.gap_sum) / nullif(sum(pt.gap_n), 0))::numeric, 2) as mean_level_gap,
                json_agg(json_build_object('type', pt.type, 'battles', pt.battles,
                                           'wins', pt.wins, 'losses', pt.battles - pt.wins)) as by_type,
                t.decided as total_decided,
                t.wins as total_wins,
                t.players as total_players,
                t.by_type as window_types
         from per_type pt
         join per_card pc on pc.card_id = pt.card_id and pc.form = pt.form
         join card c on c.card_id = pt.card_id
         cross join totals t
         group by pt.card_id, c.name, pt.form, pc.players, t.decided, t.wins, t.players, t.by_type`,
        params,
      ));
      totalDecided = rows[0]?.total_decided ?? 0;
      totalWins = rows[0]?.total_wins ?? 0;
      playersInWindow = rows[0]?.total_players ?? 0;
      if (!args.mode) modeGroups = modeGaps(rows[0]?.window_types ?? []);
    }
    // The tower read's population, counted apart from its rows (Gym #315):
    // the API reports no tower troop on a river-race battle, so war decks
    // are in the population and can be in no row. decided_battles stays
    // the population's (the eight-card read's number, rows or none), and
    // usage_share is over the observations whose tower troop is known.
    let towerKnown = null;
    if (towers) {
      const {
        rows: [t],
      } = await ctx.db.query(
        `select count(*)::int as decided,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(distinct bp.player_tag)::int as players,
                count(*) filter (where exists (
                  select 1 from deck d
                   where d.deck_hash = bp.deck_hash and d.tower_troop_id is not null))::int as known
           from ${pop ? POP_GAMES : PARTICIPANT_GAMES} bp
          where ${where.join(" and ")}`,
        params,
      );
      totalDecided = t.decided;
      totalWins = t.wins;
      playersInWindow = t.players;
      towerKnown = t.known;
    }
    if (args.cards) {
      const keep = new Set(args.cards.map(Number));
      rows = rows.filter((r) => keep.has(Number(r.card_id)));
    }
    const mean = totalDecided > 0 ? totalWins / totalDecided : 0.5;
    const priorMean = prior.mean ?? 0.5;
    const sufficient = totalDecided >= META_METHODOLOGY.segment_min_decided;
    let shaped = rows
      .filter((r) => r.battles >= minBattles)
      .map((r) => ({
        card_id: Number(r.card_id),
        name: r.name,
        form: formName(r.evolution),
        battles: r.battles,
        wins: r.wins,
        losses: r.losses,
        players: r.players,
        usage_share:
          (towers ? towerKnown : totalDecided) > 0
            ? Number(
                (r.battles / (towers ? towerKnown : totalDecided)).toFixed(3),
              )
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
        mean_level_gap:
          r.mean_level_gap === null || r.mean_level_gap === undefined
            ? null
            : Number(r.mean_level_gap),
        // Null on a rollup row the nightly has not split since 0183.
        duel_rounds: r.duel_rounds ?? null,
        _form: r.evolution,
        _types: r.by_type ?? null,
      }));
    const sort = args.sort ?? "usage";
    // Ties break on the card id and form, so the order is the same
    // whatever plan produced the rows (the rollup and raw paths are
    // held equal as lists).
    shaped.sort(
      (a, z) =>
        (sort === "shrunk_win_rate"
          ? (z.shrunk_win_rate ?? z.win_rate) -
            (a.shrunk_win_rate ?? a.win_rate)
          : z.battles - a.battles) ||
        a.card_id - z.card_id ||
        a._form - z._form,
    );
    const limit = Math.min(args.limit ?? 30, 130);
    shaped = shaped.slice(0, limit);
    // The row's mode split (3.16.0): the rollup's per-group keys, or
    // one group-by over the returned cards' raw rows.
    const modesByCard = roll
      ? await rollupCardModes(
          ctx.db,
          roll,
          shaped.map((r) => ({ card_id: r.card_id, form: r._form })),
        )
      : null;
    shaped = shaped.map(({ _form, _types, ...row }) => ({
      ...row,
      modes: modeSplit(
        (modesByCard ? modesByCard.get(`${row.card_id}|${_form}`) : _types) ??
          [],
      ),
      // What the player holds of the card, on the row (6.4.0).
      ...(fit ? { held: heldCard(fit.held, row.card_id, row.form) } : {}),
    }));
    let fitBlock = null;
    if (fit) {
      const fielded = await fieldedLevel(ctx.db, fit.tag, {
        from,
        to,
        types: args.mode ? typesForModeGroup(args.mode) : null,
      });
      fitBlock = {
        player_tag: fit.tag,
        collection_as_of: fit.as_of,
        fielded_mean_level: fielded.mean_level,
        // The level fielded NOW (Gym #133, #171): players_collection's
        // own recent mean, the benchmark a levelling account is judged by.
        recent_mean_level: fielded.recent_mean_level,
        fielded_battles: fielded.battles,
      };
    }
    const clash = comparabilityNote(
      shaped.map((r) => ({ ...r, label: r.name })),
      { what: "card" },
    );
    const population = seg.where
      ? null
      : await populationBlock(ctx.db, { playersInWindow });
    if (compact) shaped = shaped.map(compactCardRow);
    return {
      applied: appliedBlock({
        segment: seg.echo,
        window: win.echo,
        mode: args.mode,
        trophy_band: args.trophy_band,
        cards: args.cards,
        ...(towers ? { tower_troops: true } : {}),
        fit_for: fit?.tag,
        min_battles: minBattles,
        sort,
        limit,
        verbosity: compact ? "compact" : "full",
      }),
      ...(population ? { population } : {}),
      ...(compact ? {} : { methodology: META_METHODOLOGY }),
      decided_battles: totalDecided,
      duel_rounds: duelRounds,
      ...(towers ? { tower_troop_known_battles: towerKnown } : {}),
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
      cards: shaped,
      notes: notes(
        // A tower troop is not a deck card (Gym #282): an empty answer
        // for one says why.
        !towers &&
          (args.cards ?? []).some(
            (id) => cardType(Number(id)) === "tower_troop",
          )
          ? "A tower troop is not one of the eight deck cards: pass tower_troops: true for tower troop rows."
          : null,
        towers
          ? totalDecided > (towerKnown ?? 0)
            ? `Rows are tower troops, each deck's ninth card. The API reports no tower troop on river race (war) battles, so those count in decided_battles and in no row: usage_share is over the ${towerKnown ?? 0} decided observations whose tower troop is known (tower_troop_known_battles); ${totalDecided - (towerKnown ?? 0)} of ${totalDecided} carried none.`
            : "Rows are tower troops, each deck's ninth card: usage_share is over the decided observations whose tower troop is known (tower_troop_known_battles), here all of them."
          : null,
        outsideMetaNote(excluded?.outside_meta ?? 0),
        args.mode === EVENT_MODE_GROUP ? META_EVENT_NOTE : null,
        fitBlock ? cardFitNote(fitBlock, shaped) : NO_FIT_CARDS_NOTE,
        clash,
        modeGroups ? pooledModesNote(modeGroups) : null,
        seg.where ? singlePlayerNote(shaped, { what: "card" }) : null,
        bandPending ? BAND_FALLBACK_NOTE : null,
        // A band on ranked or tournament answers 0 by rule; say why (#204).
        args.trophy_band && args.mode !== "ladder" ? RANKED_NO_BAND_NOTE : null,
        args.trophy_band === "trophy_road_complete" ? CAP_BAND_NOTE : null,
        args.trophy_band && roll
          ? "excluded counts the season and mode, not the band; decided_battles and every row are the band's."
          : null,
        SEGMENT_NOTES,
        collectionSegmentNote(seg),
        win.seasonNotes,
        roll?.note,
        pop?.note,
        FORM_ROWS_NOTE,
        "Card win rates are heavily skill-confounded: compare shrunk rates within similar usage, never across segments.",
      ),
      docs: SEGMENT_DOCS,
      meta: responseMeta({
        as_of: new Date().toISOString(),
        ...(win.timezone ? { timezone_applied: win.timezone } : {}),
      }),
    };
  },
};
