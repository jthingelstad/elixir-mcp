import { cardDisplayName, formName, responseMeta } from "@elixir-mcp/contracts";
import {
  DISPLAY_NAME_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  VERBOSITY,
  ToolFailure,
  appliedBlock,
  cardSetIdentities,
  docsRef,
  notes,
  populationBlock,
} from "../shared.mjs";
import {
  deckSetContext,
  keysOfHashes,
  seasonCardSets,
  valueOfSet,
} from "../../deck-sets-data.mjs";
import { CARD_IDS_ARG } from "./common.mjs";
import {
  FAMILIAR_MIN_BATTLES,
  LOGIT_PER_LEVEL,
  MAX_CARD_LEVELS_BELOW,
  SET_MODES,
  SET_OBJECTIVE,
  nearMisses,
  packSets,
} from "../../deck-sets.mjs";

/** The candidates the exact search runs over, best first: the research
 *  benchmark (2026-09-25) solved 3,000 in under 0.2 s. */
const POOL_CAP = 1500;
const HASH_RE = /^[0-9a-f]{64}$/;

const MODE_NAMES = {
  ladder: "Trophy Road",
  ranked: "Path of Legends",
  war: "Clan Wars",
};

export const battles_deck_sets = {
  description:
    "The best sets of decks a player can field together sharing no card (Clan Wars: four decks, 32 distinct cards; an Evolution or Hero form is the same card), chosen exactly from decks this season's players played in Trophy Road, Path of Legends and Clan Wars and the player's own (duel rounds included), fitted to their collection and levels, the weakest deck counted twice. A deck is its eight cards: every tower troop's record pools. lock_decks keeps decks; exclude_cards and require_cards shape it.",

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
        maxItems: 4,
        description:
          "deck_hash values (from battles_decks, battles_meta_decks or an earlier answer; any tower troop's variant names the same eight cards) that every set keeps; the search fills the rest with decks sharing none of their cards. 'A different last war deck' is the other three locked.",
      },
      exclude_decks: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 8,
        description:
          "deck_hash values no set may choose (any variant names the same eight cards): 'a different last war deck' is the other three locked and the current fourth excluded.",
      },
      exclude_cards: {
        ...CARD_IDS_ARG,
        description:
          "Card ids no chosen deck may hold, any form: cards the player will not play or wants kept free.",
      },
      require_cards: {
        ...CARD_IDS_ARG,
        description:
          "Card ids that must appear somewhere in the set, any form (a locked deck counts); each must be in the player's collection and not excluded.",
      },
      alternatives: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        default: 3,
        description:
          "Sets to return, best first; each after the first differs from every earlier one in at least two of the decks the search chose (fewer when fewer are free).",
      },
      min_battles: {
        type: "integer",
        minimum: 1,
        default: 20,
        description:
          "Decided observations a deck needs this season over Trophy Road, Path of Legends and Clan Wars to be a candidate (eight cards the player has played 5+ times this season, duel rounds included, always are).",
      },
      min_players: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 3,
        description:
          "Repeat players (two or more battles on the deck, in one of those modes) a candidate needs, so a set is built from decks played across players.",
      },
      verbosity: VERBOSITY(
        "each deck as deck_hash, card names in one string, archetype label, record and value; no mode split, variants, objective or population.",
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
    const c = await deckSetContext(ctx, args, "deck sets");
    const { tag, fit, roll, target } = c;
    const minCardLevel =
      target === null ? null : Math.round(target) - MAX_CARD_LEVELS_BELOW;

    // The arguments, settled before anything is searched (feedback #364:
    // contradictions used to run the whole search and time out).
    const locks = [...new Set(args.lock_decks ?? [])];
    const unwanted = [...new Set(args.exclude_decks ?? [])];
    for (const h of [...locks, ...unwanted])
      if (!HASH_RE.test(h))
        throw new ToolFailure(
          "bad_request",
          `lock_decks and exclude_decks take deck_hash values (64 hex characters); '${h}' is not one.`,
        );
    if (locks.length > count)
      throw new ToolFailure(
        "bad_request",
        `count ${count} is fewer than the ${locks.length} locked decks.`,
      );
    const excluded = new Set(args.exclude_cards ?? []);
    const requireIds = [...new Set(args.require_cards ?? [])];
    const names = await cardNames(ctx.db, [...excluded, ...requireIds]);
    const both = requireIds.filter((id) => excluded.has(id));
    if (both.length)
      throw new ToolFailure(
        "bad_request",
        `${listCards(both, names)} ${both.length === 1 ? "is" : "are"} in both require_cards and exclude_cards; a set cannot hold a card and leave it out.`,
      );
    const unheld = requireIds.filter((id) => !fit.held.has(id));
    if (unheld.length)
      throw new ToolFailure(
        "bad_request",
        `require_cards names ${listCards(unheld, names)}, not in ${tag}'s collection, so no set they can field holds ${unheld.length === 1 ? "it" : "them"}.`,
        "players_collection shows what the player holds; drop the card from require_cards.",
      );

    // Locked decks: their eight cards, from the record's deck rows or a
    // card set this answer names (a duel-only deck has no deck row).
    const lockKeyOf = await keysOfHashes(ctx.db, [...locks, ...unwanted]);
    const extra = locks.map((h) => lockKeyOf.get(h)).filter(Boolean);

    // The gates as asked, or the defaults and then, when nothing packs,
    // one wider pass (said in a note): a season's first weeks are thin.
    // The wider pass also drops the level floor: an account whose main
    // decks are maxed and whose other cards are not (one had a card under
    // 12 in 1,585 of 1,864 season decks) is answered with the gap priced
    // by level_term and shown as each deck's lowest card, not refused.
    const explicitGates =
      args.min_battles !== undefined || args.min_players !== undefined;
    const attempts = explicitGates
      ? [[minBattles, minPlayers, minCardLevel]]
      : [
          [minBattles, minPlayers, minCardLevel],
          [5, 2, null],
        ];
    let run;
    for (const [minB, minP, floor] of attempts) {
      run = await attempt(ctx.db, c, {
        minB,
        minP,
        floor,
        locks,
        unwanted,
        lockKeyOf,
        extra,
        excluded,
        requireIds,
        count,
        alternatives,
      });
      if (run.packed.sets.length > 0) break;
    }
    const {
      gatesUsed,
      counts,
      candidates,
      searched,
      capped,
      packed,
      misses,
      bySet,
      valued,
      lockSets,
      free,
      partial,
    } = run;
    const widened = !explicitGates && gatesUsed.min_battles !== minBattles;

    // Render: every card set named, from its own cards.
    const named = new Map();
    const want = (key) => {
      const s = bySet.get(key);
      if (s) named.set(key, s.pairs);
    };
    for (const s of lockSets) want(s.key);
    for (const set of packed.sets) set.keys.forEach(want);
    misses.forEach((m) => want(m.key));
    partial?.keys.forEach(want);
    const identities = await cardSetIdentities(ctx.db, named);
    const towers = await cardNames(
      ctx.db,
      [...bySet.values()].flatMap((s) =>
        s.variants.map((v) => v.tower_troop_id).filter(Boolean),
      ),
    );
    const deckRow = (key, { locked = false } = {}) => {
      const s = bySet.get(key);
      const identity = identities.get(key) ?? { cards: [] };
      const v = valued.get(key) ?? null;
      const cards = identity.cards.map((x) => ({
        ...x,
        held_level: fit.held.get(x.id)?.level ?? null,
      }));
      const lowest = cards
        .filter((x) => x.held_level !== null)
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
      const swaps = (v?.swaps ?? []).map((x) => ({
        id: x.id,
        name: identity.cards.find((y) => y.id === x.id)?.name ?? null,
        form: formName(x.form),
        plays_as: "base",
        form_advantage: x.advantage,
        measured: x.measured,
      }));
      const unowned = (s?.missing_ids ?? []).map((id) => ({
        id,
        name: identity.cards.find((y) => y.id === id)?.name ?? null,
      }));
      const fitBlock = {
        // Every card owned: the deck can be built (feedback #364: a deck
        // played with a form's base card said fieldable false beside the
        // recommendation). exact_form says whether it is as recorded.
        fieldable: s?.owned ?? false,
        exact_form: swaps.length === 0,
        own_mean_level: s?.own_mean ?? null,
        vs_fielded:
          s?.own_mean === null || s?.own_mean === undefined || target === null
            ? null
            : Number((s.own_mean - target).toFixed(3)),
        lowest_card: lowest
          ? { id: lowest.id, name: lowest.name, level: lowest.held_level }
          : null,
        ...(unowned.length ? { unowned } : {}),
      };
      if (compact)
        return {
          deck_hash: s?.deck_hash ?? key,
          locked,
          card_names: identity.cards
            .map((x) => cardDisplayName({ name: x.name, form: x.form }))
            .join(", "),
          archetype_label: identity.archetype?.label ?? null,
          record,
          own_mean_level: fitBlock.own_mean_level,
          ...(unowned.length ? { unowned } : {}),
          forms_substituted: swaps.map((x) => ({ id: x.id, name: x.name })),
          your_battles: s?.yours ?? 0,
          value,
        };
      const byMode = s?.modes ?? {};
      return {
        deck_hash: s?.deck_hash ?? key,
        locked,
        cards,
        variants: (s?.variants ?? []).map((x) => ({
          deck_hash: x.deck_hash,
          tower_troop: x.tower_troop_id
            ? {
                id: x.tower_troop_id,
                name: towers.get(x.tower_troop_id) ?? null,
              }
            : null,
          battles: x.battles,
        })),
        archetype: identity.archetype ?? null,
        record,
        modes: Object.fromEntries(
          SET_MODES.filter((m) => byMode[m]).map((m) => [m, byMode[m]]),
        ),
        forms_substituted: swaps,
        fit: fitBlock,
        your_battles: s?.yours ?? 0,
        your_duel_rounds: s?.your_rounds ?? 0,
        value,
      };
    };
    const lockKeys = lockSets.map((s) => s.key);
    const setRows = (keys, value, i) => {
      const rows = [
        ...lockKeys.map((k) => deckRow(k, { locked: true })),
        ...keys.map((k) => deckRow(k)),
      ];
      const scored = rows.filter((r) => r.value);
      const weakest = scored.length
        ? scored.reduce((a, z) => (z.value.total < a.value.total ? z : a))
        : null;
      const allCards = rows.flatMap((r) =>
        compact ? [] : r.cards.map((x) => x.id),
      );
      return {
        rank: i + 1,
        value,
        weakest_deck: weakest?.deck_hash ?? null,
        ...(compact
          ? {}
          : {
              distinct_cards: new Set(allCards).size,
              card_slots: allCards.length,
            }),
        decks: rows,
      };
    };
    const sets = packed.sets.map((s, i) => setRows(s.keys, s.value, i));
    const nearMissRows = misses.map((m) => ({
      ...deckRow(m.key),
      conflicts: m.conflicts.map((x) => ({
        with_deck: bySet.get(x.with)?.deck_hash ?? x.with,
        cards: x.cards.map((id) => ({
          id,
          name:
            identities.get(m.key)?.cards.find((y) => y.id === id)?.name ?? null,
        })),
      })),
    }));
    // A player with no whole set: the cards one short of the most decks
    // (a fact, a count of decks), so the agent can say what would open up.
    const oneShort = new Map();
    for (const s of bySet.values())
      if (s.missing_ids.length === 1)
        oneShort.set(
          s.missing_ids[0],
          (oneShort.get(s.missing_ids[0]) ?? 0) + 1,
        );
    const oneShortNames = await cardNames(ctx.db, [...oneShort.keys()]);
    const oneCardShort = [...oneShort]
      .sort((a, z) => z[1] - a[1] || a[0] - z[0])
      .slice(0, 5)
      .map(([id, decks]) => ({
        id,
        name: oneShortNames.get(id) ?? null,
        decks,
      }));
    const population = compact
      ? null
      : await populationBlock(ctx.db, { playersInWindow: roll.players });
    const atFloor = gatesUsed.min_battles <= 1 && gatesUsed.min_players <= 1;

    return {
      player: { player_tag: tag, name: c.name },
      applied: appliedBlock({
        player_tag: tag,
        window: c.win.echo,
        modes: SET_MODES,
        count,
        lock_decks: locks.length ? locks : undefined,
        exclude_decks: unwanted.length ? unwanted : undefined,
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
        fielded_mean_level: c.fielded.mean_level,
        recent_mean_level: c.fielded.recent_mean_level,
        fielded_battles: c.fielded.battles,
        target_level: target,
        min_card_level: gatesUsed.min_card_level,
      },
      priors: Object.fromEntries(
        SET_MODES.map((m) => [m, Number(c.priors[m].toFixed(3))]),
      ),
      locked_decks: lockSets.map((s) => deckRow(s.key, { locked: true })),
      candidates: {
        ...counts,
        valued: candidates.length,
        searched: searched.length,
        one_card_short: oneCardShort,
      },
      search: { exhausted: packed.exhausted, pool_capped: capped },
      sets: sets.filter((s) => s.decks.length > 0),
      partial_set: partial
        ? {
            decks_found: partial.keys.length + lockKeys.length,
            decks_asked: count,
            ...setRows(partial.keys, partial.value, 0),
          }
        : null,
      near_misses: nearMissRows,
      notes: notes(
        `A set's decks share no card: a card's Evolution or Hero form is the same card; the tower troop is not one of the ${count * 8}. A deck is its eight cards: Clan Wars battles carry no tower troop, so every tower troop's variant pools into one record (variants lists them), and the player's own Clan Wars duel rounds count as their war games on those cards (modes.war.your_duel_rounds).`,
        `Each deck's record pools ${SET_MODES.map((m) => MODE_NAMES[m]).join(", ")} (modes carries each); a Trophy Road or Clan Wars rate is corrected for its players' level edge at ${LOGIT_PER_LEVEL} log-odds per level, and Path of Legends equalises levels, so its rows are not. familiarity_term rewards eight cards the player has played ${FAMILIAR_MIN_BATTLES}+ times this season.`,
        target === null
          ? "No decided battle this season shows the level this player fields, so there is no level term and no level gate: every deck is valued at the corpus's levels."
          : gatesUsed.min_card_level === null
            ? `Fitted to the level this player fields now (${target}): level_term is ${LOGIT_PER_LEVEL} per level a deck would sit above or below it, with no level floor on this pass (fit.lowest_card shows each deck's weakest card).`
            : `Fitted to the level this player fields now (${target}): level_term is ${LOGIT_PER_LEVEL} per level a deck would sit above or below it, and a deck with a card more than ${MAX_CARD_LEVELS_BELOW} levels under it (under ${gatesUsed.min_card_level}) is left out (candidates.below_level).`,
        widened
          ? `Nothing packed at min_battles ${minBattles}, min_players ${minPlayers}${minCardLevel === null ? "" : ` and a level floor of ${minCardLevel}`}, so the candidates were widened once: min_battles ${gatesUsed.min_battles}, min_players ${gatesUsed.min_players}, no level floor (applied and fit_for.min_card_level say which answered).`
          : null,
        counts.forms_substituted > 0
          ? `${counts.forms_substituted} candidate decks use an Evolution or Hero form the player has not unlocked; they would play its base card, so forms_substituted names each card and form_term subtracts its measured form advantage this season (the season's median, ${c.forms.median} log-odds, where a card's forms are too thin to measure: measured false). Such a deck is still fieldable; fit.exact_form is false.`
          : null,
        counts.not_owned > 0
          ? `${counts.not_owned} candidate decks hold a card the player does not own${oneCardShort.length ? "; candidates.one_card_short names the cards that alone keep the most of them out" : ""}.`
          : null,
        lockSets.some((s) => !s.owned)
          ? "A locked deck holds a card the player does not own (locked_decks[].fit.unowned): it is kept as asked, but they cannot field it today."
          : null,
        sets.length === 0
          ? [
              packed.exhausted
                ? `No set of ${free} deck${free === 1 ? "" : "s"} sharing no card (with the locked decks' cards blocked and the required cards placed) exists among ${searched.length} valued candidates.`
                : `The search found no set of ${free} deck${free === 1 ? "" : "s"} within its budget among ${searched.length} valued candidates.`,
              partial
                ? `partial_set is the best set of ${partial.keys.length + lockKeys.length} that does exist.`
                : null,
              atFloor
                ? null
                : "Lowering min_battles or min_players admits more decks;",
              requireIds.length || excluded.size
                ? "dropping an exclude or a require frees the search;"
                : null,
              "battles_deck_upgrades says which upgrades would lift the decks the player can field.",
            ]
              .filter(Boolean)
              .join(" ")
          : sets.length < alternatives
            ? `Only ${sets.length} of the ${alternatives} sets asked for exist that differ from each other by at least two chosen decks.`
            : null,
        packed.exhausted || sets.length === 0
          ? null
          : "The search stopped at its node budget; the sets are the best it found, not proven best.",
        capped
          ? `The search ran over the ${POOL_CAP} highest-valued of ${candidates.length} candidates.`
          : null,
        misses.length
          ? "near_misses are decks valued at least as high as the first set's weakest deck that it could not hold, each with the cards it shares with a chosen deck."
          : null,
        "value is an ordering, not a forecast: a deck's record is its players', and pilots differ; shrinkage moderates small samples but does not adjust for skill.",
        c.win.seasonNotes,
        roll.note,
      ),
      docs: docsRef("war-decks", "deck-sets"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};

/** One pass at one set of gates: the candidates, their values and the
 *  exact search, with the locked decks resolved and valued like any
 *  other. */
async function attempt(db, c, o) {
  const {
    minB,
    minP,
    floor,
    locks,
    unwanted,
    lockKeyOf,
    extra,
    excluded,
    count,
  } = o;
  const gatesUsed = {
    min_battles: minB,
    min_players: minP,
    min_card_level: floor,
  };
  const pool = await seasonCardSets(db, {
    month: c.roll.month,
    minBattles: minB,
    minPlayers: minP,
    tag: c.tag,
    from: c.from,
    to: c.to,
    held: c.fit.held,
    extra,
  });
  const bySet = new Map(pool.map((s) => [s.key, s]));
  // A lock that names no deck row may be a card set this answer named
  // (its tower-less identity).
  const byHash = new Map(pool.map((s) => [s.deck_hash, s.key]));
  const lockKeys = locks.map((h) => lockKeyOf.get(h) ?? byHash.get(h) ?? null);
  const unknown = locks.filter((_, i) => lockKeys[i] === null);
  if (unknown.length)
    throw new ToolFailure(
      "not_found",
      `No recorded deck with deck_hash ${unknown.join(", ")}.`,
      "Take deck_hash from battles_decks (the player's own decks), battles_meta_decks or an earlier battles_deck_sets answer.",
    );
  const lockSets = [...new Set(lockKeys)].map((k) => bySet.get(k));
  // Decks no set may choose, by their eight cards; one not in the record
  // simply is not a candidate.
  const unwantedKeys = new Set(
    unwanted.map((h) => lockKeyOf.get(h) ?? byHash.get(h)).filter(Boolean),
  );
  const both = lockSets.filter((x) => unwantedKeys.has(x.key));
  if (both.length)
    throw new ToolFailure(
      "bad_request",
      "A deck is in both lock_decks and exclude_decks; a set cannot keep a deck and leave it out.",
    );
  // Locked decks that share cards: every shared card, by name.
  const owner = new Map();
  const clashes = new Map();
  for (const s of lockSets)
    for (const id of s.ids) {
      if (owner.has(id)) clashes.set(id, s);
      else owner.set(id, s);
    }
  if (clashes.size) {
    const names = await cardNames(db, [...clashes.keys()]);
    throw new ToolFailure(
      "bad_request",
      `The locked decks share ${listCards([...clashes.keys()], names)}; a set's decks share no card.`,
    );
  }
  const blocked = new Set(owner.keys());
  const free = count - lockSets.length;
  const required = o.requireIds.filter((id) => !blocked.has(id));

  const counts = {
    considered: pool.length,
    excluded_decks: 0,
    excluded_cards: 0,
    shares_locked_cards: 0,
    not_owned: 0,
    below_level: 0,
    fieldable: 0,
    forms_substituted: 0,
    no_competitive_record: 0,
  };
  const lockKeySet = new Set(lockSets.map((s) => s.key));
  const valued = new Map();
  const candidates = [];
  // Why a deck left, in order: what the question rules out (excluded
  // cards, a locked deck's cards) before what the collection does.
  for (const s of pool) {
    if (lockKeySet.has(s.key)) continue;
    if (unwantedKeys.has(s.key)) counts.excluded_decks++;
    else if (s.ids.some((id) => excluded.has(id))) counts.excluded_cards++;
    else if (s.ids.some((id) => blocked.has(id))) counts.shares_locked_cards++;
    else if (!s.owned) counts.not_owned++;
    else if (floor !== null && s.min_level < floor) counts.below_level++;
    else {
      counts.fieldable++;
      if (s.missing_forms.length) counts.forms_substituted++;
      const v = valueOfSet(s, c);
      if (!v) {
        counts.no_competitive_record++;
        continue;
      }
      valued.set(s.key, v);
      candidates.push({ key: s.key, cards: new Set(s.ids), value: v.value });
    }
  }
  for (const s of lockSets) {
    const v = valueOfSet(s, c);
    if (v) valued.set(s.key, v);
  }
  candidates.sort((a, z) => z.value - a.value);
  const capped = candidates.length > POOL_CAP;
  const searched = candidates.slice(0, POOL_CAP);
  const fixed = lockSets
    .map((s) => valued.get(s.key)?.value)
    .filter((v) => v !== undefined);
  const opts = {
    alternatives: o.alternatives,
    minDiffer: Math.min(2, free),
    require: required,
    blocked,
    fixed,
  };
  const packed = packSets(searched, { ...opts, count: free });
  const misses = free > 0 ? nearMisses(searched, packed.sets[0]) : [];
  // No whole set: the best smaller one, so the answer is never a dead end.
  let partial = null;
  if (packed.sets.length === 0)
    for (let k = free - 1; k >= 1 && !partial; k--) {
      const p = packSets(searched, {
        ...opts,
        count: k,
        alternatives: 1,
        nodeBudget: 300_000,
      });
      if (p.sets.length) partial = p.sets[0];
    }
  return {
    gatesUsed,
    counts,
    candidates,
    searched,
    capped,
    packed,
    misses,
    bySet,
    valued,
    lockSets,
    free,
    partial,
  };
}

async function cardNames(db, ids) {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return new Map();
  const { rows } = await db.query(
    "select card_id, name from card where card_id = any($1)",
    [wanted],
  );
  return new Map(rows.map((r) => [r.card_id, r.name]));
}

function listCards(ids, names) {
  const parts = ids.map((id) =>
    names.get(id) ? `${names.get(id)} (${id})` : `card ${id}`,
  );
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
