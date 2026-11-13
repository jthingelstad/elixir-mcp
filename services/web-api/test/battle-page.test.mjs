/**
 * A battle's public page (2026-10-01, Jamie: "Public yes."): the JSON
 * at /api/public/battles/<ref>, the shell at /battle/<ref> with the
 * battle's preview tags, and the one projection both read. A page view
 * runs as no account, so it writes nothing: no audit row and no read
 * stamp that would move the scheduler.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { makeHandler } from "../src/handler.mjs";
import {
  cycle4,
  readPublicBattle,
  scoreOf,
  withFallenKing,
} from "../src/battle-page.mjs";
import { battles_query } from "@elixir-mcp/tools/tools/battles/query";
import { namedShell, previewOf } from "../src/routes/battle.mjs";
import { drawBattle, makeShareImage } from "../src/share-image.mjs";
import { fontMetrics } from "../src/font-metrics.mjs";
import { shareSources } from "../src/share-files.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_battle_page_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const OBSERVER = "#0QRVVG22J";
const SHELL = `<!doctype html><html><head>
    <title>Elixir</title>
    <meta name="description" content="The app" />
    <meta name="robots" content="index" />
    <meta property="og:title" content="Elixir" />
    <meta property="og:image" content="https://elixir.poapkings.com/assets/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="/app.css" />
  </head><body><div id="root"></div></body></html>`;
let db, handler;

const get = (p) =>
  handler({
    path: p,
    method: "GET",
    headers: {},
  });

const metrics = async () => {
  const f = shareSources();
  return {
    regular: fontMetrics(await readFile(f.interRegular)),
    bold: fontMetrics(await readFile(f.interBold)),
    clash: fontMetrics(await readFile(f.clash)),
  };
};

const fixture = async (rel) =>
  JSON.parse(await readFile(path.join(repoRoot, "fixtures", rel), "utf8"));

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const {
    rows: [acct],
  } = await db.query(
    `insert into account (email_hash, status) values ('battle-page', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [OBSERVER]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [OBSERVER, acct.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'battle-page-gw', '127.0.0.1', 'active') returning gateway_id`,
    [acct.account_id],
  );
  const send = async (endpoint, entityKey, payload, fetchedAt) => {
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  };
  await send(
    "cards",
    "GLOBAL",
    await fixture("cards/catalog.json"),
    "2026-09-03T13:00:00Z",
  );
  await send(
    "player_battlelog",
    OBSERVER,
    await fixture("player_battlelog/with_colosseum_duel.json"),
    "2026-09-03T14:30:34Z",
  );
  // An event's multi-deck duel: three games on three decks, as the record
  // stores one today, with a type that is not a river race duel.
  await send(
    "player_battlelog",
    OBSERVER,
    await fixture("player_battlelog/with_event_multideck_duel.json"),
    "2026-09-03T14:31:34Z",
  );
  const sources = shareSources();
  handler = makeHandler({
    databaseUrl,
    secret: "test",
    siteShell: async () => SHELL,
    shareImage: makeShareImage({
      assets: async () =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(sources).map(async ([k, f]) => [
              k,
              await readFile(f),
            ]),
          ),
        ),
    }),
  });
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

async function battleOf(type) {
  const {
    rows: [b],
  } = await db.query(
    `select battle_id from battle where type = $1 order by battle_time desc limit 1`,
    [type],
  );
  return b.battle_id;
}

const writes = async () => {
  const {
    rows: [w],
  } = await db.query(
    `select (select count(*) from mcp_call_audit)::int as audits,
            (select max(last_read_at) from poll_state) as stamped`,
  );
  return w;
};

test("a 1v1: the recorded player left, both decks, towers and the link", async () => {
  const id = await battleOf("PvP");
  const before = await writes();
  const read = await readPublicBattle(db, id.slice(0, 12));
  assert.equal(read.status, 200);
  const { battle, sides } = read;
  assert.equal(battle.id, id);
  assert.equal(battle.kind, "1v1");
  assert.equal(battle.mode_group, "ladder");
  assert.match(
    battle.url,
    /^https:\/\/elixir\.poapkings\.com\/battle\/[0-9a-f]{12,64}$/,
  );
  assert.ok(id.startsWith(battle.short_id));
  // The share picture is the page's address with .png on the end.
  assert.equal(battle.image, `${battle.url}.png`);
  const [l, r] = sides;
  assert.equal(l.players[0].player_tag, OBSERVER);
  assert.equal(r.players.length, 1);
  assert.notEqual(r.players[0].player_tag, OBSERVER);
  assert.ok(["win", "loss", "draw"].includes(l.outcome));
  assert.equal(
    r.outcome,
    { win: "loss", loss: "win", draw: "draw" }[l.outcome],
  );
  for (const s of sides) {
    const deck = s.players[0].deck;
    assert.equal(deck.cards.length, 8);
    for (const c of deck.cards) {
      assert.equal(typeof c.id, "number");
      assert.ok(c.name);
      assert.ok(["base", "evolution", "hero"].includes(c.form));
    }
    assert.ok(deck.cycle4 === null || deck.cycle4 > 0);
    assert.ok(s.tower_hp === null || "king" in s.tower_hp);
  }
  assert.ok(battle.duration?.basis);
  // The sitting holds this battle, newest first.
  assert.ok(read.sitting.some((x) => x.url === battle.url));
  const times = read.sitting.map((x) => Date.parse(x.battle_time));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
  assert.ok(read.sitting.every((x) => x.duel === false || x.duel === true));
  assert.ok(read.meetings.some((x) => x.url === battle.url));
  assert.equal(read.disclaimer.includes("not endorsed by Supercell"), true);
  // Nicknames never ride a public page: the projection has no field for one.
  assert.equal(JSON.stringify(read).includes("nickname"), false);
  // A page view writes nothing.
  assert.deepEqual(await writes(), before);
});

test("a duel reads game by game", async () => {
  const id = await battleOf("riverRaceDuelColosseum");
  const read = await readPublicBattle(db, id);
  assert.equal(read.status, 200);
  assert.equal(read.battle.kind, "duel");
  const [l, r] = read.sides;
  assert.equal(l.players[0].deck, null);
  assert.ok(l.players[0].rounds.length >= 2);
  assert.ok(Array.isArray(read.games) && read.games.length >= 2);
  for (const g of read.games) {
    assert.ok(["left", "right", null].includes(g.winner));
    assert.equal(g.sides.length, 2);
  }
  assert.equal(
    read.games.reduce((a, g) => a + g.sides[0].crowns, 0),
    l.crowns,
  );
  assert.ok(r.players[0].rounds.length >= 2);
});

test("an event's multi-deck duel reads game by game, decks on both sides", async () => {
  const id = await battleOf("trail");
  const read = await readPublicBattle(db, id);
  assert.equal(read.status, 200);
  assert.equal(read.battle.kind, "duel");
  assert.equal(read.battle.mode_group, "event");
  for (const s of read.sides) {
    const p = s.players[0];
    assert.equal(p.deck, null);
    assert.equal(p.rounds.length, 3);
    for (const d of p.rounds) assert.equal(d.cards.length, 8);
  }
  // The games and each one's own result, from the round rows.
  assert.equal(read.games.length, 3);
  assert.deepEqual(
    read.games.map((g) => g.sides.map((x) => x.crowns)),
    [
      [1, 0],
      [0, 1],
      [2, 1],
    ],
  );
  assert.deepEqual(
    read.games.map((g) => g.winner),
    ["left", "right", "left"],
  );
  assert.deepEqual(read.score, { left: 2, right: 1, unit: "games" });
  // The preview says the games, not the summed crowns.
  assert.match(previewOf(read).title, / 2–1 /);
  // The sitting knows it for a duel, so it says the result, not a score.
  const row = read.sitting.find((x) => x.url === read.battle.url);
  assert.equal(row.duel, true);
});

test("battles_query: an event duel carries its games like a river race duel", async () => {
  const id = await battleOf("trail");
  const body = await battles_query.handler(
    { db, account: { id: null, kind: "public", timezone: "UTC" }, live: null },
    { battle_id: id, verbosity: "full", timezone: "UTC" },
  );
  const b = body.battles[0];
  assert.equal(b.me.rounds.length, 3);
  assert.deepEqual(
    b.me.rounds.map((r) => r.crowns),
    [1, 0, 2],
  );
  assert.equal(b.opponents[0].rounds.length, 3);
  // Summed over the games, so no differential and no head-to-head vs.
  assert.equal(b.me.elixir.rounds, 3);
  assert.equal(b.me.elixir.differential, null);
  assert.equal(b.me.vs, null);
  assert.match(body.notes.join(" "), /sum across rounds/);
});

test("a duel whose game results were never kept shows its decks, no score", async () => {
  const id = await battleOf("trail");
  const { rows: kept } = await db.query(
    `select player_tag, round, crowns, king_tower_hp, princess_tower_hp_1,
            princess_tower_hp_2, elixir_leaked
       from battle_participant_round where battle_id = $1`,
    [id],
  );
  await db.query(
    `update battle_participant_round
        set crowns = null, king_tower_hp = null, princess_tower_hp_1 = null,
            princess_tower_hp_2 = null, elixir_leaked = null
      where battle_id = $1`,
    [id],
  );
  try {
    const read = await readPublicBattle(db, id);
    assert.equal(read.games.length, 3);
    for (const g of read.games) {
      assert.equal(g.winner, null);
      for (const x of g.sides) assert.equal(x.crowns, null);
    }
    for (const s of read.sides)
      for (const d of s.players[0].rounds) assert.equal(d.cards.length, 8);
    // No games to count, so the crowns, never a guessed tally.
    assert.equal(read.score.unit, "crowns");
    assert.deepEqual(
      [read.score.left, read.score.right],
      [read.sides[0].crowns, read.sides[1].crowns],
    );
  } finally {
    for (const k of kept)
      await db.query(
        `update battle_participant_round
            set crowns = $3, king_tower_hp = $4, princess_tower_hp_1 = $5,
                princess_tower_hp_2 = $6, elixir_leaked = $7
          where battle_id = $1 and player_tag = $2 and round = $8`,
        [
          id,
          k.player_tag,
          k.crowns,
          k.king_tower_hp,
          k.princess_tower_hp_1,
          k.princess_tower_hp_2,
          k.elixir_leaked,
          k.round,
        ],
      );
  }
});

test("a duel game's King left out under three crowns reads fallen; any other gap stays missing", async () => {
  // Jamie, 2026-11-13: show it "Down". The game omits a round's
  // kingTowerHitPoints for the side whose opponent took three crowns.
  const id = await battleOf("trail");
  const before = await readPublicBattle(db, id);
  const [leftTag, rightTag] = before.sides.map((s) => s.players[0].player_tag);
  const { rows: kept } = await db.query(
    `select player_tag, round, crowns, king_tower_hp
       from battle_participant_round where battle_id = $1`,
    [id],
  );
  const set = (tag, round, col, v) =>
    db.query(
      `update battle_participant_round set ${col} = $4
        where battle_id = $1 and player_tag = $2 and round = $3`,
      [id, tag, round, v],
    );
  // Game 3, which the left side won 2-1: now a three-crown win, the
  // loser's King left out as the game sends it. Game 1, which the right
  // side lost 0-1: the left side's King missing with one crown against.
  await set(leftTag, 3, "crowns", 3);
  await set(rightTag, 3, "king_tower_hp", null);
  await set(leftTag, 1, "king_tower_hp", null);
  try {
    const read = await readPublicBattle(db, id);
    const [g1, , g3] = read.games;
    assert.equal(g3.sides[1].tower_hp.king, 0);
    assert.equal(g3.sides[1].tower_hp.king_inferred, true);
    // The Princess Towers stay as recorded.
    assert.deepEqual(
      g3.sides[1].tower_hp.princess,
      before.games[2].sides[1].tower_hp.princess,
    );
    // The winning side's own King is untouched.
    assert.deepEqual(g3.sides[0].tower_hp, before.games[2].sides[0].tower_hp);
    // Fewer than three crowns against: still not recorded.
    assert.equal(g1.sides[0].tower_hp.king, undefined);
    assert.equal(g1.sides[0].tower_hp.king_inferred, undefined);
    // Winners and the score are what they were.
    assert.deepEqual(
      read.games.map((g) => g.winner),
      before.games.map((g) => g.winner),
    );
    assert.deepEqual(read.score, before.score);
    // The picture draws the last game from the same projection: the
    // right side's King reads Down (share-image.test.mjs reads the tiles).
    const svg = drawBattle(read, { ...(await metrics()), art: new Map() });
    const texts = [
      ...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g),
    ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
    const kings = texts
      .filter((e) => e.t === "King Tower")
      .sort((a, b) => a.x - b.x)
      .map((e) => texts.find((v) => v.x === e.x && v.y === e.y + 27)?.t);
    assert.equal(kings.length, 2);
    assert.equal(kings[1], "Down");
    assert.notEqual(kings[0], "Down");
  } finally {
    for (const k of kept) {
      await set(k.player_tag, k.round, "crowns", k.crowns);
      await set(k.player_tag, k.round, "king_tower_hp", k.king_tower_hp);
    }
  }
});

test("withFallenKing: only a missing King under three crowns against", () => {
  const side = (king, crowns = 0) => ({
    crowns,
    tower_hp: {
      ...(king === undefined ? {} : { king }),
      princess: [0, 1200],
    },
  });
  assert.deepEqual(withFallenKing(side(undefined), { crowns: 3 }).tower_hp, {
    king: 0,
    princess: [0, 1200],
    king_inferred: true,
  });
  assert.deepEqual(withFallenKing(side(null), { crowns: 3 }).tower_hp, {
    king: 0,
    princess: [0, 1200],
    king_inferred: true,
  });
  // A King the game sent is never touched, 0 or not.
  for (const king of [0, 4000]) {
    const s = side(king);
    assert.equal(withFallenKing(s, { crowns: 3 }), s);
  }
  // Fewer than three crowns against, or no result for the other side.
  for (const other of [{ crowns: 2 }, { crowns: null }, null]) {
    const s = side(undefined);
    assert.equal(withFallenKing(s, other), s);
  }
  // No tower state at all, or no side: left as it is.
  assert.equal(
    withFallenKing({ crowns: 0, tower_hp: null }, { crowns: 3 }).tower_hp,
    null,
  );
  assert.equal(withFallenKing(null, { crowns: 3 }), null);
});

test("a deck is null only where the stored row holds no cards", async () => {
  const id = await battleOf("PvP");
  const before = await readPublicBattle(db, id);
  const tag = before.sides[1].players[0].player_tag;
  const { rows: kept } = await db.query(
    `select cards, card_forms, card_levels, card_stars, tower_troop_id,
            tower_form, tower_level, tower_star
       from battle_participant where battle_id = $1 and player_tag = $2`,
    [id, tag],
  );
  assert.ok(before.sides.every((s) => s.players[0].deck !== null));
  await db.query(
    `update battle_participant
        set cards = null, card_forms = null, card_levels = null,
            card_stars = null, tower_troop_id = null, tower_form = null,
            tower_level = null, tower_star = null
      where battle_id = $1 and player_tag = $2`,
    [id, tag],
  );
  try {
    const read = await readPublicBattle(db, id);
    assert.notEqual(read.sides[0].players[0].deck, null);
    assert.equal(read.sides[1].players[0].deck, null);
    assert.equal(read.sides[1].players[0].rounds, null);
  } finally {
    const k = kept[0];
    await db.query(
      `update battle_participant
          set cards = $3, card_forms = $4, card_levels = $5, card_stars = $6,
              tower_troop_id = $7, tower_form = $8, tower_level = $9,
              tower_star = $10
        where battle_id = $1 and player_tag = $2`,
      [
        id,
        tag,
        k.cards,
        k.card_forms,
        k.card_levels,
        k.card_stars,
        k.tower_troop_id,
        k.tower_form,
        k.tower_level,
        k.tower_star,
      ],
    );
  }
});

test("scoreOf: a tally over only some games is never the score", () => {
  // Codex on #946: one known winner of three is not a 1-0 series.
  assert.deepEqual(
    scoreOf({ outcome: "win", crowns: 3 }, { outcome: "loss", crowns: 1 }, [
      { winner: "left" },
      { winner: null },
      { winner: null },
    ]),
    { left: 3, right: 1, unit: "crowns" },
  );
});

test("scoreOf: games won only where they agree with the recorded result", () => {
  const games = [{ winner: "left" }, { winner: "right" }, { winner: "right" }];
  // The games say right, the record says left won: the crowns lead.
  assert.deepEqual(
    scoreOf(
      { outcome: "win", crowns: 4 },
      { outcome: "loss", crowns: 3 },
      games,
    ),
    { left: 4, right: 3, unit: "crowns" },
  );
  assert.deepEqual(
    scoreOf(
      { outcome: "loss", crowns: 2 },
      { outcome: "win", crowns: 3 },
      games,
    ),
    { left: 1, right: 2, unit: "games" },
  );
  assert.deepEqual(
    scoreOf(
      { outcome: "win", crowns: 3 },
      { outcome: "loss", crowns: 0 },
      null,
    ),
    { left: 3, right: 0, unit: "crowns" },
  );
});

test("the JSON route: 200 cached an hour, 404 and 300 a minute", async () => {
  const id = await battleOf("PvP");
  const ok = await get(`/api/public/battles/${id.slice(0, 12)}`);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.headers["cache-control"], "public, max-age=3600");
  const body = JSON.parse(ok.body);
  assert.equal(body.battle.id, id);
  assert.equal("status" in body, false);

  const none = await get("/api/public/battles/ffffffffffff");
  assert.equal(none.statusCode, 404);
  assert.equal(none.headers["cache-control"], "public, max-age=60");
  const junk = await get("/api/public/battles/not-a-battle");
  assert.equal(junk.statusCode, 404);

  // A hand-cut prefix two battles share names both.
  const twin = id.slice(0, 12) + (id[12] === "0" ? "1" : "0") + id.slice(13);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     select $2, battle_time, type, type_class from battle where battle_id = $1`,
    [id, twin],
  );
  try {
    const both = await get(`/api/public/battles/${id.slice(0, 12)}`);
    assert.equal(both.statusCode, 300);
    assert.equal(JSON.parse(both.body).matches.length, 2);
  } finally {
    await db.query(`delete from battle where battle_id = $1`, [twin]);
  }
});

test("the page: the app shell named for the battle", async () => {
  const id = await battleOf("PvP");
  const read = await readPublicBattle(db, id);
  const res = await get(`/battle/${read.battle.short_id}`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /^text\/html/);
  assert.equal(res.headers["cache-control"], "public, max-age=3600");
  const { title } = previewOf(read);
  assert.ok(res.body.includes(`<title>`));
  assert.ok(res.body.includes(" - Elixir</title>"));
  assert.ok(res.body.includes('<meta name="robots" content="noindex" />'));
  assert.ok(
    res.body.includes(`<link rel="canonical" href="${read.battle.url}" />`),
  );
  assert.ok(res.body.includes('<link rel="stylesheet" href="/app.css" />'));
  assert.ok(res.body.includes('<div id="root"></div>'));
  // The shell's own tags give way: one title, one og:title.
  assert.equal(res.body.match(/<title>/g).length, 1);
  assert.equal(res.body.match(/property="og:title"/g).length, 1);
  assert.equal(res.body.includes('content="index"'), false);
  assert.ok(title.length > 0);

  // The preview is the battle's own picture.
  assert.ok(
    res.body.includes(
      `<meta property="og:image" content="${read.battle.url}.png" />`,
    ),
  );
  assert.ok(
    res.body.includes(
      `<meta name="twitter:image" content="${read.battle.url}.png" />`,
    ),
  );
  assert.equal(res.body.includes("/assets/og.png"), false);

  const missing = await get("/battle/ffffffffffff");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers["cache-control"], "public, max-age=60");
});

test("the picture: a 1200 by 630 PNG, cached a day, and a 404 for no battle", async () => {
  const id = await battleOf("PvP");
  const before = await writes();
  const res = await get(`/battle/${id.slice(0, 12)}.png`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["cache-control"], "public, max-age=86400");
  assert.equal(res.isBase64Encoded, true);
  const png = Buffer.from(res.body, "base64");
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  // IHDR: width and height, big-endian, after the signature and header.
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  // A picture view writes nothing either.
  assert.deepEqual(await writes(), before);

  const none = await get("/battle/ffffffffffff.png");
  assert.equal(none.statusCode, 404);
  assert.equal(none.headers["cache-control"], "public, max-age=60");
  assert.match(none.headers["content-type"], /^text\/plain/);

  const bare = makeHandler({ databaseUrl, secret: "test" });
  const off = await bare({
    path: `/battle/${id.slice(0, 12)}.png`,
    method: "GET",
    headers: {},
  });
  assert.equal(off.statusCode, 503);
});

test("the picture's read skips the meetings and the sitting", async () => {
  const id = await battleOf("PvP");
  const read = await readPublicBattle(db, id, { around: false });
  assert.equal(read.status, 200);
  assert.deepEqual(read.meetings, []);
  assert.deepEqual(read.sitting, []);
});

test("the page without a shell says so rather than guessing", async () => {
  const bare = makeHandler({ databaseUrl, secret: "test" });
  const res = await bare({
    path: "/battle/ffffffffffff",
    method: "GET",
    headers: {},
  });
  assert.equal(res.statusCode, 503);
});

test("namedShell escapes what a player named themselves", () => {
  const read = {
    battle: {
      url: "https://elixir.poapkings.com/battle/0123456789ab",
      mode_group: "ladder",
      duration: { basis: "regulation_ran" },
      arena: { name: "Arena" },
    },
    sides: [
      { crowns: 1, players: [{ name: '<script>"x"</script>', deck: null }] },
      { crowns: 0, players: [{ name: "B&B", deck: null }] },
    ],
    games: null,
  };
  const html = namedShell(SHELL, read);
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;&quot;x&quot;&lt;/script&gt;"));
  assert.ok(html.includes("B&amp;B"));
  assert.ok(html.includes("Went to time."));
});

test("cycle4: the four cheapest, null when a cost is unknown", () => {
  const costs = new Map([
    [1, 3],
    [2, 1],
    [3, 4],
    [4, 2],
    [5, 5],
  ]);
  assert.equal(
    cycle4([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }], costs),
    10,
  );
  assert.equal(
    cycle4([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 9 }], costs),
    null,
  );
});
