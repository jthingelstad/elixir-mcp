/** cards_archetype — the resolver (design §5.2, built 2026-09-20 on
 *  Jamie's call: the product is still evolving, the tool-list weight
 *  is not the constraint). Three shapes, no population attached:
 *
 *    { name }   what a name means: family, win conditions, the aliases
 *               for the shape.
 *    { cards }  name this deck: eight cards (ids or names, "Evo "/"Hero "
 *               prefixes set the form) to their archetype, pure - no
 *               record needed.
 *    {}         the vocabulary: the six families, the win conditions
 *               with their tiers and families, the aliases, the
 *               version in force.
 *
 *  The grammar and the resolver are the contract's; this is the
 *  wrapper that makes them a question an agent can ask in one breath. */

import {
  cardType,
  classifyDeck,
  normalizeName,
  FAMILIES,
  FAMILY_LABEL,
  CYCLE_MAX,
  BEATDOWN_MIN,
  GRAMMAR_VERSION,
  cardDisplayName,
} from "@elixir-mcp/contracts";
import { cachedVocabulary } from "@elixir-mcp/ingest/card-roles";
import {
  ToolFailure,
  appliedBlock,
  notes,
  docsRef,
  buildMeta,
  resolveArchetypeArg,
  ARCHETYPE_NOTE,
} from "./shared.mjs";

const FAMILY_DEFINITIONS = {
  beatdown:
    "build a large push behind a high-hitpoint tank; accept elixir deficits to overwhelm",
  control: "defend efficiently, counter-push, chip; win over time",
  cycle: "cheap cards, fast rotation back to a chip win condition",
  bait: "force the opponent's small spells with spell-vulnerable swarm, then punish",
  bridge_spam:
    "fast units at the bridge to deny the opponent a build-up and punish mistakes",
  siege: "attack the tower from your own side with X-Bow or Mortar",
  unclassified: "no card in the deck carries a cost the catalog knows",
};

/** A card as a person types it to a catalog row, with the form the
 *  prefix says: "Evo Royal Hogs", "hero musketeer", "26000059", 26000059. */
function resolveCardInput(value, cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const byKey = new Map();
  // Tower troops first, deck cards over them: a name both carry is the
  // deck card's (Gym #324: the "Archer Queen" tower-troop entry had
  // replaced the champion, and an eight-card deck read "7 cards named").
  const towerFirst = [...cards].sort(
    (a, b) =>
      Number(
        a.kind === "card" ||
          (a.kind === undefined && cardType(a.id) !== "tower_troop"),
      ) -
      Number(
        b.kind === "card" ||
          (b.kind === undefined && cardType(b.id) !== "tower_troop"),
      ),
  );
  for (const c of towerFirst) {
    byKey.set(normalizeName(c.name), c);
    byKey.set(normalizeName(c.name.replace(/\./g, "")), c);
  }
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const c = byId.get(Number(value));
    return c ? { ...c, form: 0 } : null;
  }
  let text = String(value);
  let form = 0;
  const m = /^\s*(evo|evolution|evolved|hero)\s+/i.exec(text);
  if (m) {
    form = /hero/i.test(m[1]) ? 2 : 1;
    text = text.slice(m[0].length);
  }
  const c =
    byKey.get(normalizeName(text)) ??
    byKey.get(normalizeName(text.replace(/\./g, "")));
  return c ? { ...c, form } : null;
}

export const archetypeTools = {
  cards_archetype: {
    description:
      "What a deck name means, or what to call a deck. name: a family (bridge spam), a composed label (Royal Hogs bridge spam) or a community name (LavaLoon, Log Bait, 2.6 Hog) to its family, win conditions, the aliases for that shape. cards: eight cards (ids or names; 'Evo '/'Hero ' prefixes set the form) to their archetype - from catalog and vocabulary facts, without a population. Neither: the vocabulary (families, win conditions with tiers, aliases, the version in force). A label is a noun, never a verdict.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          maxLength: 80,
          description:
            "A deck name to resolve: a family, a '<card(s)> <family>' label, or a community name. Refused with the vocabulary in the hint when it is nothing.",
        },
        cards: {
          type: "array",
          items: { type: ["integer", "string"] },
          minItems: 1,
          maxItems: 8,
          description:
            "The cards of a deck to name: catalog ids or names ('P.E.K.K.A' or 'pekka'); 'Evo ' or 'Hero ' before a name sets its form. Tower troops are ignored.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      if (args.name !== undefined && args.cards !== undefined)
        throw new ToolFailure(
          "bad_request",
          "name resolves a deck name; cards names a deck. Pass one.",
          "cards_archetype({ name }) or cards_archetype({ cards }).",
        );
      const vocab = await cachedVocabulary(ctx.db);
      const version = {
        grammar_version: GRAMMAR_VERSION,
        roles_version: vocab.version?.roles_version ?? null,
        source_commit: vocab.version?.source_commit ?? null,
        cycle_max: CYCLE_MAX,
        beatdown_min: BEATDOWN_MIN,
      };
      const meta = await buildMeta(ctx.db, ctx.account, "GLOBAL", ["cards"]);
      const docs = docsRef("archetypes");

      if (args.name !== undefined) {
        const resolved = await resolveArchetypeArg(ctx.db, args.name);
        const familyWord = resolved.family
          ? FAMILY_LABEL[resolved.family]
          : null;
        return {
          applied: appliedBlock({ name: String(args.name) }),
          resolved: {
            family: resolved.family,
            family_definition: resolved.family
              ? FAMILY_DEFINITIONS[resolved.family]
              : null,
            win_conditions: resolved.win_conditions,
            resolved_from: resolved.resolved_from,
            aliases: resolved.aliases,
            label:
              resolved.win_conditions.length && familyWord
                ? `${resolved.win_conditions.map((w) => cardDisplayName({ name: w.name, form: w.form ?? "base" })).join(" ")} ${familyWord}`
                : familyWord
                  ? familyWord.charAt(0).toUpperCase() + familyWord.slice(1)
                  : null,
          },
          version,
          notes: notes(
            `'${args.name}' resolved by ${resolved.resolved_from === "alias" ? "a community alias" : resolved.resolved_from === "family" ? "its family word" : "its label (card names and the family)"}${resolved.family ? ` to ${familyWord}` : " to any family"}${resolved.win_conditions.length ? ` with ${resolved.win_conditions.map((w) => w.name).join(" and ")}` : ""}.`,
            resolved.win_conditions.some((w) => !w.form)
              ? `A win condition named without 'Evo ' or 'Hero ' matches every form of it (${resolved.win_conditions
                  .filter((w) => !w.form)
                  .map((w) => w.name)
                  .join(
                    ", ",
                  )} decks in any form); say the form to name one ('Evo ${resolved.win_conditions.find((w) => !w.form)?.name}').`
              : null,
            ARCHETYPE_NOTE,
          ),
          docs,
          meta,
        };
      }

      if (args.cards !== undefined) {
        const inputs = Array.isArray(args.cards) ? args.cards : [];
        const cards = [];
        const unknown = [];
        for (const v of inputs) {
          const c = resolveCardInput(v, vocab.cards);
          if (c) cards.push(c);
          else unknown.push(String(v));
        }
        if (unknown.length)
          throw new ToolFailure(
            "not_found",
            `Not a catalog card: ${unknown.join(", ")}.`,
            "cards_catalog({ query }) finds the id and the exact name; 'Evo ' or 'Hero ' before a name sets the form.",
          );
        const ids = cards.map((c) => c.id);
        const { rows: priced } = await ctx.db.query(
          `select card_id as id, name, elixir_cost, kind from card where card_id = any($1)`,
          [ids],
        );
        const cost = new Map(priced.map((r) => [r.id, r]));
        const played = cards
          .filter((c) => cost.get(c.id)?.kind !== "support")
          .map((c) => ({
            id: c.id,
            name: c.name,
            form: c.form,
            elixir_cost: cost.get(c.id)?.elixir_cost ?? null,
          }));
        const a = classifyDeck(played, vocab.roles);
        return {
          applied: appliedBlock({
            cards: played.map((c) => ({
              id: c.id,
              name: c.name,
              form: c.form,
            })),
          }),
          archetype: {
            family: a.family,
            family_definition: FAMILY_DEFINITIONS[a.family],
            win_conditions: a.win_conditions,
            secondary_win_conditions: a.secondary_win_conditions,
            named_by: a.named_by,
            label: a.label,
            average_elixir: a.average_elixir,
            basis: a.basis,
            grammar_version: a.grammar_version,
            roles_version: version.roles_version,
          },
          version,
          notes: notes(
            played.length < 8
              ? `${played.length} cards named, not eight: the archetype is of the cards given, and the average elixir is over them.`
              : null,
            a.named_by
              ? `${a.named_by.name} names this deck but is not a win condition: the deck has none, and its tower damage is chip from the troops behind the tank.`
              : null,
            ARCHETYPE_NOTE,
          ),
          docs,
          meta,
        };
      }

      // The vocabulary.
      const winConditions = vocab.roles
        .filter((r) => r.tier !== undefined || r.bait_tiers)
        .map((r) => ({
          id: r.id,
          name: r.name,
          tier: r.bait_tiers ? null : r.tier,
          bait_tiers: r.bait_tiers,
          family: r.family,
          at_cycle_cost: r.at_cycle_cost,
          needs_partner: r.needs_partner === true,
          pairs_with: r.pairs_with,
        }))
        .sort((x, y) => (x.tier ?? 6.5) - (y.tier ?? 6.5) || x.id - y.id);
      return {
        applied: appliedBlock({}),
        families: FAMILIES.map((f) => ({
          family: f,
          label: FAMILY_LABEL[f],
          definition: FAMILY_DEFINITIONS[f],
        })),
        grammar:
          "<win condition(s)> <family>: the highest-priority win condition in the deck anchors the name (lowest tier first), its family follows, with three tests - a Goblin Barrel is bait only with a bait unit beside it, P.E.K.K.A / Mega Knight / Ram Rider are bridge spam only with a bridge partner, and the cycle-cost cards are cycle at or under cycle_max; the win condition's form is said (Evo, Hero); no win condition means the bare family by cost.",
        win_conditions: winConditions,
        bait_units: vocab.roles
          .filter((r) => r.bait_unit)
          .map((r) => ({ id: r.id, name: r.name })),
        bridge_partners: vocab.roles
          .filter((r) => r.bridge_partner)
          .map((r) => ({ id: r.id, name: r.name })),
        names_deck: vocab.roles
          .filter((r) => r.names_deck)
          .map((r) => ({ id: r.id, name: r.name })),
        aliases: vocab.aliases.map((a) => ({
          alias: a.alias,
          cards: a.cards,
          family: a.family,
        })),
        version,
        notes: notes(
          "The vocabulary is cr-agent-api-docs data/card-roles.json and data/deck-aliases.json, one public source per entry, imported at deploy; a card absent from win_conditions is not a win condition, however new.",
          ARCHETYPE_NOTE,
        ),
        docs,
        meta,
      };
    },
  },
};
