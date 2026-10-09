/**
 * A battle's share picture (Jamie, 2026-10-01): the page's own
 * projection drawn as the page lays it out - names left and right, both
 * decks two by four, towers, elixir - with the link and the disclaimer.
 * These read the SVG it draws; battle-page.test.mjs renders the PNG.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { drawBattle, makeShareImage } from "../src/share-image.mjs";
import { fontMetrics } from "../src/font-metrics.mjs";
import { SHARE_FILES, shareSources } from "../src/share-files.mjs";

const sources = shareSources();
const bytes = Object.fromEntries(
  await Promise.all(
    Object.entries(sources).map(async ([k, f]) => [k, await readFile(f)]),
  ),
);
const metrics = {
  regular: fontMetrics(bytes.interRegular),
  bold: fontMetrics(bytes.interBold),
  clash: fontMetrics(bytes.clash),
};
// The smallest PNG there is: one transparent pixel.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const card = (id, name, form = "base", level = 14) => ({
  id,
  name,
  form,
  level,
});
const DECK = {
  cards: [
    card(26000021, "Hog Rider"),
    card(26000011, "Valkyrie", "evolution"),
    card(28000006, "Mirror"),
    card(26000064, "Firecracker"),
    card(26000074, "Golden Knight", "hero"),
    card(28000001, "Arrows"),
    card(26000007, "Witch"),
    card(26000055, "Mega Knight"),
  ],
  tower_troop: { id: 159000004, name: "Royal Chef", level: 14 },
  label: "Hog Rider cycle",
  average_elixir: 3.6,
  cycle4: 11,
  average_level: 14,
};
const player = (name, extra = {}) => ({
  player_tag: `#${name.length}ABC`,
  name,
  clan_tag: "#J2RGCRVG",
  clan_name: "POAP KINGS",
  starting_trophies: 9000,
  trophy_change: 30,
  global_rank: null,
  elixir_leaked: 1.25,
  deck: DECK,
  rounds: null,
  ...extra,
});
const READ = {
  battle: {
    id: "ab".repeat(32),
    short_id: "abababababab",
    url: "https://elixir.poapkings.com/battle/abababababab",
    image: "https://elixir.poapkings.com/battle/abababababab.png",
    battle_time: "2026-09-03T14:11:39.000Z",
    type: "PvP",
    kind: "1v1",
    mode_group: "ladder",
    game_mode: { id: 72000006, name: "Ladder" },
    arena: { id: 54000144, name: "Spirit Square" },
    duration: { basis: "king_tower_fell" },
    deck_level_edge: 0,
  },
  sides: [
    {
      outcome: "win",
      crowns: 3,
      tower_hp: { king: 4000, princess: [2000, 0] },
      players: [player('<b>"Ana"</b> & co')],
    },
    {
      outcome: "loss",
      crowns: 0,
      tower_hp: { king: 0, princess: [0, 0] },
      players: [player("Bo", { trophy_change: -28 })],
    },
  ],
  games: null,
  meetings: [],
  sitting: [],
};

const draw = (read, art = new Map()) => drawBattle(read, { ...metrics, art });

test("a 1v1: both names, both decks, the score, the towers, the link", () => {
  const svg = draw(READ);
  assert.match(svg, /^<svg [^>]*width="1200" height="630"/);
  // A name is text, never markup.
  assert.ok(svg.includes("&lt;b&gt;&quot;Ana&quot;&lt;/b&gt; &amp; co"));
  assert.equal(svg.includes('<b>"Ana"'), false);
  assert.ok(svg.includes(">Bo<"));
  assert.ok(svg.includes("won</text>"));
  assert.ok(svg.includes(">A King Tower fell<"));
  assert.ok(svg.includes(">5:00 or less<"));
  assert.ok(svg.includes(">Trophy Road<"));
  assert.ok(svg.includes(">Sep 3, 2026, 14:11 UTC<"));
  assert.ok(svg.includes(">elixir.poapkings.com/battle/abababababab<"));
  assert.ok(svg.includes("not endorsed by Supercell."));
  assert.ok(svg.includes("Tower troop: Royal Chef, level 14"));
  // Hitpoints left, and a tower at zero says so.
  assert.ok(svg.includes(">4,000<"));
  assert.ok(svg.includes(">Down<"));
  // The numbers beside each deck.
  assert.equal(svg.match(/>3\.60</g).length, 2);
  assert.equal(svg.match(/>1\.25</g).length, 2);
  // Trophies, the change in the result's colour.
  assert.ok(svg.includes(">+30</tspan>"));
  assert.ok(svg.includes(">−28</tspan>"));
  // Evo and Hero ribbons, and a level under each of sixteen cards.
  assert.equal(svg.match(/>Evo</g).length, 2);
  assert.equal(svg.match(/>Hero</g).length, 2);
  assert.equal(
    svg.match(/font-weight="700" fill="#ddd7f5" text-anchor="middle">14</g)
      .length,
    16,
  );
});

test("art where the mirror has it, the card's name where it does not", () => {
  const svg = draw(
    READ,
    new Map([["26000021:base", PIXEL.toString("base64")]]),
  );
  assert.equal(svg.match(/<image /g).length, 2);
  assert.ok(svg.includes(">Mirror<"));
  assert.equal(svg.includes(">Hog Rider<"), false);
});

test("a duel: games won, its crowns, the last game's decks", () => {
  const rounds = [
    { ...DECK, label: "first" },
    { ...DECK, cards: DECK.cards.map((c) => ({ ...c, level: 11 })) },
  ];
  const read = {
    ...READ,
    battle: { ...READ.battle, kind: "duel", mode_group: "war" },
    sides: READ.sides.map((s) => ({
      ...s,
      crowns: 4,
      players: s.players.map((p) => ({ ...p, deck: null, rounds })),
    })),
    games: [
      {
        round: 1,
        winner: "left",
        sides: [
          { crowns: 2, tower_hp: null, elixir_leaked: 3 },
          { crowns: 1, tower_hp: null, elixir_leaked: 2 },
        ],
      },
      {
        round: 2,
        winner: "left",
        sides: [
          {
            crowns: 2,
            tower_hp: { king: 100, princess: [0, 5] },
            elixir_leaked: 4.5,
          },
          { crowns: 3, tower_hp: null, elixir_leaked: 0.5 },
        ],
      },
    ],
  };
  const svg = draw(read);
  assert.ok(svg.includes(">War · duel<"));
  assert.ok(svg.includes(">games · crowns 4–4<"));
  assert.ok(svg.includes(">from game 2<"));
  // The last game's levels, towers and leak.
  assert.ok(svg.includes(">11<"));
  assert.equal(svg.includes(">14</text>"), false);
  assert.ok(svg.includes(">4.50<"));
  assert.ok(svg.includes(">No tower hitpoints recorded<"));
});

test("a 2v2 names the winning side, never one of its players", () => {
  const read = {
    ...READ,
    battle: {
      ...READ.battle,
      kind: "2v2",
      mode_group: "casual",
      duration: null,
    },
    sides: READ.sides.map((s) => ({
      ...s,
      players: [s.players[0], player("Mate", { deck: null })],
    })),
  };
  const svg = draw(read);
  assert.ok(svg.includes(">Left team won<"));
  assert.ok(svg.includes(">Friendly · 2v2<"));
  assert.equal(svg.match(/>No deck recorded</g).length, 2);
});

test("a long name is shortened to its side, never into the score", () => {
  const long = "W".repeat(40);
  const svg = draw({
    ...READ,
    sides: [{ ...READ.sides[0], players: [player(long)] }, READ.sides[1]],
  });
  const shown = svg.match(/>(W+…)</)[1];
  assert.ok(shown.length < long.length);
  assert.ok(metrics.bold.width(shown, 32) <= 440);
});

test("font metrics: a wider string is wider, and a font knows its glyphs", () => {
  const { regular, clash } = metrics;
  assert.ok(regular.width("WWW", 16) > regular.width("iii", 16));
  assert.equal(regular.width("", 16), 0);
  assert.ok(
    Math.abs(regular.width("ab", 32) - 2 * regular.width("ab", 16)) < 1e-9,
  );
  assert.ok(regular.has("Ж") && regular.has("ệ") && regular.has("é"));
  assert.equal(regular.has("日"), false);
  assert.ok(clash.width("Elixir", 38) > 0);
});

test("the renderer draws a PNG, and two renderers share one wasm", async () => {
  const assets = async () => bytes;
  const a = makeShareImage({ assets, cardArt: async () => PIXEL });
  const b = makeShareImage({ assets });
  for (const render of [a, b]) {
    const png = Buffer.from(await render(READ));
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
  // Every file the bundle carries has a source in the checkout.
  assert.deepEqual(
    Object.keys(sources).sort(),
    Object.keys(SHARE_FILES).sort(),
  );
});

test("a form the mirror lacks draws the base card's art, then nothing", async () => {
  // 2026-10-08: Hero Electro Wizard and Evo Electro Giant were missing
  // from the mirror, and the picture wrote their names.
  const { makeCardArt } = await import("../src/routes/battle.mjs");
  const keys = [];
  const stored = new Set(["assets/cards/26000042.png"]);
  const send = async (cmd) => {
    keys.push(cmd.input.Key);
    if (!stored.has(cmd.input.Key)) throw new Error("NoSuchKey");
    return { Body: { transformToByteArray: async () => PIXEL } };
  };
  const art = makeCardArt("site", send);
  assert.deepEqual(await art({ id: 26000042, form: "hero" }), PIXEL);
  assert.deepEqual(keys, [
    "assets/cards/26000042_hero.png",
    "assets/cards/26000042.png",
  ]);
  assert.equal(await art({ id: 26000085, form: "evolution" }), null);
  assert.equal(await art({ id: 26000085, form: "base" }), null);
  // The picture reads the mirror's original files (2026-10-08: the
  // resized -128 copies are gone), and a miss is asked again, so the
  // hero drawn once Supercell publishes it needs no cold start.
  stored.add("assets/cards/26000042_hero.png");
  keys.length = 0;
  assert.deepEqual(await art({ id: 26000042, form: "hero" }), PIXEL);
  assert.deepEqual(keys, ["assets/cards/26000042_hero.png"]);
  keys.length = 0;
  await art({ id: 26000042, form: "hero" });
  assert.deepEqual(keys, [], "a file read is kept");
  assert.ok(keys.every((k) => !/-\d+\.png$/.test(k)));
});
