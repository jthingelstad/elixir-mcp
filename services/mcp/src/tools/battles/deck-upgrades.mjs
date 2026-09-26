import { cardDisplayName, formName, responseMeta } from "@elixir-mcp/contracts";
import {
  DISPLAY_NAME_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  VERBOSITY,
  appliedBlock,
  cardSetIdentities,
  docsRef,
  notes,
} from "../shared.mjs";
import {
  deckSetContext,
  seasonCardSets,
  valueOfSet,
} from "../../deck-sets-data.mjs";
import { LOGIT_PER_LEVEL, SET_OBJECTIVE, packSets } from "../../deck-sets.mjs";

/** The decks re-packed per option, best first after the option. */
const SEARCH_CAP = 600;
/** Options priced, most promising first. */
const OPTION_CAP = 60;
/** Decks within reach priced, best ceiling first. */
const REACH_CAP = 40;

/**
 * battles_deck_upgrades (9.7.0; Jamie, 2026-09-25: "there is also an angle
 * to think about cards that could be unlocked with some upgrades... that is
 * a whole other tool"). The companion of battles_deck_sets: which single
 * upgrade (a card raised toward the level the player fields, or an
 * Evolution or Hero form unlocked) lifts the player's best set of decks
 * sharing no card the most, each option priced by re-packing the set with
 * it; and which decks would join the set once their low cards reach that
 * level (one card raised rarely moves a deck held two levels under). Facts
 * and the disclosed ordering only: levels, never gold (the game's upgrade
 * costs are not in the record), and no score of its own (DECISIONS
 * declined adoption_cost): the gain is the change in the same set value
 * battles_deck_sets optimises, over the same card sets (9.8.0).
 */
export const battles_deck_upgrades = {
  description:
    "Which single upgrade lifts a player's best set of decks sharing no card the most (a card raised toward the level they field, or an Evolution or Hero form unlocked), and which decks would join that set once their low cards reach that level. Each is priced by re-packing the set exactly, over battles_deck_sets' decks: the set's value before and after, the decks it lifts, the levels it takes, the set it gives. Levels, not gold.",

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
          "Decks in the set the upgrades are judged by: 4 for Clan Wars.",
      },
      max_levels: {
        type: "integer",
        minimum: 1,
        maximum: 6,
        default: 2,
        description:
          "The most levels one option raises a card, toward the level the player fields; a deck is within reach only when each of its cards is at most this many under.",
      },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
      verbosity: VERBOSITY(
        "each option and deck within reach without set_after; decks as deck_hash, label and value only.",
      ),
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const compact = args.verbosity === "compact";
    const count = args.count ?? 4;
    const maxLevels = args.max_levels ?? 2;
    const limit = args.limit ?? 8;
    const c = await deckSetContext(ctx, args, "upgrades");
    const { tag, fit, target } = c;
    const targetLevel = target === null ? null : Math.round(target);

    // The card sets the player owns every card of, at the default gates,
    // then once wider when those pack no set; no level floor (the gap is
    // the point).
    let decks = [];
    let gates = null;
    let base = new Map();
    let baseSet = null;
    let exhausted = true;
    let widened = false;
    const pack = (values) => {
      const list = decks
        .filter((d) => values.has(d.key))
        .map((d) => ({ key: d.key, cards: d.cards, value: values.get(d.key) }))
        .sort((a, z) => z.value - a.value)
        .slice(0, SEARCH_CAP);
      return packSets(list, { count, nodeBudget: 300_000 });
    };
    for (const [minB, minP] of [
      [20, 3],
      [5, 2],
    ]) {
      const pool = await seasonCardSets(ctx.db, {
        month: c.roll.month,
        minBattles: minB,
        minPlayers: minP,
        tag,
        from: c.from,
        to: c.to,
        held: fit.held,
      });
      gates = { min_battles: minB, min_players: minP };
      widened = minB !== 20;
      decks = pool
        .filter((s) => s.owned)
        .map((s) => ({ ...s, cards: new Set(s.ids) }));
      base = new Map();
      for (const d of decks) {
        const v = valueOfSet(d, c);
        if (v) base.set(d.key, v.value);
      }
      const baseline = pack(base);
      exhausted = baseline.exhausted;
      baseSet = baseline.sets[0] ?? null;
      if (baseSet) break;
    }

    // Re-pack with some cards raised (id -> level) and some forms unlocked
    // (`id:form`): every deck holding a changed card revalued.
    const repack = ({ raised = new Map(), unlocked = new Set() }) => {
      const values = new Map(base);
      const touched = new Set([
        ...raised.keys(),
        ...[...unlocked].map((k) => Number(k.split(":")[0])),
      ]);
      for (const d of decks) {
        if (!d.ids.some((id) => touched.has(id))) continue;
        const v = valueOfSet(d, c, { raised, unlocked });
        if (v) values.set(d.key, v.value);
      }
      const after = pack(values);
      if (!after.exhausted) exhausted = false;
      const set = after.sets[0];
      if (!set) return null;
      const gain = Number((set.value - baseSet.value).toFixed(3));
      if (gain <= 0.001) return null;
      return {
        value_before: baseSet.value,
        value_after: set.value,
        gain,
        set_changes:
          set.keys.slice().sort().join() !== baseSet.keys.slice().sort().join(),
        set_after: set.keys.map((k) => ({ key: k, value: values.get(k) })),
      };
    };

    let options = [];
    let reach = [];
    if (baseSet) {
      const inSet = new Set(baseSet.keys);
      const weakest = Math.min(...baseSet.keys.map((k) => base.get(k)));
      // A deck's ceiling: every card at least at the fielded level (a card
      // already above it stays where it is) and every form unlocked. A deck
      // whose ceiling clears the set's weakest deck could reach the set.
      const ceilingOf = (d) =>
        valueOfSet(d, c, {
          raised:
            targetLevel === null
              ? null
              : new Map(
                  d.ids.map((id) => [
                    id,
                    Math.max(fit.held.get(id)?.level ?? 0, targetLevel),
                  ]),
                ),
          unlocked: new Set(d.missing_forms),
        })?.value ?? -Infinity;
      const reachable = decks.filter(
        (d) => inSet.has(d.key) || ceilingOf(d) >= weakest,
      );
      // Each option's promise, in log-odds: how close its best deck sits to
      // the set's weakest (a deck in the set counts most) plus what the
      // option adds to that deck. The most promising are priced first.
      const byOption = new Map();
      const consider = (key, seed, now, adds) => {
        const o = byOption.get(key) ?? {
          ...seed,
          decks: 0,
          promise: -Infinity,
        };
        o.decks += 1;
        o.promise = Math.max(o.promise, now + adds - weakest);
        byOption.set(key, o);
      };
      for (const d of reachable) {
        const now = base.get(d.key) ?? -Infinity;
        for (const id of d.ids) {
          const held = fit.held.get(id)?.level ?? null;
          if (targetLevel === null || held === null || held >= targetLevel)
            continue;
          const to = Math.min(targetLevel, held + maxLevels);
          consider(
            `level:${id}`,
            {
              kind: "level",
              id,
              held_level: held,
              to_level: to,
              levels: to - held,
            },
            now,
            (LOGIT_PER_LEVEL * (to - held)) / d.ids.length,
          );
        }
        for (const k of d.missing_forms) {
          const [id, form] = k.split(":").map(Number);
          consider(
            `form:${k}`,
            { kind: "form", id, form },
            now,
            c.forms.advantage.get(k) ?? c.forms.median,
          );
        }
      }
      const priced = [...byOption.values()]
        .sort((a, z) => z.promise - a.promise || z.decks - a.decks)
        .slice(0, OPTION_CAP);
      for (const o of priced) {
        const result = repack(
          o.kind === "level"
            ? { raised: new Map([[o.id, o.to_level]]) }
            : { unlocked: new Set([`${o.id}:${o.form}`]) },
        );
        if (result) options.push({ ...o, ...result });
      }
      options.sort(
        (a, z) =>
          z.gain - a.gain || (a.levels ?? 0) - (z.levels ?? 0) || a.id - z.id,
      );
      options = options.slice(0, limit);

      // Decks within reach: outside the set, every card at most maxLevels
      // under the fielded level and at least one under; raised to it, with
      // their forms unlocked, they join the set.
      if (targetLevel !== null) {
        const within = reachable
          .map((d) => {
            const low = d.ids
              .map((id) => ({ id, held: fit.held.get(id)?.level ?? null }))
              .filter((g) => g.held !== null && g.held < targetLevel);
            if (inSet.has(d.key) || !low.length) return null;
            if (low.some((g) => targetLevel - g.held > maxLevels)) return null;
            return { d, low, ceiling: ceilingOf(d) };
          })
          .filter(Boolean)
          .sort((a, z) => z.ceiling - a.ceiling)
          .slice(0, REACH_CAP);
        for (const w of within) {
          const result = repack({
            raised: new Map(w.low.map((g) => [g.id, targetLevel])),
            unlocked: new Set(w.d.missing_forms),
          });
          const joined = result?.set_after.find((x) => x.key === w.d.key);
          if (!joined) continue;
          reach.push({
            key: w.d.key,
            value: joined.value,
            raises: w.low.map((g) => ({
              id: g.id,
              held_level: g.held,
              to_level: targetLevel,
            })),
            forms: w.d.missing_forms.map((k) => {
              const [id, form] = k.split(":").map(Number);
              return { id, form };
            }),
            levels: w.low.reduce((s, g) => s + (targetLevel - g.held), 0),
            ...result,
          });
        }
        reach.sort((a, z) => z.gain - a.gain || a.levels - z.levels);
        reach = reach.slice(0, limit);
      }
    }

    // Names: the cards the options name, the decks the sets hold.
    const optionIds = [
      ...new Set([
        ...options.map((o) => o.id),
        ...reach.flatMap((w) => [...w.raises, ...w.forms].map((x) => x.id)),
      ]),
    ];
    const { rows: cardRows } = optionIds.length
      ? await ctx.db.query(
          `select c.card_id, c.name, pc.count from card c
             left join player_card pc on pc.card_id = c.card_id and pc.player_tag = $2
            where c.card_id = any($1)`,
          [optionIds, tag],
        )
      : { rows: [] };
    const cardInfo = new Map(cardRows.map((r) => [r.card_id, r]));
    const byKey = new Map(decks.map((d) => [d.key, d]));
    const named = new Map();
    for (const k of [
      ...(baseSet?.keys ?? []),
      ...options.flatMap((o) => o.set_after.map((d) => d.key)),
      ...reach.flatMap((w) => [w.key, ...w.set_after.map((d) => d.key)]),
    ])
      if (byKey.has(k)) named.set(k, byKey.get(k).pairs);
    const identities = await cardSetIdentities(ctx.db, named);
    const deckOf = (key, value) => ({
      deck_hash: byKey.get(key)?.deck_hash ?? key,
      archetype_label: identities.get(key)?.archetype?.label ?? null,
      value,
      ...(compact
        ? {}
        : {
            card_names: (identities.get(key)?.cards ?? [])
              .map((x) => cardDisplayName({ name: x.name, form: x.form }))
              .join(", "),
          }),
    });
    /** The decks of the set after whose value the upgrade moved: the ones
     *  it lifts (a deck that joined only because another left is not). */
    const liftsOf = (setAfter) =>
      setAfter
        .filter(
          (d) => Math.abs(d.value - (base.get(d.key) ?? -Infinity)) > 1e-9,
        )
        .map((d) => ({
          deck_hash: byKey.get(d.key)?.deck_hash ?? d.key,
          archetype_label: identities.get(d.key)?.archetype?.label ?? null,
          value_before: base.get(d.key) ?? null,
          value_after: d.value,
        }));
    return {
      player: { player_tag: tag, name: c.name },
      applied: appliedBlock({
        player_tag: tag,
        window: c.win.echo,
        count,
        max_levels: maxLevels,
        limit,
        min_battles: gates?.min_battles,
        min_players: gates?.min_players,
        verbosity: compact ? "compact" : "full",
      }),
      ...(compact ? {} : { objective: SET_OBJECTIVE }),
      fit_for: {
        player_tag: tag,
        collection_as_of: fit.as_of,
        fielded_mean_level: c.fielded.mean_level,
        recent_mean_level: c.fielded.recent_mean_level,
        target_level: target,
      },
      baseline: baseSet
        ? {
            value: baseSet.value,
            decks: baseSet.keys.map((k) => deckOf(k, base.get(k))),
          }
        : null,
      options: options.map((o) => ({
        kind: o.kind,
        card: {
          id: o.id,
          name: cardInfo.get(o.id)?.name ?? null,
          ...(o.kind === "level"
            ? { cards_held: cardInfo.get(o.id)?.count ?? null }
            : {}),
        },
        ...(o.kind === "level"
          ? { held_level: o.held_level, to_level: o.to_level, levels: o.levels }
          : { form: formName(o.form) }),
        decks_affected: o.decks,
        lifts: liftsOf(o.set_after),
        value_before: o.value_before,
        value_after: o.value_after,
        gain: o.gain,
        set_changes: o.set_changes,
        ...(compact
          ? {}
          : { set_after: o.set_after.map((d) => deckOf(d.key, d.value)) }),
      })),
      within_reach: reach.map((w) => ({
        deck: deckOf(w.key, w.value),
        raises: w.raises.map((r) => ({
          card: {
            id: r.id,
            name: cardInfo.get(r.id)?.name ?? null,
            cards_held: cardInfo.get(r.id)?.count ?? null,
          },
          held_level: r.held_level,
          to_level: r.to_level,
        })),
        forms: w.forms.map((x) => ({
          card: { id: x.id, name: cardInfo.get(x.id)?.name ?? null },
          form: formName(x.form),
        })),
        levels: w.levels,
        value_before: w.value_before,
        value_after: w.value_after,
        gain: w.gain,
        ...(compact
          ? {}
          : { set_after: w.set_after.map((d) => deckOf(d.key, d.value)) }),
      })),
      search: { exhausted },
      notes: notes(
        "Each option is priced alone: the best set is re-packed with that one upgrade (the objective battles_deck_sets optimises, over the same card sets) and gain is the set's value after minus before, in log-odds. Options do not add up; take the first, then ask again.",
        "Levels, not gold or cards: the game's upgrade costs are not in the record. cards_held is the count the player's profile last showed for the card. A card the player does not own is never an option (unlocking one is the game's, not an upgrade).",
        `A level option raises a card at most ${maxLevels} level${maxLevels === 1 ? "" : "s"} toward the level the player fields (${targetLevel ?? "unknown"}); a form option unlocks an Evolution or Hero form a candidate deck plays, removing that card's measured form price from it. within_reach is a deck outside the set whose every card is at most ${maxLevels} under that level: raised to it, with any form it plays unlocked, it joins the set; levels is the total.`,
        widened && baseSet
          ? "No set packed at min_battles 20, min_players 3, so the candidates were widened once (applied says which answered)."
          : null,
        baseSet
          ? options.length === 0
            ? reach.length
              ? "No single upgrade lifts this player's best set; within_reach says which decks would, with several."
              : "No upgrade lifts this player's best set: every deck that could join it is already fielded at their level with its forms, or further than max_levels away."
            : null
          : `No set of ${count} decks sharing no card exists among the decks this player owns every card of this season, so there is nothing to lift yet; battles_deck_sets gives the best partial set and the cards one short of the most decks.`,
        exhausted
          ? null
          : "A search stopped at its node budget; the values are the best it found.",
        "value is an ordering, not a forecast: a deck's record is its players', and pilots differ.",
        c.win.seasonNotes,
        c.roll.note,
      ),
      docs: docsRef("battles", "deck-upgrades"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
