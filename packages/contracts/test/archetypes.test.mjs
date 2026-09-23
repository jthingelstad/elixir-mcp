/**
 * The archetype grammar over the vocabulary snapshot
 * (fixtures/card-roles.snapshot.json, generated from cr-agent-api-docs by
 * infra/scripts/import-card-roles.mjs). Every tier and every edge the
 * design names, each pinned to the label it composes; the same cases
 * are run against elixir-bot's _classify (scripts in docs/reviews) so
 * the port is known to agree where the vocabularies agree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDeck,
  resolveArchetypeName,
  normalizeName,
  averageElixir,
  CYCLE_MAX,
  FAMILIES,
} from "../dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  readFileSync(
    path.resolve(here, "../../../fixtures/card-roles.snapshot.json"),
    "utf8",
  ),
);
const { roles, aliases } = snapshot;

// The cards the cases use: id -> [name, elixir]. Costs as the catalog
// serves them on 2026-09-20.
const CARDS = {
  26000000: ["Knight", 3],
  26000001: ["Archers", 3],
  26000002: ["Goblins", 2],
  26000003: ["Giant", 5],
  26000004: ["P.E.K.K.A", 7],
  26000005: ["Minions", 3],
  26000006: ["Balloon", 5],
  26000007: ["Witch", 5],
  26000009: ["Golem", 8],
  26000010: ["Skeletons", 1],
  26000011: ["Valkyrie", 4],
  26000012: ["Skeleton Army", 3],
  26000013: ["Bomber", 2],
  26000014: ["Musketeer", 4],
  26000015: ["Baby Dragon", 4],
  26000016: ["Prince", 5],
  26000017: ["Wizard", 5],
  26000018: ["Mini P.E.K.K.A", 4],
  26000019: ["Spear Goblins", 2],
  26000021: ["Hog Rider", 4],
  26000023: ["Ice Wizard", 3],
  26000024: ["Royal Giant", 6],
  26000025: ["Guards", 3],
  26000026: ["Princess", 3],
  26000027: ["Dark Prince", 4],
  26000028: ["Three Musketeers", 9],
  26000029: ["Lava Hound", 7],
  26000030: ["Ice Spirit", 1],
  26000031: ["Fire Spirit", 1],
  26000032: ["Miner", 3],
  26000033: ["Sparky", 6],
  26000035: ["Lumberjack", 4],
  26000036: ["Battle Ram", 4],
  26000037: ["Inferno Dragon", 4],
  26000038: ["Ice Golem", 2],
  26000039: ["Mega Minion", 3],
  26000040: ["Dart Goblin", 3],
  26000041: ["Goblin Gang", 3],
  26000042: ["Electro Wizard", 4],
  26000043: ["Elite Barbarians", 6],
  26000046: ["Bandit", 3],
  26000049: ["Bats", 2],
  26000050: ["Royal Ghost", 3],
  26000051: ["Ram Rider", 5],
  26000055: ["Mega Knight", 7],
  26000056: ["Skeleton Barrel", 3],
  26000058: ["Wall Breakers", 2],
  26000059: ["Royal Hogs", 5],
  26000060: ["Goblin Giant", 6],
  26000062: ["Magic Archer", 4],
  26000063: ["Electro Dragon", 5],
  26000064: ["Firecracker", 3],
  26000067: ["Elixir Golem", 3],
  26000068: ["Battle Healer", 4],
  26000072: ["Archer Queen", 5],
  26000074: ["Golden Knight", 4],
  26000080: ["Skeleton Dragons", 4],
  26000084: ["Electro Spirit", 1],
  26000085: ["Electro Giant", 7],
  26000101: ["Rune Giant", 4],
  26000103: ["Boss Bandit", 6],
  26000106: ["Ronin", 5],
  27000000: ["Cannon", 3],
  27000002: ["Mortar", 4],
  27000003: ["Inferno Tower", 5],
  27000006: ["Tesla", 4],
  27000008: ["X-Bow", 6],
  27000009: ["Tombstone", 3],
  27000010: ["Furnace", 4],
  26000083: ["Mother Witch", 4],
  27000013: ["Goblin Drill", 4],
  28000000: ["Fireball", 4],
  28000001: ["Arrows", 3],
  28000003: ["Rocket", 6],
  28000004: ["Goblin Barrel", 3],
  28000006: ["Mirror", null],
  28000007: ["Lightning", 6],
  28000008: ["Zap", 2],
  28000009: ["Poison", 4],
  28000010: ["Graveyard", 5],
  28000011: ["The Log", 2],
  28000012: ["Tornado", 3],
  28000014: ["Earthquake", 3],
  28000015: ["Barbarian Barrel", 2],
  28000017: ["Giant Snowball", 2],
  28000018: ["Royal Delivery", 3],
  27000004: ["Bomb Tower", 4],
  28000002: ["Rage", 2],
  26000044: ["Hunter", 4],
  28000005: ["Freeze", 4],
  26000099: ["Goblinstein", 5],
  26000107: ["Minion Giant", 4],
  27000001: ["Goblin Hut", 4],
  26000022: ["Minion Horde", 5],
};
const deck = (ids, forms = {}) =>
  ids.map((id) => {
    if (!CARDS[id]) throw new Error(`case uses a card the table lacks: ${id}`);
    return {
      id,
      name: CARDS[id][0],
      elixir_cost: CARDS[id][1],
      form: forms[id] ?? 0,
    };
  });
const byName = new Map(
  Object.entries(CARDS).map(([id, [name]]) => [
    normalizeName(name),
    { id: Number(id), name },
  ]),
);
const resolveCard = (text) => byName.get(normalizeName(text)) ?? null;

// [name of the case, card ids, expected label, expected family]
const CASES = [
  [
    "2.6 Hog cycle",
    [
      26000021, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
      26000038,
    ],
    "Hog Rider cycle",
    "cycle",
  ],
  [
    "Hog EQ at control cost (3.5)",
    [
      26000021, 28000014, 26000011, 26000017, 26000038, 26000014, 27000006,
      28000011,
    ],
    "Hog Rider control",
    "control",
  ],
  [
    "Evo Hogs names the form",
    [
      26000021, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
      26000038,
    ],
    "Evo Hog Rider cycle",
    "cycle",
    { 26000021: 1 },
  ],
  [
    "Royal Hogs bridge spam",
    [
      26000059, 26000072, 26000064, 26000084, 26000011, 27000006, 28000014,
      28000018,
    ],
    "Royal Hogs bridge spam",
    "bridge_spam",
  ],
  [
    "Royal Hogs at cycle cost is cycle",
    [
      26000059, 26000010, 26000030, 26000084, 26000031, 27000000, 28000011,
      28000017,
    ],
    "Royal Hogs cycle",
    "cycle",
  ],
  [
    "Log Bait (three bait units)",
    [
      28000004, 26000026, 26000041, 26000000, 26000037, 28000003, 28000011,
      26000023,
    ],
    "Goblin Barrel bait",
    "bait",
  ],
  [
    "Barrel with one bait unit is still bait",
    [
      28000004, 26000026, 26000000, 26000037, 28000003, 28000011, 26000023,
      26000011,
    ],
    "Goblin Barrel bait",
    "bait",
  ],
  [
    "A lone barrel beside a Miner is Miner control",
    [
      26000032, 28000004, 26000017, 26000037, 28000009, 28000011, 26000011,
      26000014,
    ],
    "Miner control",
    "control",
  ],
  [
    "Lavaloon carries both win conditions",
    [
      26000029, 26000006, 26000039, 26000005, 26000080, 28000001, 28000017,
      26000037,
    ],
    "Lava Hound Balloon beatdown",
    "beatdown",
  ],
  [
    "Lava Hound without Balloon",
    [
      26000029, 26000039, 26000005, 26000080, 28000001, 28000017, 26000037,
      26000063,
    ],
    "Lava Hound beatdown",
    "beatdown",
  ],
  [
    "Golem beats the Miner beside it",
    [
      26000009, 26000032, 26000015, 26000063, 28000007, 28000012, 26000039,
      26000049,
    ],
    "Golem beatdown",
    "beatdown",
  ],
  [
    "Goblin Giant Sparky",
    [
      26000060, 26000033, 26000018, 26000027, 28000002, 28000008, 26000042,
      26000031,
    ],
    "Goblin Giant Sparky beatdown",
    "beatdown",
  ],
  [
    "PEKKA with partners is bridge spam",
    [
      26000004, 26000036, 26000050, 26000046, 26000042, 26000062, 28000009,
      28000008,
    ],
    "P.E.K.K.A bridge spam",
    "bridge_spam",
  ],
  [
    "PEKKA without partners is control",
    [
      26000004, 26000042, 26000062, 28000009, 28000008, 26000015, 26000039,
      27000009,
    ],
    "P.E.K.K.A control",
    "control",
  ],
  [
    "Mega Knight with Bandit",
    [
      26000055, 26000046, 26000050, 26000042, 28000008, 26000037, 26000049,
      26000010,
    ],
    "Mega Knight bridge spam",
    "bridge_spam",
  ],
  [
    "Mega Knight control shell",
    [
      26000055, 26000042, 28000008, 26000037, 26000049, 26000010, 26000014,
      28000000,
    ],
    "Mega Knight control",
    "control",
  ],
  [
    "Mega Knight with a bait package is Log Bait first",
    [
      26000055, 28000004, 26000026, 26000041, 26000037, 28000011, 28000003,
      26000000,
    ],
    "Goblin Barrel bait",
    "bait",
  ],
  [
    "X-Bow is siege even at 3.0",
    [
      27000008, 26000010, 26000030, 26000001, 26000000, 27000006, 28000000,
      28000011,
    ],
    "X-Bow siege",
    "siege",
  ],
  [
    "Mortar cycle stays siege",
    [
      27000002, 26000010, 26000030, 26000001, 26000000, 28000003, 28000001,
      28000011,
    ],
    "Mortar siege",
    "siege",
  ],
  [
    "Graveyard control (Splashyard)",
    [
      28000010, 26000015, 26000000, 26000023, 28000009, 28000012, 28000015,
      26000049,
    ],
    "Graveyard control",
    "control",
  ],
  [
    "Giant Graveyard carries both, as beatdown",
    [
      26000003, 28000010, 26000015, 26000042, 28000009, 28000008, 26000039,
      26000038,
    ],
    "Graveyard Giant beatdown",
    "beatdown",
  ],
  [
    "Royal Giant control",
    [
      26000024, 26000064, 26000037, 26000084, 26000042, 27000010, 28000007,
      28000015,
    ],
    "Royal Giant control",
    "control",
  ],
  [
    "Royal Giant at cycle cost",
    [
      26000024, 26000010, 26000030, 26000064, 26000084, 28000011, 27000000,
      26000038,
    ],
    "Royal Giant cycle",
    "cycle",
  ],
  [
    "Balloon at cycle cost",
    [
      26000006, 26000010, 26000030, 26000031, 27000000, 28000017, 28000011,
      26000038,
    ],
    "Balloon cycle",
    "cycle",
  ],
  [
    "Balloon beatdown (LumberLoon)",
    [
      26000006, 26000035, 26000037, 26000039, 28000001, 28000005, 26000015,
      26000068,
    ],
    "Balloon beatdown",
    "beatdown",
  ],
  [
    "Ram Rider with a partner",
    [
      26000051, 26000035, 26000038, 26000037, 26000005, 28000009, 28000015,
      28000017,
    ],
    "Ram Rider bridge spam",
    "bridge_spam",
  ],
  [
    "Ram Rider without partners",
    [
      26000051, 26000038, 26000037, 26000005, 28000009, 28000015, 28000017,
      26000014,
    ],
    "Ram Rider control",
    "control",
  ],
  [
    "Battle Ram bridge spam",
    [
      26000036, 26000046, 26000050, 26000062, 26000042, 28000009, 28000008,
      26000031,
    ],
    "Battle Ram bridge spam",
    "bridge_spam",
  ],
  [
    "Miner Wall Breakers cycle",
    [
      26000032, 26000058, 26000011, 26000062, 26000049, 26000010, 27000004,
      28000011,
    ],
    "Miner Wall Breakers cycle",
    "cycle",
  ],
  [
    "Miner at cycle cost",
    [
      26000032, 26000010, 26000030, 26000001, 26000000, 28000009, 28000011,
      27000000,
    ],
    "Miner cycle",
    "cycle",
  ],
  [
    "Wall Breakers alone",
    [
      26000058, 26000010, 26000030, 26000001, 26000000, 28000000, 28000011,
      27000000,
    ],
    "Wall Breakers cycle",
    "cycle",
  ],
  [
    "Goblin Drill at cycle cost",
    [
      27000013, 26000010, 26000030, 26000062, 26000000, 28000000, 28000011,
      27000000,
    ],
    "Goblin Drill cycle",
    "cycle",
  ],
  [
    "Three Musketeers",
    [
      26000028, 26000068, 26000038, 26000039, 28000008, 28000001, 26000023,
      26000058,
    ],
    "Three Musketeers beatdown",
    "beatdown",
  ],
  [
    "Elixir Golem is a heavy tank",
    [
      26000067, 26000068, 26000042, 26000063, 28000012, 28000007, 26000039,
      26000049,
    ],
    "Elixir Golem beatdown",
    "beatdown",
  ],
  [
    "Electro Giant",
    [
      26000085, 26000063, 28000012, 28000007, 26000039, 26000049, 26000023,
      26000068,
    ],
    "Electro Giant beatdown",
    "beatdown",
  ],
  [
    "Sparky beside a Giant is Giant Sparky",
    [
      26000033, 26000003, 26000015, 26000042, 28000008, 26000039, 26000031,
      27000009,
    ],
    "Giant Sparky beatdown",
    "beatdown",
  ],
  [
    "Minion Giant in the Hog slot of 2.6 Hog",
    [
      26000107, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
      26000038,
    ],
    "Minion Giant cycle",
    "cycle",
  ],
  [
    "Goblinstein beside Royal Hogs: Royal Hogs anchors",
    [
      26000059, 26000099, 26000010, 26000030, 26000084, 27000000, 28000011,
      28000017,
    ],
    "Royal Hogs cycle",
    "cycle",
  ],
  [
    "Goblinstein with no classic win condition, heavy",
    [
      26000099, 26000017, 26000015, 26000063, 28000007, 26000016, 26000011,
      26000018,
    ],
    "Goblinstein control",
    "control",
  ],
  [
    "Ronin behind huts and a horde is control, not bridge spam",
    [
      26000106, 27000001, 26000022, 28000000, 26000039, 26000015, 28000015,
      26000049,
    ],
    "Ronin control",
    "control",
  ],
  [
    "A heavy Wall Breakers deck is control",
    [
      26000058, 26000017, 26000007, 26000015, 28000007, 26000016, 26000011,
      26000018,
    ],
    "Wall Breakers control",
    "control",
  ],
  [
    "Goblin Drill outranks Wall Breakers by the tier order, not by id",
    [
      27000013, 26000058, 26000010, 26000030, 26000001, 26000000, 28000000,
      28000011,
    ],
    "Goblin Drill cycle",
    "cycle",
  ],
  [
    "Ronin bridge spam",
    [
      26000106, 26000046, 26000050, 26000042, 26000062, 28000009, 28000008,
      26000031,
    ],
    "Ronin bridge spam",
    "bridge_spam",
  ],
  [
    "Elite Barbarians",
    [
      26000043, 26000046, 26000050, 26000062, 26000042, 28000015, 28000017,
      26000031,
    ],
    "Elite Barbarians bridge spam",
    "bridge_spam",
  ],
  [
    "Skeleton Barrel bait",
    [
      26000056, 26000026, 26000041, 26000000, 26000037, 28000003, 28000011,
      26000023,
    ],
    "Skeleton Barrel bait",
    "bait",
  ],
  [
    "No win condition, cheap: Cycle",
    [
      26000010, 26000030, 26000001, 26000000, 26000031, 28000008, 28000011,
      27000000,
    ],
    "Cycle",
    "cycle",
  ],
  [
    "No win condition, heavy: Beatdown",
    [
      26000017, 26000007, 26000015, 26000063, 28000007, 26000016, 26000011,
      26000018,
    ],
    "Beatdown",
    "beatdown",
  ],
  [
    "No win condition, middling: Control",
    [
      26000000, 26000014, 26000011, 26000037, 28000000, 28000011, 27000006,
      26000001,
    ],
    "Control",
    "control",
  ],
  [
    "Rune Giant names a deck with no win condition",
    [
      26000101, 26000042, 26000015, 26000063, 28000007, 28000012, 26000039,
      26000049,
    ],
    "Rune Giant control",
    "control",
  ],
  [
    "Mirror is excluded from the average",
    [
      26000021, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
      28000006,
    ],
    "Hog Rider cycle",
    "cycle",
  ],
];

test("every case composes the expected label and family", () => {
  for (const [name, ids, label, family, forms] of CASES) {
    const a = classifyDeck(deck(ids, forms), roles);
    assert.equal(a.label, label, `${name}: label`);
    assert.equal(a.family, family, `${name}: family`);
    assert.ok(FAMILIES.includes(a.family));
    assert.equal(typeof a.grammar_version, "string");
  }
});

test("a card that names a deck never anchors over a win condition, and named_by says which it is", () => {
  // Rune Giant + Lumberjack + Golden Knight + Lightning: no win
  // condition; the deck is named by Rune Giant with the family from cost.
  const named = classifyDeck(
    deck([
      26000101, 26000035, 26000074, 28000007, 26000017, 26000083, 28000015,
      26000015,
    ]),
    roles,
  );
  assert.equal(named.label, "Rune Giant beatdown");
  assert.deepEqual(named.win_conditions, []);
  assert.deepEqual(named.named_by, {
    id: 26000101,
    name: "Rune Giant",
    form: "base",
  });
  // Beside a Hog Rider it is nothing but a card.
  const hog = classifyDeck(
    deck([
      26000101, 26000021, 26000064, 26000010, 28000011, 28000014, 27000000,
      26000030,
    ]),
    roles,
  );
  assert.equal(hog.label, "Hog Rider cycle");
  assert.equal(hog.named_by, null);
  assert.ok(!hog.secondary_win_conditions.some((w) => w.id === 26000101));
});

test("secondary_win_conditions carries what the label leaves out", () => {
  // Tyler's ranked deck: Miner anchors; Goblin Barrel (no bait unit
  // beside it) and Boss Bandit are the secondaries, by tier.
  const a = classifyDeck(
    deck([
      26000032, 28000004, 26000103, 26000007, 26000018, 26000037, 27000010,
      28000011,
    ]),
    roles,
  );
  assert.equal(a.label, "Miner control");
  assert.deepEqual(
    a.secondary_win_conditions.map((w) => w.name),
    ["Boss Bandit", "Goblin Barrel"],
  );
  assert.deepEqual(
    classifyDeck(
      deck([
        26000021, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
        26000038,
      ]),
      roles,
    ).secondary_win_conditions,
    [],
  );
});

test("Mirror: the average is over the seven cards that carry a cost", () => {
  const cards = deck([
    26000021, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
    28000006,
  ]);
  assert.equal(
    averageElixir(cards),
    Number(((4 + 4 + 3 + 1 + 1 + 4 + 2) / 7).toFixed(2)),
  );
  assert.equal(averageElixir([{ id: 28000006, elixir_cost: null }]), null);
  assert.equal(
    classifyDeck([{ id: 28000006, elixir_cost: null }], roles).family,
    "unclassified",
  );
});

test("the label is form-aware on the win condition only", () => {
  const ids = [
    26000059, 26000072, 26000064, 26000084, 26000011, 27000006, 28000014,
    28000018,
  ];
  assert.equal(
    classifyDeck(deck(ids, { 26000059: 1 }), roles).label,
    "Evo Royal Hogs bridge spam",
  );
  assert.equal(
    classifyDeck(deck(ids, { 26000059: "hero" }), roles).label,
    "Hero Royal Hogs bridge spam",
  );
  assert.equal(
    classifyDeck(deck(ids, { 26000064: 1 }), roles).label,
    "Royal Hogs bridge spam",
    "a support card's form is not in the name",
  );
  assert.deepEqual(
    classifyDeck(deck(ids, { 26000059: 1 }), roles).win_conditions,
    [{ id: 26000059, name: "Royal Hogs", form: "evolution" }],
  );
});

test("an empty vocabulary names every deck by cost", () => {
  const a = classifyDeck(
    deck([
      26000021, 26000014, 27000000, 26000010, 26000030, 28000000, 28000011,
      26000038,
    ]),
    [],
  );
  assert.equal(a.label, "Cycle");
  assert.deepEqual(a.win_conditions, []);
});

test("the cycle bound is the number the docs page says", () => {
  assert.ok(CYCLE_MAX >= 3.0 && CYCLE_MAX <= 3.5);
});

test("names resolve: alias, family, composed label; nonsense refuses", () => {
  const r = (text) => resolveArchetypeName(text, aliases, resolveCard, roles);
  assert.deepEqual(r("LavaLoon"), {
    family: "beatdown",
    win_conditions: [
      { id: 26000029, name: "Lava Hound" },
      { id: 26000006, name: "Balloon" },
    ],
    resolved_from: "alias",
    aliases: ["LavaLoon", "Lava Loon"],
  });
  assert.equal(r("log bait").resolved_from, "alias");
  assert.equal(r("LOGBAIT").family, "bait");
  assert.equal(r("bridge spam").family, "bridge_spam");
  assert.equal(r("Bridge-Spam").family, "bridge_spam");
  assert.deepEqual(r("bridgespam").win_conditions, []);
  const composed = r("Royal Hogs bridge spam");
  assert.equal(composed.resolved_from, "label");
  assert.equal(composed.family, "bridge_spam");
  assert.deepEqual(composed.win_conditions, [
    { id: 26000059, name: "Royal Hogs" },
  ]);
  // The form a player says is kept on its card (Gym #105): "evo royal
  // hogs" is the Evo form's decks only; the bare name carries no form
  // and matches every form.
  assert.deepEqual(r("evo royal hogs bridge spam").win_conditions, [
    { id: 26000059, name: "Royal Hogs", form: "evolution" },
  ]);
  const two = r("lava hound balloon beatdown");
  assert.equal(two.win_conditions.length, 2);
  assert.ok(
    two.aliases.includes("LavaLoon"),
    "a composed label finds the alias for its shape",
  );
  assert.equal(r("hog cycle").resolved_from, "alias");
  assert.equal(r("Hog Rider cycle").resolved_from, "label");
  // A label Elixir would not compose still resolves by card and family:
  // the resolver reads names, it does not judge them.
  assert.equal(r("ronin control").family, "control");
  assert.equal(r("ronin control").win_conditions[0].id, 26000106);
  assert.equal(r("purple monkey dishwasher"), null);
  assert.equal(r(""), null);
});

test("every label the grammar composes resolves back to its shape", () => {
  for (const [name, ids, label, family, forms] of CASES) {
    const a = classifyDeck(deck(ids, forms), roles);
    if (a.win_conditions.length === 0) continue;
    const back = resolveArchetypeName(a.label, aliases, resolveCard, roles);
    assert.ok(back, `${name}: '${label}' resolves`);
    assert.equal(back.family, family, `${name}: family round-trips`);
    assert.deepEqual(
      back.win_conditions.map((w) => w.id),
      a.win_conditions.map((w) => w.id),
      `${name}: win conditions round-trip`,
    );
  }
});

test("every alias in the vocabulary resolves to itself", () => {
  for (const a of aliases) {
    const r = resolveArchetypeName(a.alias, aliases, resolveCard, roles);
    assert.ok(r, a.alias);
    assert.equal(r.resolved_from, "alias", a.alias);
    assert.deepEqual(
      r.win_conditions.map((w) => w.id),
      a.cards,
      a.alias,
    );
  }
});
