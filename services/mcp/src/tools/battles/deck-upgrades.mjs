import { responseMeta } from "@elixir-mcp/contracts";
import {
  DISPLAY_NAME_SCHEMA,
  META_METHODOLOGY,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  VERBOSITY,
  ToolFailure,
  appliedBlock,
  deckIdentities,
  docsRef,
  fieldedLevel,
  notes,
  resolveFitFor,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import { seasonRollup } from "../../meta-season.mjs";
import {
  COMPETITIVE_TYPES,
  formAdvantages,
  modeRecords,
  ownDecks,
  seasonDeckPool,
  seasonPriors,
  substitutions,
} from "../../deck-sets-data.mjs";
import { SET_OBJECTIVE, deckValue, packSets } from "../../deck-sets.mjs";

/** The decks re-packed per option, best first after the option. */
const SEARCH_CAP = 600;
/** Options priced, most promising first (their decks' headroom). */
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
 * level (one card raised rarely moves a deck held two levels under). Facts and the disclosed ordering only: levels, never gold (the
 * game's upgrade costs are not in the record), and no score of its own
 * (DECISIONS declined adoption_cost): the gain is the change in the same
 * set value battles_deck_sets optimises.
 */
export const battles_deck_upgrades = {
  description:
    "Which single upgrade lifts a player's best set of decks sharing no card the most (a card raised toward the level they field, or an Evolution or Hero form unlocked), and which decks would join that set once their low cards reach that level. Each is priced by re-packing the set exactly (as battles_deck_sets does): the set's value before and after, the levels it takes, and the set it would give. Candidates are decks this season's recorded players played in Trophy Road, Path of Legends and Clan Wars. Levels, not gold.",
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
        "Upgrades read the season's deck rollup, rebuilt nightly; pass season:'previous' for the last full season.",
      );
    const from = win.from.toISOString();
    const to = win.to ? win.to.toISOString() : null;
    const fielded = await fieldedLevel(ctx.db, tag, {
      from,
      to,
      types: COMPETITIVE_TYPES,
    });
    const target = fielded.recent_mean_level ?? fielded.mean_level;
    const targetLevel = target === null ? null : Math.round(target);
    const { yours, familiar } = await ownDecks(ctx.db, tag, { from, to });
    const priors = await seasonPriors(ctx.db, win);
    const forms = await formAdvantages(
      ctx.db,
      roll.month,
      roll.prior.mean ?? 0.5,
    );

    // The decks the player owns every card of, at the default gates, then
    // wider when those pack no set; no level floor (the gap is the point).
    let decks = [];
    let gates = null;
    for (const [minB, minP] of [
      [20, 3],
      [5, 2],
    ]) {
      const pool = await seasonDeckPool(ctx.db, {
        month: roll.month,
        minBattles: minB,
        minPlayers: minP,
        tag,
        familiar,
      });
      gates = { min_battles: minB, min_players: minP };
      decks = pool
        .filter((r) => r.owned)
        .map((r) => ({
          key: r.deck_hash,
          ids: r.card_ids,
          cards: new Set(r.card_ids),
          missing: substitutions(r.missing_forms, forms),
        }));
      if (decks.length >= count * 2) break;
    }
    const modes = await modeRecords(
      ctx.db,
      roll.month,
      decks.map((d) => d.key),
    );
    const levelOf = (id, raised) =>
      raised?.get(id) ?? fit.held.get(id)?.level ?? null;
    /** A deck's value with some cards raised (id -> level) and some forms
     *  unlocked (`id:form`). */
    const valueOf = (d, { raised = null, unlocked = null } = {}) => {
      const levels = d.ids.map((id) => levelOf(id, raised));
      const ownMean = levels.some((l) => l === null)
        ? null
        : levels.reduce((s, l) => s + l, 0) / levels.length;
      const formTerm = -d.missing
        .filter((x) => !unlocked?.has(`${x.id}:${x.form}`))
        .reduce((s, x) => s + x.advantage, 0);
      return deckValue({
        modes: modes.get(d.key) ?? {},
        priors,
        ownMean,
        target,
        yours: yours.get(d.key) ?? 0,
        formTerm,
        m: META_METHODOLOGY.prior_strength,
      });
    };
    const base = new Map();
    for (const d of decks) {
      const v = valueOf(d);
      if (v) base.set(d.key, v.value);
    }
    const pack = (values) => {
      const list = decks
        .filter((d) => values.has(d.key))
        .map((d) => ({ key: d.key, cards: d.cards, value: values.get(d.key) }))
        .sort((a, z) => z.value - a.value)
        .slice(0, SEARCH_CAP);
      return packSets(list, { count, nodeBudget: 300_000 });
    };
    /** The best set with some cards raised and some forms unlocked,
     *  against the baseline: every deck holding a changed card revalued. */
    const repack = ({ raised = new Map(), unlocked = new Set() }) => {
      const values = new Map(base);
      const touched = new Set([
        ...raised.keys(),
        ...[...unlocked].map((k) => Number(k.split(":")[0])),
      ]);
      for (const d of decks) {
        if (!d.ids.some((id) => touched.has(id))) continue;
        const v = valueOf(d, { raised, unlocked });
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
    const baseline = pack(base);
    const baseSet = baseline.sets[0] ?? null;

    let options = [];
    let reach = [];
    let exhausted = baseline.exhausted;
    if (baseSet) {
      const weakest = Math.min(...baseSet.keys.map((k) => base.get(k)));
      // A deck worth pricing an upgrade for could reach the set: its value
      // with every card at the fielded level and every form unlocked
      // clears the set's weakest deck.
      const reachable = decks.filter((d) => {
        const ceiling = deckValue({
          modes: modes.get(d.key) ?? {},
          priors,
          ownMean: target,
          target,
          yours: yours.get(d.key) ?? 0,
          m: META_METHODOLOGY.prior_strength,
        });
        return ceiling && ceiling.value >= weakest;
      });
      const byOption = new Map();
      for (const d of reachable) {
        const headroom = (base.get(d.key) ?? -Infinity) - weakest;
        for (const id of d.ids) {
          const held = fit.held.get(id)?.level ?? null;
          if (targetLevel === null || held === null || held >= targetLevel)
            continue;
          const key = `level:${id}`;
          const to = Math.min(targetLevel, held + maxLevels);
          const o = byOption.get(key) ?? {
            kind: "level",
            id,
            held_level: held,
            to_level: to,
            levels: to - held,
            decks: 0,
            headroom: -Infinity,
          };
          o.decks += 1;
          o.headroom = Math.max(o.headroom, -headroom);
          byOption.set(key, o);
        }
        for (const x of d.missing) {
          const key = `form:${x.id}:${x.form}`;
          const o = byOption.get(key) ?? {
            kind: "form",
            id: x.id,
            form: x.form,
            decks: 0,
            headroom: -Infinity,
          };
          o.decks += 1;
          o.headroom = Math.max(o.headroom, x.advantage);
          byOption.set(key, o);
        }
      }
      const priced = [...byOption.values()]
        .sort((a, z) => z.decks - a.decks || z.headroom - a.headroom)
        .slice(0, OPTION_CAP);
      for (const o of priced) {
        const priced = repack(
          o.kind === "level"
            ? { raised: new Map([[o.id, o.to_level]]) }
            : { unlocked: new Set([`${o.id}:${o.form}`]) },
        );
        if (priced) options.push({ ...o, ...priced });
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
        const inSet = new Set(baseSet.keys);
        const within = reachable
          .map((d) => {
            const gaps = d.ids.map((id) => ({
              id,
              held: fit.held.get(id)?.level ?? null,
            }));
            const low = gaps.filter(
              (g) => g.held !== null && g.held < targetLevel,
            );
            if (inSet.has(d.key) || !low.length) return null;
            if (low.some((g) => targetLevel - g.held > maxLevels)) return null;
            const raised = new Map(low.map((g) => [g.id, targetLevel]));
            const unlocked = new Set(d.missing.map((x) => `${x.id}:${x.form}`));
            const ceiling =
              valueOf(d, { raised, unlocked })?.value ?? -Infinity;
            return { d, low, raised, unlocked, ceiling };
          })
          .filter(Boolean)
          .sort((a, z) => z.ceiling - a.ceiling)
          .slice(0, REACH_CAP);
        for (const w of within) {
          const priced = repack({ raised: w.raised, unlocked: w.unlocked });
          if (!priced || !priced.set_after.some((x) => x.key === w.d.key))
            continue;
          reach.push({
            key: w.d.key,
            value: priced.set_after.find((x) => x.key === w.d.key).value,
            raises: w.low.map((g) => ({
              id: g.id,
              held_level: g.held,
              to_level: targetLevel,
            })),
            forms: w.d.missing.map((x) => ({ id: x.id, form: x.form })),
            levels: w.low.reduce((s, g) => s + (targetLevel - g.held), 0),
            ...priced,
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
    const named = [
      ...new Set([
        ...(baseSet?.keys ?? []),
        ...options.flatMap((o) => o.set_after.map((d) => d.key)),
        ...reach.flatMap((w) => [w.key, ...w.set_after.map((d) => d.key)]),
      ]),
    ];
    const identities = await deckIdentities(ctx.db, named);
    const deckOf = (key, value) => ({
      deck_hash: key,
      archetype_label: identities.get(key)?.archetype?.label ?? null,
      value,
      ...(compact
        ? {}
        : {
            card_names: (identities.get(key)?.cards ?? [])
              .map((c) =>
                c.form && c.form !== "base"
                  ? `${c.form === "evolution" ? "Evo" : "Hero"} ${c.name}`
                  : c.name,
              )
              .join(", "),
          }),
    });
    const { rows: nameRows } = await ctx.db.query(
      "select name from player where player_tag = $1",
      [tag],
    );
    return {
      player: { player_tag: tag, name: nameRows[0]?.name ?? null },
      applied: appliedBlock({
        player_tag: tag,
        window: win.echo,
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
        fielded_mean_level: fielded.mean_level,
        recent_mean_level: fielded.recent_mean_level,
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
          : { form: o.form === 1 ? "evolution" : "hero" }),
        decks_affected: o.decks,
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
          form: x.form === 1 ? "evolution" : "hero",
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
        "Each option is priced alone: the best set is re-packed with that one upgrade (the objective battles_deck_sets optimises) and gain is the set's value after minus before, in log-odds. Options do not add up; take the first, then ask again.",
        "Levels, not gold or cards: the game's upgrade costs are not in the record. cards_held is the count the player's profile last showed for the card. A card the player does not own is never an option (unlocking one is the game's, not an upgrade).",
        `A level option raises a card at most ${maxLevels} level${maxLevels === 1 ? "" : "s"} toward the level the player fields (${targetLevel ?? "unknown"}); a form option unlocks an Evolution or Hero form a candidate deck plays, removing that card's measured form price from it. within_reach is a deck outside the set whose every card is at most ${maxLevels} under that level: raised to it, with any form it plays unlocked, it joins the set; levels is the total.`,
        baseSet
          ? options.length === 0
            ? reach.length
              ? "No single upgrade lifts this player's best set; within_reach says which decks would, with several."
              : "No upgrade lifts this player's best set: every deck that could join it is already fielded at their level with its forms, or further than max_levels away."
            : null
          : `No set of ${count} decks sharing no card exists among the decks this player owns every card of this season, so there is nothing to lift yet; battles_deck_sets says what fell out and why.`,
        exhausted
          ? null
          : "A search stopped at its node budget; the values are the best it found.",
        "value is an ordering, not a forecast: a deck's record is its players', and pilots differ.",
        win.seasonNotes,
        roll.note,
      ),
      docs: docsRef("battles", "deck-upgrades"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
