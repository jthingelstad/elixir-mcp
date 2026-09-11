/**
 * The recorded leaderboards, read back (0068).
 *
 * Two snapshots an hour apart, then the questions the tools exist for:
 * the latest board, the board as it was before the movement (as_of), a
 * page past the first, the clans counted over the whole board with the
 * tie broken by best rank, and a location named by country code.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { projectRankingBoard } from "../../ingest/src/rankings.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_rankings_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let invoke;

const T1 = "2026-09-11T10:00:00Z";
const T2 = "2026-09-11T11:00:00Z";

const player = (rank, tag, name, elo, clan) => ({
  rank,
  tag,
  name,
  eloRating: elo,
  ...(clan ? { clan: { tag: clan[0], name: clan[1] } } : {}),
});

// Alpha has three rated, Beta and Gamma two each; Gamma's best is #1 and
// Beta's #4, so Gamma takes the tie. Zed has no clan.
const BOARD_1 = {
  items: [
    player(1, "#2G0GG", "g-one", 2200, ["#2GGGG", "Gamma"]),
    player(2, "#2P0PP", "a-one", 2150, ["#2PPPP", "Alpha"]),
    player(3, "#2P0P2", "a-two", 2100, ["#2PPPP", "Alpha"]),
    player(4, "#2Y0YY", "b-one", 2050, ["#2YYYY", "Beta"]),
    player(5, "#2P0P8", "a-three", 2000, ["#2PPPP", "Alpha"]),
    player(6, "#2G0G2", "g-two", 1950, ["#2GGGG", "Gamma"]),
    player(7, "#2Y0Y2", "b-two", 1900, ["#2YYYY", "Beta"]),
    player(8, "#2U0UU", "zed", 1850, null),
  ],
  paging: {},
};
// An hour later a-one takes #1.
const BOARD_2 = {
  items: [
    player(1, "#2P0PP", "a-one", 2210, ["#2PPPP", "Alpha"]),
    player(2, "#2G0GG", "g-one", 2200, ["#2GGGG", "Gamma"]),
    ...BOARD_1.items.slice(2),
  ],
  paging: {},
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('rk-owner', 'approved', true) returning account_id`,
  );
  // The global board records its top 200 (seeded); keep the test's
  // recordings out of the way by reading a country board that records none.
  for (const [payload, at] of [
    [BOARD_1, T1],
    [BOARD_2, T2],
  ]) {
    await projectRankingBoard(db, {
      board: "pol",
      entityKey: "57000249",
      receiptId: null,
      payload,
      fetchedAt: at,
    });
  }
  invoke = makeInvoker({
    db,
    account: {
      accountId: owner.account_id,
      isOwner: true,
      timezone: "UTC",
    },
    registry: makeRegistry(),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("rankings_players: the latest board, by country code, with the snapshot's own clocks", async () => {
  const { body, isError } = await invoke("rankings_players", {
    location: "US",
    limit: 3,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.location.key, "57000249");
  assert.equal(body.location.country_code, "US");
  assert.equal(body.snapshot.observed_at, new Date(T2).toISOString());
  assert.equal(body.snapshot.entries, 8);
  assert.equal(body.snapshot.truncated, false);
  assert.deepEqual(
    body.players.map((p) => [p.rank, p.player_tag, p.name, p.clan_name]),
    [
      [1, "#2P0PP", "a-one", "Alpha"],
      [2, "#2G0GG", "g-one", "Gamma"],
      [3, "#2P0P2", "a-two", "Alpha"],
    ],
  );
  assert.deepEqual(body.applied, {
    board: "pol",
    location: "57000249",
    limit: 3,
    offset: 0,
    verbosity: "full",
  });
  // A page remains, and the note says how to get it.
  assert.ok(body.notes.some((n) => n.includes("offset 3")));
  assert.equal(body.docs, "recording#leaderboards");
});

test("rankings_players: as_of reads the board before the movement", async () => {
  const { body, isError } = await invoke("rankings_players", {
    location: "57000249",
    as_of: "2026-09-11T10:30:00Z",
    limit: 2,
    verbosity: "compact",
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.equal(body.snapshot.observed_at, new Date(T1).toISOString());
  assert.deepEqual(body.players, [
    { rank: 1, player_tag: "#2G0GG", rating: 2200 },
    { rank: 2, player_tag: "#2P0PP", rating: 2150 },
  ]);
  assert.equal(body.applied.as_of, "2026-09-11T10:30:00.000Z");
});

test("rankings_players: a page past the first, and the tail past the end", async () => {
  const { body } = await invoke("rankings_players", {
    location: "US",
    limit: 3,
    offset: 6,
  });
  assert.deepEqual(
    body.players.map((p) => p.player_tag),
    ["#2Y0Y2", "#2U0UU"],
  );
  assert.ok(!body.notes.some((n) => n.startsWith("Page")), "no further page");
  const { body: past } = await invoke("rankings_players", {
    location: "US",
    offset: 50,
  });
  assert.deepEqual(past.players, []);
});

test("rankings_clans: counted over the whole board, ties to the best-placed player", async () => {
  const { body, isError } = await invoke("rankings_clans", {
    location: "US",
    limit: 2,
  });
  assert.equal(isError, false, JSON.stringify(body));
  assert.deepEqual(
    body.clans.map((c) => [
      c.rank,
      c.clan_name,
      c.rated_players,
      c.best_rank,
      c.best_player_name,
    ]),
    [
      [1, "Alpha", 3, 1, "a-one"],
      // Gamma and Beta both have two; Gamma's best is #2 to Beta's #4.
      [2, "Gamma", 2, 2, "g-one"],
    ],
  );
  assert.equal(body.clans_total, 3);
  assert.equal(body.players_without_clan, 1);
  assert.ok(body.notes.some((n) => n.includes("best_rank")));
});

test("rankings_clans: as_of sees the earlier tie broken the other way", async () => {
  // Before the movement Gamma's best was #1, still ahead of Beta's #4 -
  // but Alpha's best was #2, so the order of the top two is unchanged;
  // what as_of proves here is that the aggregate reads the older snapshot.
  const { body } = await invoke("rankings_clans", {
    location: "US",
    as_of: "2026-09-11",
    timezone: "UTC",
    limit: 3,
  });
  assert.equal(
    body.snapshot.observed_at,
    new Date(T2).toISOString(),
    "end of the 11th UTC is after both",
  );
  const { body: earlier } = await invoke("rankings_clans", {
    location: "US",
    as_of: "2026-09-11T10:15:00Z",
    limit: 3,
  });
  assert.equal(earlier.snapshot.observed_at, new Date(T1).toISOString());
  assert.equal(earlier.clans[0].clan_name, "Alpha");
  assert.equal(earlier.clans[0].best_rank, 2);
  assert.equal(earlier.clans[1].clan_name, "Gamma");
  assert.equal(earlier.clans[1].best_rank, 1);
});

test("a board nobody has recorded yet says so, and an unknown location refuses", async () => {
  const { body, isError } = await invoke("rankings_players", {
    location: "JP",
  });
  assert.equal(isError, false);
  assert.equal(body.snapshot, null);
  assert.deepEqual(body.players, []);
  assert.ok(body.notes.some((n) => n.includes("not been recorded yet")));

  const { body: bad, isError: refused } = await invoke("rankings_players", {
    location: "Narnia",
  });
  assert.equal(refused, true);
  assert.equal(bad.error.code, "not_found");
});

test("live: true and as_of together are refused rather than guessed between", async () => {
  const { body, isError } = await invoke("rankings_players", {
    live: true,
    as_of: "2026-09-10",
  });
  assert.equal(isError, true);
  assert.equal(body.error.code, "bad_request");
});
