import { responseMeta, typesForModeGroup } from "@elixir-mcp/contracts";
import {
  DISPLAY_NAME_SCHEMA,
  META_METHODOLOGY,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  VERBOSITY,
  ToolFailure,
  appliedBlock,
  deckFit,
  deckIdentities,
  docsRef,
  fieldedLevel,
  notes,
  populationBlock,
  resolveFitFor,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import { seasonRollup } from "../../meta-season.mjs";
import { CARD_IDS_ARG } from "./common.mjs";
import {
  FAMILIAR_MIN_BATTLES,
  MAX_CARD_LEVELS_BELOW,
  formAdvantage,
  SET_MODES,
  SET_OBJECTIVE,
  deckValue,
  nearMisses,
  packSets,
} from "../../deck-sets.mjs";

/** The candidates the exact search runs over, best first: the research
 *  benchmark (2026-09-25) solved 3,000 in under 0.2 s. */
const POOL_CAP = 1500;
const HASH_RE = /^[0-9a-f]{64}$/;
const COMPETITIVE_TYPES = SET_MODES.flatMap((m) => typesForModeGroup(m));

const MODE_NAMES = {
  ladder: "Trophy Road",
  ranked: "Path of Legends",
  war: "Clan Wars",
};

export const battles_deck_sets = {
  description:
    "The best sets of decks a player can field together sharing no card (Clan Wars: four decks, 32 distinct cards; a card's Evolution or Hero form is the same card). Chosen exactly from decks this season's recorded players played in Trophy Road, Path of Legends and Clan Wars, fitted to the player's collection and levels, the weakest deck counted twice. lock_decks keeps decks and fills the rest; exclude_cards and require_cards shape it. Each deck carries its record, mode split, fit and value parts.",
  inputSchema: {
    type: "object",
    properties: {
      player_tag: TAG_SCHEMA,
      on_behalf_of: ON_BEHALF_OF_SCHEMA,
      display_name: DISPLAY_NAME_SCHEMA,
      season: SEASON_ARG_SCHEMA,
      count: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        default: 4,
        description:
          "Decks in a set, locked decks included: 4 for a Clan Wars set.",
      },
      lock_decks: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 3,
        description:
          "deck_hash values (from battles_decks, battles_meta_decks or an earlier answer) that every set keeps; the search fills the rest with decks sharing none of their cards. 'A different last war deck' is the other three locked.",
      },
      exclude_cards: {
        ...CARD_IDS_ARG,
        description:
          "Card ids no chosen deck may hold, any form: cards the player will not play or wants kept free.",
      },
      require_cards: {
        ...CARD_IDS_ARG,
        description:
          "Card ids that must appear somewhere in the set, any form (a locked deck counts).",
      },
      alternatives: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        default: 3,
        description:
          "Sets to return, best first; each after the first shares at most count - 2 decks with every earlier one.",
      },
      min_battles: {
        type: "integer",
        minimum: 1,
        default: 20,
        description:
          "Decided observations a deck needs this season to be a candidate (a deck the player has played 5+ times this season is always one).",
      },
      min_players: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 3,
        description:
          "Repeat players (two or more battles on the deck) a candidate needs, so a set is built from decks played across players.",
      },
      verbosity: VERBOSITY(
        "each deck as deck_hash, card names in one string, archetype label, record and value; no mode split, objective or population.",
      ),
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const compact = args.verbosity === "compact";
    const count = args.count ?? 4;
    const alternatives = args.alternatives ?? 3;
    const minBattles = args.min_battles ?? 20;
    const minPlayers = args.min_players ?? 3;
    const { tag } = await subject(
      ctx.db,
      ctx.account,
      args.player_tag,
      "summary",
      args.on_behalf_of,
      args.display_name,
    );
    const fit = await resolveFitFor(ctx.db, tag);
    const win = await resolveSeasonWindow(ctx, { season: args.season });
    const roll = await seasonRollup(ctx.db, { win, seg: null, mode: null });
    if (!roll)
      throw new ToolFailure(
        "not_recorded",
        `No season rollup covers ${win.season?.season_month ?? "that window"} yet.`,
        "Deck sets read the season's deck rollup, rebuilt nightly; pass season:'previous' for the last full season.",
      );
    const from = win.from.toISOString();
    const to = win.to ? win.to.toISOString() : null;

    // The level the player fields now, over the same modes: the target a
    // held level reads against and the level gate's anchor.
    const fielded = await fieldedLevel(ctx.db, tag, {
      from,
      to,
      types: COMPETITIVE_TYPES,
    });
    const target = fielded.recent_mean_level ?? fielded.mean_level;
    const minCardLevel =
      target === null ? null : Math.round(target) - MAX_CARD_LEVELS_BELOW;

    // The decks they know: played 5+ times this season, a candidate
    // whatever the population gates say.
    const { rows: ownRows } = await ctx.db.query(
      `select deck_hash, count(*)::int as n from battle_participant
        where player_tag = $1 and battle_time >= $2
          and ($3::timestamptz is null or battle_time < $3)
          and type = any($4) and type_class = 'pvp'
          and outcome in ('win', 'loss') and deck_hash is not null
        group by deck_hash`,
      [tag, from, to, COMPETITIVE_TYPES],
    );
    const yours = new Map(ownRows.map((r) => [r.deck_hash, r.n]));
    const familiar = ownRows
      .filter((r) => r.n >= FAMILIAR_MIN_BATTLES)
      .map((r) => r.deck_hash);

    // Locked decks: their cards leave the pool, their slots leave the count.
    const locks = [...new Set(args.lock_decks ?? [])];
    for (const h of locks)
      if (!HASH_RE.test(h))
        throw new ToolFailure(
          "bad_request",
          `lock_decks takes deck_hash values (64 hex characters); '${h}' is not one.`,
        );
    if (locks.length > count)
      throw new ToolFailure(
        "bad_request",
        `count ${count} is fewer than the ${locks.length} locked decks.`,
      );
    const lockCards = new Map();
    if (locks.length) {
      const { rows } = await ctx.db.query(
        `select deck_hash, card_id from deck_card where deck_hash = any($1)`,
        [locks],
      );
      for (const r of rows) {
        if (!lockCards.has(r.deck_hash)) lockCards.set(r.deck_hash, new Set());
        lockCards.get(r.deck_hash).add(r.card_id);
      }
      const unknown = locks.filter((h) => !lockCards.has(h));
      if (unknown.length)
        throw new ToolFailure(
          "not_found",
          `No recorded deck with deck_hash ${unknown.join(", ")}.`,
          "Take deck_hash from battles_decks (the player's own decks), battles_meta_decks or an earlier battles_deck_sets answer.",
        );
      const seen = new Set();
      for (const cards of lockCards.values())
        for (const id of cards) {
          if (seen.has(id))
            throw new ToolFailure(
              "bad_request",
              `The locked decks share card ${id}; a set's decks share no card.`,
            );
          seen.add(id);
        }
    }
    const blocked = new Set([...lockCards.values()].flatMap((s) => [...s]));

    // The corpus prior per mode, and each card's measured form advantage
    // (its Evolution or Hero form's shrunk rate against its base form's
    // this season): the price of playing a deck with a form not unlocked.
    const priors = {};
    for (const mode of SET_MODES) {
      const m = await seasonRollup(ctx.db, { win, seg: null, mode });
      priors[mode] = m?.prior?.mean ?? 0.5;
    }
    const { rows: formRows } = await ctx.db.query(
      `select card_id, form, battles, wins from card_meta_season
        where season_month = $1 and mode_group = 'all' and form in (0, 1, 2)`,
      [roll.month],
    );
    const byCard = new Map();
    for (const r of formRows) {
      if (!byCard.has(r.card_id)) byCard.set(r.card_id, {});
      byCard.get(r.card_id)[r.form] = r;
    }
    const prior = roll.prior.mean ?? 0.5;
    const measured = [];
    const advantage = new Map();
    for (const [id, forms] of byCard)
      for (const form of [1, 2]) {
        const a = formAdvantage({
          form: forms[form],
          base: forms[0],
          prior,
          m: META_METHODOLOGY.prior_strength,
        });
        if (a !== null) {
          advantage.set(`${id}:${form}`, a);
          measured.push(a);
        }
      }
    measured.sort((a, z) => a - z);
    const medianAdvantage = measured.length
      ? measured[Math.floor(measured.length / 2)]
      : 0;

    const lockMeans = new Map();
    if (locks.length) {
      const { rows } = await ctx.db.query(
        `select dc.deck_hash, round(avg(pc.level)::numeric, 3) as own_mean
           from deck_card dc left join player_card pc
             on pc.card_id = dc.card_id and pc.player_tag = $2
          where dc.deck_hash = any($1) group by dc.deck_hash`,
        [locks, tag],
      );
      for (const r of rows) lockMeans.set(r.deck_hash, Number(r.own_mean));
    }
    const excluded = new Set(args.exclude_cards ?? []);
    const free = count - locks.length;
    const required = (args.require_cards ?? []).filter(
      (id) => !blocked.has(id),
    );
    // The gates as asked, or the defaults and then, when nothing packs,
    // one wider pass (said in a note): a season's first weeks are thin.
    const explicitGates =
      args.min_battles !== undefined || args.min_players !== undefined;
    const attempts = explicitGates
      ? [[minBattles, minPlayers]]
      : [
          [minBattles, minPlayers],
          [5, 2],
        ];
    let counts;
    let candidates;
    let searched;
    let capped;
    let packed;
    let misses;
    let modes;
    let valued;
    let substituted;
    let gatesUsed;
    for (const [minB, minP] of attempts) {
      gatesUsed = { min_battles: minB, min_players: minP };
      // Every deck in the season rollup over the gates (or theirs),
      // checked against the collection in SQL: owned, which forms are not
      // unlocked, the lowest card's level. Eight-card decks only.
      const { rows: pool } = await ctx.db.query(
        `with cand as (
           select deck_hash from deck_meta_season
            where season_month = $1 and mode_group = 'all'
              and ((battles >= $2 and coalesce(repeat_players, players, 0) >= $3)
                   or deck_hash = any($5))
         ),
         held as (
           select card_id, level, coalesce(evolution_level, 0) as ev
             from player_card where player_tag = $4
         )
         select c.deck_hash,
                bool_and(h.card_id is not null) as owned,
                array_agg(dc.card_id || ':' || dc.form)
                  filter (where h.card_id is not null and dc.form <> 0 and (h.ev & dc.form) = 0)
                  as missing_forms,
                min(h.level) as min_level,
                round(avg(h.level)::numeric, 3) as own_mean,
                array_agg(dc.card_id order by dc.card_id) as card_ids
           from cand c
           join deck_card dc on dc.deck_hash = c.deck_hash
           left join held h on h.card_id = dc.card_id
          group by c.deck_hash
         having count(distinct dc.card_id) = 8`,
        [roll.month, minB, minP, tag, familiar],
      );
      counts = {
        considered: pool.length,
        not_owned: 0,
        below_level: 0,
        excluded_cards: 0,
        shares_locked_cards: 0,
        fieldable: 0,
        forms_substituted: 0,
      };
      const fieldable = [];
      substituted = new Map();
      for (const r of pool) {
        if (!r.owned) counts.not_owned++;
        else if (minCardLevel !== null && r.min_level < minCardLevel)
          counts.below_level++;
        else if (r.card_ids.some((id) => excluded.has(id)))
          counts.excluded_cards++;
        else if (locks.includes(r.deck_hash)) continue;
        else if (r.card_ids.some((id) => blocked.has(id)))
          counts.shares_locked_cards++;
        else {
          fieldable.push(r);
          if (r.missing_forms?.length) {
            counts.forms_substituted++;
            substituted.set(
              r.deck_hash,
              r.missing_forms.map((x) => {
                const [id, form] = x.split(":").map(Number);
                const a = advantage.get(`${id}:${form}`);
                return {
                  id,
                  form,
                  advantage: a ?? medianAdvantage,
                  measured: a !== undefined,
                };
              }),
            );
          }
        }
      }
      counts.fieldable = fieldable.length;

      // Each fieldable deck's record by mode.
      const scoreHashes = [...fieldable.map((r) => r.deck_hash), ...locks];
      const { rows: modeRows } = scoreHashes.length
        ? await ctx.db.query(
            `select deck_hash, mode_group, battles, wins, losses,
                    round((level_gap_sum / nullif(level_gap_battles, 0))::numeric, 2) as mean_level_gap
               from deck_meta_season
              where season_month = $1 and mode_group = any($2) and deck_hash = any($3)`,
            [roll.month, SET_MODES, scoreHashes],
          )
        : { rows: [] };
      modes = new Map();
      for (const r of modeRows) {
        if (!modes.has(r.deck_hash)) modes.set(r.deck_hash, {});
        modes.get(r.deck_hash)[r.mode_group] = {
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          mean_level_gap:
            r.mean_level_gap === null ? null : Number(r.mean_level_gap),
        };
      }
      valued = new Map();
      const valueOf = (hash, ownMean) =>
        deckValue({
          modes: modes.get(hash) ?? {},
          priors,
          ownMean,
          target,
          yours: yours.get(hash) ?? 0,
          formTerm: -(substituted.get(hash) ?? []).reduce(
            (sum, x) => sum + x.advantage,
            0,
          ),
          m: META_METHODOLOGY.prior_strength,
        });
      candidates = [];
      for (const r of fieldable) {
        const v = valueOf(r.deck_hash, Number(r.own_mean));
        if (!v || v.battles < 1) continue;
        valued.set(r.deck_hash, { ...v, own_mean: Number(r.own_mean) });
        candidates.push({
          key: r.deck_hash,
          cards: new Set(r.card_ids),
          value: v.value,
        });
      }
      for (const h of locks) {
        const v = valueOf(h, lockMeans.get(h) ?? null);
        if (v) valued.set(h, { ...v, own_mean: lockMeans.get(h) ?? null });
      }
      candidates.sort((a, z) => z.value - a.value);
      capped = candidates.length > POOL_CAP;
      searched = candidates.slice(0, POOL_CAP);

      // The search: the free slots, the locked decks' cards blocked, the
      // required cards not already in a locked deck.
      packed =
        free > 0
          ? packSets(searched, {
              count: free,
              alternatives,
              minDiffer: Math.min(2, free),
              require: required,
              blocked,
            })
          : { sets: [{ keys: [], value: 0 }], exhausted: true };
      misses = free > 0 ? nearMisses(searched, packed.sets[0]) : [];
      if (packed.sets.length > 0) break;
    }
    const widened = !explicitGates && gatesUsed.min_battles !== minBattles;

    // Render: identities for every deck named, then the rows.
    const named = [
      ...new Set([
        ...locks,
        ...packed.sets.flatMap((s) => s.keys),
        ...misses.map((m) => m.key),
      ]),
    ];
    const identities = await deckIdentities(ctx.db, named);
    const fieldedBenchmark = target;
    const deckRow = (hash, { locked = false } = {}) => {
      const identity = identities.get(hash) ?? { cards: [] };
      const v = valued.get(hash) ?? null;
      const byMode = modes.get(hash) ?? {};
      const cards = identity.cards.map((c) => ({
        ...c,
        held_level: fit.held.get(c.id)?.level ?? null,
      }));
      const fitParts = deckFit(identity.cards, fit.held, fieldedBenchmark);
      const lowest = cards
        .filter((c) => c.held_level !== null)
        .sort((a, z) => a.held_level - z.held_level)[0];
      const record = v
        ? {
            battles: v.battles,
            wins: v.wins,
            losses: v.battles - v.wins,
            win_rate: Number((v.wins / v.battles).toFixed(3)),
            shrunk_win_rate: v.shrunk_win_rate,
          }
        : null;
      const value = v
        ? {
            total: v.value,
            corpus_logit: v.corpus_logit,
            level_term: v.level_term,
            form_term: v.form_term,
            familiarity_term: v.familiarity_term,
          }
        : null;
      // A form the player has not unlocked: they would play the base card.
      const swaps = (substituted.get(hash) ?? []).map((x) => ({
        id: x.id,
        name: identity.cards.find((c) => c.id === x.id)?.name ?? null,
        form: x.form === 1 ? "evolution" : "hero",
        plays_as: "base",
        form_advantage: x.advantage,
        measured: x.measured,
      }));
      if (compact)
        return {
          deck_hash: hash,
          locked,
          card_names: identity.cards
            .map((c) =>
              c.form && c.form !== "base"
                ? `${c.form === "evolution" ? "Evo" : "Hero"} ${c.name}`
                : c.name,
            )
            .join(", "),
          archetype_label: identity.archetype?.label ?? null,
          record,
          own_mean_level: fitParts.own_mean_level,
          forms_substituted: swaps.map((x) => x.name),
          your_battles: yours.get(hash) ?? 0,
          value,
        };
      return {
        deck_hash: hash,
        locked,
        cards,
        ...(identity.tower_troop ? { tower_troop: identity.tower_troop } : {}),
        archetype: identity.archetype ?? null,
        record,
        modes: Object.fromEntries(
          SET_MODES.filter((m) => byMode[m]).map((m) => [m, byMode[m]]),
        ),
        forms_substituted: swaps,
        fit: {
          fieldable: fitParts.fieldable,
          own_mean_level: fitParts.own_mean_level,
          vs_fielded: fitParts.vs_fielded,
          lowest_card: lowest
            ? { id: lowest.id, name: lowest.name, level: lowest.held_level }
            : null,
        },
        your_battles: yours.get(hash) ?? 0,
        value,
      };
    };
    const sets = packed.sets.map((s, i) => {
      const rows = [
        ...locks.map((h) => deckRow(h, { locked: true })),
        ...s.keys.map((h) => deckRow(h)),
      ];
      const scored = rows.filter((r) => r.value);
      const weakest = scored.length
        ? scored.reduce((a, z) => (z.value.total < a.value.total ? z : a))
        : null;
      const allCards = rows.flatMap((r) =>
        compact ? [] : r.cards.map((c) => c.id),
      );
      return {
        rank: i + 1,
        value: s.value,
        weakest_deck: weakest?.deck_hash ?? null,
        ...(compact
          ? {}
          : {
              distinct_cards: new Set(allCards).size,
              card_slots: allCards.length,
            }),
        decks: rows,
      };
    });
    const nearMissRows = misses.map((m) => ({
      ...deckRow(m.key),
      conflicts: m.conflicts.map((c) => ({
        with_deck: c.with,
        cards: c.cards.map((id) => ({
          id,
          name:
            identities.get(m.key)?.cards.find((x) => x.id === id)?.name ?? null,
        })),
      })),
    }));
    const population = compact
      ? null
      : await populationBlock(ctx.db, { playersInWindow: roll.players });
    const { rows: nameRows } = await ctx.db.query(
      "select name from player where player_tag = $1",
      [tag],
    );

    return {
      player: { player_tag: tag, name: nameRows[0]?.name ?? null },
      applied: appliedBlock({
        player_tag: tag,
        window: win.echo,
        modes: SET_MODES,
        count,
        lock_decks: locks.length ? locks : undefined,
        exclude_cards: args.exclude_cards,
        require_cards: args.require_cards,
        alternatives,
        min_battles: gatesUsed.min_battles,
        min_players: gatesUsed.min_players,
        verbosity: compact ? "compact" : "full",
      }),
      ...(compact ? {} : { objective: SET_OBJECTIVE, population }),
      fit_for: {
        player_tag: tag,
        collection_as_of: fit.as_of,
        fielded_mean_level: fielded.mean_level,
        recent_mean_level: fielded.recent_mean_level,
        fielded_battles: fielded.battles,
        target_level: target,
        min_card_level: minCardLevel,
      },
      priors: Object.fromEntries(
        SET_MODES.map((m) => [m, Number(priors[m].toFixed(3))]),
      ),
      candidates: {
        ...counts,
        valued: candidates.length,
        searched: searched.length,
      },
      search: { exhausted: packed.exhausted, pool_capped: capped },
      sets: sets.filter((s) => s.decks.length > 0),
      near_misses: nearMissRows,
      notes: notes(
        `A set's decks share no card: a card's Evolution or Hero form is the same card; the tower troop is not one of the ${count * 8}. Every candidate is a deck this season's recorded players played, so each deck's Evolution and Hero slots are as the game allowed.`,
        `Each deck's record pools ${SET_MODES.map((m) => MODE_NAMES[m]).join(", ")} (modes carries each); a Trophy Road or Clan Wars rate is corrected for its players' level edge at 0.5 log-odds per level, and Path of Legends equalises levels, so its rows are not.`,
        target === null
          ? "No decided battle this season shows the level this player fields, so there is no level term and no level gate: every deck is valued at the corpus's levels."
          : `Fitted to the level this player fields now (${target}): level_term is 0.5 per level a deck would sit above or below it, and only a deck with a card under ${minCardLevel} is left out (candidates.below_level).`,
        widened
          ? `Nothing packed at min_battles ${minBattles} and min_players ${minPlayers}, so the candidates were widened to min_battles ${gatesUsed.min_battles} and min_players ${gatesUsed.min_players} (applied says which answered).`
          : null,
        counts.forms_substituted > 0
          ? `${counts.forms_substituted} candidate decks use an Evolution or Hero form the player has not unlocked; they would play its base card, so forms_substituted names each card and form_term subtracts its measured form advantage this season (the season's median, ${medianAdvantage} log-odds, where a card's forms are too thin to measure: measured false).`
          : null,
        counts.not_owned > 0
          ? `${counts.not_owned} candidate decks hold a card the player does not own.`
          : null,
        sets.length === 0
          ? `No set of ${free} deck${free === 1 ? "" : "s"} sharing no card (with the locked decks' cards blocked and the required cards placed) exists among ${searched.length} valued candidates. Lower min_battles or min_players, drop an exclude or require, or pass season:'previous'.`
          : sets.length < alternatives
            ? `Only ${sets.length} of the ${alternatives} sets asked for exist that differ from each other by at least two decks.`
            : null,
        packed.exhausted
          ? null
          : "The search stopped at its node budget; the sets are the best it found, not proven best.",
        capped
          ? `The search ran over the ${POOL_CAP} highest-valued of ${candidates.length} candidates.`
          : null,
        misses.length
          ? "near_misses are decks valued at least as high as the first set's weakest deck that it could not hold, each with the cards it shares with a chosen deck."
          : null,
        "value is an ordering, not a forecast: a deck's record is its players', and pilots differ; shrinkage moderates small samples but does not adjust for skill.",
        win.seasonNotes,
        roll.note,
      ),
      docs: docsRef("battles", "deck-sets"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
