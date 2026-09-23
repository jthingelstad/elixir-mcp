/**
 * Deck archetypes — the grammar (docs/reviews/2026-09-20-DECK-ARCHETYPES-DESIGN.md).
 *
 * Players talk about decks by name: "Royal Hogs bridge spam", "Hog
 * cycle", "Log Bait". The community keeps two layers apart and so does
 * this: six universal FAMILIES (what RoyaleAPI filters on and every
 * guide teaches) and hand-curated named decks, which Elixir does not
 * assert. A deck's archetype here is a descriptive label composed from
 * its cards and their costs — `<win condition(s)> <family>` — never a
 * claim about what people call it or how it performs.
 *
 * GRAMMAR IN CODE, VOCABULARY IN DATA. This module holds the rules: the
 * priority order of win conditions, the bait-package and bridge-partner
 * tests, the cycle and beatdown bounds, how a label is composed. Which
 * cards are win conditions, at which tier, implying which family, and
 * which cards are bait units or bridge partners are FACTS about cards,
 * kept as data (cr-agent-api-docs data/card-roles.json, imported into
 * card_role, maintained by the domain's Understand Clash Royale
 * objective with a source on every entry) and passed in. A card with no
 * role is not a win condition; a deck built around one lands honestly in
 * the bare-family fallback until the community names it.
 *
 * The classifier is pure and deterministic: the same cards and the same
 * roles name the same archetype on every call and every surface. No
 * model, no storage.
 */

export const FAMILIES = [
  "beatdown",
  "control",
  "cycle",
  "bait",
  "bridge_spam",
  "siege",
  "unclassified",
] as const;
export type Family = (typeof FAMILIES)[number];

/** The rules' own version: bumped when a rule or a bound moves. The
 *  vocabulary's version (the roles file's commit) rides beside it. */
export const GRAMMAR_VERSION = "2026-09";

/** The bounds. "Cycle" is quoted as under 3.5 average elixir, and the
 *  corpus agrees (archetype_census, 2026-09-20, season 2026-09, 570k
 *  battles): with eight cards the average steps by an eighth, and for
 *  Hog Rider, Royal Hogs and Miner the trough between the cycle plateau
 *  and the heavier decks sits at exactly 3.5 - 3.375 is cycle, 3.5 is
 *  not. So CYCLE_MAX admits 3.375 and refuses 3.5. Heavy decks run 4.0
 *  and up (the fallback's lower edge). */
export const CYCLE_MAX = 3.4;
export const BEATDOWN_MIN = 4.0;

/** How a family is said in a label. */
export const FAMILY_LABEL: Record<Family, string> = {
  beatdown: "beatdown",
  control: "control",
  cycle: "cycle",
  bait: "bait",
  bridge_spam: "bridge spam",
  siege: "siege",
  unclassified: "unclassified",
};

/** One card's role, as the vocabulary file states it. */
export interface CardRole {
  id: number;
  name: string;
  /** Priority tier when the card is a win condition (lower anchors the
   *  deck first); null or absent for a card that is not one. */
  tier?: number | null;
  /** The family the win condition implies. */
  family?: Family;
  /** The family instead, when the deck's average elixir is at or under
   *  CYCLE_MAX (Hog Rider: control, cycle at cycle cost). */
  at_cycle_cost?: Family;
  /** The family applies only with a bridge partner in the deck; else the
   *  deck is control (P.E.K.K.A, Mega Knight, Ram Rider). */
  needs_partner?: boolean;
  /** Cards that join this one as a second win condition when present
   *  (Balloon beside Lava Hound), optionally moving the family (Wall
   *  Breakers beside Miner: cycle). */
  pairs_with?: { id: number; family?: Family }[];
  /** A bait win condition: its tier depends on how many bait units ride
   *  beside it (keys are minimum counts), and its family is bait with at
   *  least one, else the cost fallback (Goblin Barrel). */
  bait_tiers?: Record<string, number>;
  bait_unit?: boolean;
  bridge_partner?: boolean;
  /** Names a deck that has no win condition (the tank of an enchanted
   *  or support push, as the deck sites lead with it); never a win
   *  condition, never over one. */
  names_deck?: boolean;
  source?: string;
  attested_at?: string;
}

export interface DeckCardInput {
  id: number;
  name?: string | null;
  /** "base" | "evolution" | "hero", or the CR discriminator 0 | 1 | 2. */
  form?: string | number | null;
  elixir_cost?: number | null;
}

export interface WinCondition {
  id: number;
  name: string;
  form: "base" | "evolution" | "hero";
}

export interface Archetype {
  family: Family;
  win_conditions: WinCondition[];
  /** Every other attested win condition in the deck, by tier: what the
   *  name leaves out ("Miner control" with Goblin Barrel and Boss Bandit). */
  secondary_win_conditions: WinCondition[];
  /** With no win condition in the deck, the card the name leads with
   *  (Rune Giant beatdown); null otherwise. Not a win condition. */
  named_by: WinCondition | null;
  label: string;
  average_elixir: number | null;
  basis: string;
  grammar_version: string;
}

export const ARCHETYPE_BASIS =
  "cards and the catalog's current elixir costs; the win condition's form is in the label, other cards' forms are not";

function formOf(value: DeckCardInput["form"]): WinCondition["form"] {
  if (value === 1 || value === "evolution") return "evolution";
  if (value === 2 || value === "hero") return "hero";
  return "base";
}

const FORM_PREFIX: Record<WinCondition["form"], string> = {
  base: "",
  evolution: "Evo ",
  hero: "Hero ",
};

/** Mean cost over the cards that carry one: Mirror has none and is
 *  excluded rather than voiding the average, as the deck sites do.
 *  Null only when nothing has a cost. */
export function averageElixir(cards: DeckCardInput[]): number | null {
  const costs = cards
    .map((c) => c.elixir_cost)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (costs.length === 0) return null;
  return Number((costs.reduce((s, c) => s + c, 0) / costs.length).toFixed(2));
}

function fallbackFamily(average: number | null): Family {
  if (average === null) return "unclassified";
  if (average <= CYCLE_MAX) return "cycle";
  if (average >= BEATDOWN_MIN) return "beatdown";
  return "control";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A card the way a label speaks it: the form prefix players use, then
 *  the name ("Evo Royal Hogs", "Hero Musketeer", "Hog Rider"). */
export function cardDisplayName(card: {
  name: string;
  form: WinCondition["form"];
}): string {
  return `${FORM_PREFIX[card.form]}${card.name}`;
}

/** The label: win conditions (with the form prefix players use) then
 *  the family; a deck with no win condition is the bare family, or the
 *  card that names it when one is present. */
export function composeLabel(
  family: Family,
  winConditions: WinCondition[],
  namedBy: WinCondition | null = null,
): string {
  const lead = winConditions.length ? winConditions : namedBy ? [namedBy] : [];
  if (lead.length === 0) return capitalize(FAMILY_LABEL[family]);
  return `${lead.map(cardDisplayName).join(" ")} ${FAMILY_LABEL[family]}`;
}

/** Classify one deck against the vocabulary. `roles` is the card-role
 *  table (any iterable of CardRole); the deck's cards need id, form and
 *  elixir_cost. */
export function classifyDeck(
  cards: DeckCardInput[],
  roles: Iterable<CardRole>,
): Archetype {
  const byId = new Map<number, CardRole>();
  for (const r of roles) byId.set(r.id, r);
  const present = new Map<number, DeckCardInput>();
  for (const c of cards) if (Number.isInteger(c.id)) present.set(c.id, c);
  const average = averageElixir(cards);
  const has = (id: number) => present.has(id);
  const nameOf = (id: number) =>
    present.get(id)?.name ?? byId.get(id)?.name ?? String(id);
  const winCondition = (id: number): WinCondition => ({
    id,
    name: nameOf(id),
    form: formOf(present.get(id)?.form),
  });
  const baitUnits = (except: number) =>
    [...present.keys()].filter(
      (id) => id !== except && byId.get(id)?.bait_unit === true,
    ).length;
  const hasPartner = (except: number) =>
    [...present.keys()].some(
      (id) => id !== except && byId.get(id)?.bridge_partner === true,
    );

  // Every win condition in the deck, with its effective tier.
  const candidates: { role: CardRole; tier: number }[] = [];
  for (const id of present.keys()) {
    const role = byId.get(id);
    if (!role) continue;
    if (role.bait_tiers) {
      const n = baitUnits(id);
      const keys = Object.keys(role.bait_tiers)
        .map(Number)
        .filter((k) => n >= k)
        .sort((a, b) => b - a);
      const tier =
        keys.length > 0 ? role.bait_tiers[String(keys[0])] : undefined;
      if (typeof tier === "number") candidates.push({ role, tier });
      continue;
    }
    if (typeof role.tier === "number")
      candidates.push({ role, tier: role.tier });
  }
  candidates.sort((a, b) => a.tier - b.tier || a.role.id - b.role.id);

  const first = candidates[0];
  if (!first) {
    const family = fallbackFamily(average);
    // No win condition: the deck is named by its family from the cost,
    // led by a card that names decks when one is present (lowest id
    // when two are - rare enough not to order).
    const namer = [...present.keys()]
      .filter((id) => byId.get(id)?.names_deck === true)
      .sort((a, b) => a - b)[0];
    const namedBy = namer === undefined ? null : winCondition(namer);
    return {
      family,
      win_conditions: [],
      secondary_win_conditions: [],
      named_by: namedBy,
      label: composeLabel(family, [], namedBy),
      average_elixir: average,
      basis: ARCHETYPE_BASIS,
      grammar_version: GRAMMAR_VERSION,
    };
  }

  const { role } = first;
  let family: Family;
  if (role.bait_tiers) {
    family = baitUnits(role.id) >= 1 ? "bait" : fallbackFamily(average);
  } else if (role.needs_partner) {
    family = hasPartner(role.id) ? (role.family ?? "bridge_spam") : "control";
  } else if (role.at_cycle_cost && average !== null && average <= CYCLE_MAX) {
    family = role.at_cycle_cost;
  } else {
    family = role.family ?? fallbackFamily(average);
  }
  const winConditions = [winCondition(role.id)];
  for (const pair of role.pairs_with ?? []) {
    if (!has(pair.id)) continue;
    winConditions.push(winCondition(pair.id));
    if (pair.family) family = pair.family;
  }
  const named = new Set(winConditions.map((w) => w.id));
  const secondary = candidates
    .filter((c) => !named.has(c.role.id))
    .map((c) => winCondition(c.role.id));
  return {
    family,
    win_conditions: winConditions,
    secondary_win_conditions: secondary,
    named_by: null,
    label: composeLabel(family, winConditions),
    average_elixir: average,
    basis: ARCHETYPE_BASIS,
    grammar_version: GRAMMAR_VERSION,
  };
}

// --- Resolution: what a name means -----------------------------------

export interface DeckAlias {
  alias: string;
  cards: number[];
  family: Family | null;
  source?: string;
}

export interface ArchetypeResolution {
  family: Family | null;
  /** `form` only when the name said one ("Evo Royal Hogs"): then only
   *  that form's decks match (Gym #105). Absent means every form. */
  win_conditions: {
    id: number;
    name: string;
    form?: "evolution" | "hero";
  }[];
  resolved_from: "alias" | "family" | "label";
  aliases: string[];
}

/** Lower-case, letters and digits only, one space between words:
 *  "P.E.K.K.A Bridge-Spam" and "pekka bridgespam" are one key. */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const FAMILY_WORDS: [string, Family][] = [
  ["bridge spam", "bridge_spam"],
  ["bridgespam", "bridge_spam"],
  ["beatdown", "beatdown"],
  ["control", "control"],
  ["cycle", "cycle"],
  ["bait", "bait"],
  ["siege", "siege"],
];

/** Resolve a name to a family and win conditions: an alias first (the
 *  attested community names the grammar does not produce), then a bare
 *  family, then a composed label (`<card(s)> <family>`, the card names
 *  resolved by the caller's matcher, which knows the catalog). Null when
 *  nothing matches; the caller refuses with the vocabulary in the hint. */
export function resolveArchetypeName(
  text: string,
  aliases: Iterable<DeckAlias>,
  resolveCard: (name: string) => { id: number; name: string } | null,
  roles?: Iterable<CardRole>,
): ArchetypeResolution | null {
  const key = normalizeName(text);
  if (!key) return null;
  const byName = new Map<number, string>();
  for (const r of roles ?? []) byName.set(r.id, r.name);
  const nameOf = (id: number) =>
    byName.get(id) ?? resolveCard(String(id))?.name ?? String(id);
  const aliasList = [...aliases];
  const aliasesOf = (family: Family | null, ids: number[]) =>
    aliasList
      .filter(
        (a) =>
          (a.family === family || a.family === null) &&
          a.cards.length === ids.length &&
          a.cards.every((id) => ids.includes(id)),
      )
      .map((a) => a.alias);

  for (const a of aliasList) {
    if (normalizeName(a.alias) === key) {
      return {
        family: a.family,
        win_conditions: a.cards.map((id) => ({ id, name: nameOf(id) })),
        resolved_from: "alias",
        aliases: aliasesOf(a.family, a.cards),
      };
    }
  }
  for (const [word, family] of FAMILY_WORDS) {
    if (key === word)
      return {
        family,
        win_conditions: [],
        resolved_from: "family",
        aliases: [],
      };
  }
  for (const [word, family] of FAMILY_WORDS) {
    if (!key.endsWith(` ${word}`)) continue;
    const head = key.slice(0, -word.length).trim();
    // "evo"/"hero" prefixes are the form players say; the resolution is
    // by card, so they are dropped here.
    const words = head
      .replace(/\b(evo|evolution|hero)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!words) continue;
    const found = resolveCards(words, resolveCard);
    if (!found) return null;
    // The form a player said, kept on the card it was said of: "evo
    // royal hogs" is the Evo form's decks, not both (Gym #105).
    const formed = found.map((c) => {
      const card = normalizeName(c.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b(evo|evolution) ${card}\\b`).test(head))
        return { ...c, form: "evolution" as const };
      if (new RegExp(`\\bhero ${card}\\b`).test(head))
        return { ...c, form: "hero" as const };
      return c;
    });
    return {
      family,
      win_conditions: formed,
      resolved_from: "label",
      aliases: aliasesOf(
        family,
        found.map((c) => c.id),
      ),
    };
  }
  return null;
}

/** The head of a label is one or two card names run together ("lava
 *  hound balloon"): try the whole, then every split point. */
function resolveCards(
  words: string,
  resolveCard: (name: string) => { id: number; name: string } | null,
): { id: number; name: string }[] | null {
  const whole = resolveCard(words);
  if (whole) return [whole];
  const parts = words.split(" ");
  for (let i = 1; i < parts.length; i++) {
    const a = resolveCard(parts.slice(0, i).join(" "));
    const b = resolveCard(parts.slice(i).join(" "));
    if (a && b && a.id !== b.id) return [a, b];
  }
  return null;
}
