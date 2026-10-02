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
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import {
  projectRankingBoard,
  projectClanBoard,
  projectEvents,
} from "../../ingest/src/rankings.mjs";
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
  // A clan ladder, two events days, and a season final (0069).
  await projectClanBoard(db, {
    board: "clans",
    entityKey: "global",
    receiptId: null,
    fetchedAt: T2,
    payload: {
      items: [
        {
          tag: "#2PPPP",
          name: "Alpha",
          rank: 1,
          previousRank: 2,
          clanScore: 90000,
          members: 50,
          badgeId: 7,
          location: { id: 57000249 },
        },
        {
          tag: "#2GGGG",
          name: "Gamma",
          rank: 2,
          previousRank: 1,
          clanScore: 89000,
          members: 49,
          badgeId: 8,
        },
      ],
      paging: {},
    },
  });
  await projectEvents(db, {
    fetchedAt: T1,
    payload: [
      { eventTag: "#R8U2RCJ", title: "C.H.A.O.S", description: "modifiers" },
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  await projectEvents(db, {
    fetchedAt: "2026-09-12T10:00:00Z",
    payload: [
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  // A third sighting before 10:00Z with its receipt on record: UTC day
  // 2026-09-13, game day 2026-09-12 (3.17.0, game_days_seen).
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'rk-gw', '127.0.0.1', 'active') returning gateway_id`,
    [owner.account_id],
  );
  // Every sighting comes from an admitted read, and game_events selects
  // by the reads inside its window (Gym #125), so each sighting above has
  // its receipt too.
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('events', 'GLOBAL', $2, 'h-events-1', $1, 'admitted'),
            ('events', 'GLOBAL', '2026-09-12T10:00:00Z', 'h-events-2', $1, 'admitted'),
            ('events', 'GLOBAL', '2026-09-13T04:00:00Z', 'h-events-3', $1, 'admitted')`,
    [gw.gateway_id, T1],
  );
  await projectEvents(db, {
    fetchedAt: "2026-09-13T04:00:00Z",
    payload: [
      { eventTag: "#R8UURVL", title: "Merge Tactics", description: null },
    ],
  });
  await projectRankingBoard(db, {
    board: "pol_final",
    entityKey: "135",
    receiptId: null,
    payload: {
      items: [player(1, "#2G0GG", "g-one", 3914, ["#2GGGG", "Gamma"])],
      paging: {},
    },
    fetchedAt: "2026-09-07T10:30:00Z",
    seasonId: "135",
    seasonMonth: "2026-08",
  });
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

test("game_events: what was on, by the days it was seen", async () => {
  const { body, isError } = await invoke("game_events", {
    from: "2026-09-11",
    to: "2026-09-12",
  });
  assert.equal(isError, false, JSON.stringify(body));
  const merge = body.events.find((e) => e.title === "Merge Tactics");
  const chaos = body.events.find((e) => e.title === "C.H.A.O.S");
  assert.deepEqual(merge.game_days_seen, ["2026-09-11", "2026-09-12"]);
  assert.deepEqual(chaos.game_days_seen, ["2026-09-11"]);
  assert.ok(!("days_seen" in merge), "4.0.0: the UTC-day list is gone");
  assert.equal(body.latest_sighting_day, "2026-09-13");
  assert.equal(body.first_sighting_day, "2026-09-11");
  assert.ok(
    body.notes.some((n) => n.startsWith("Sightings began 2026-09-11")),
    "the horizon note reads the table",
  );
  assert.equal(merge.running_on_latest_day, true);
  assert.equal(chaos.running_on_latest_day, false);
});

test("game_events: game_days_seen puts the same sightings on the game day grid, and the window says its season (3.17.0, call 6)", async () => {
  const { body, isError } = await invoke("game_events", {
    from: "2026-09-11",
    to: "2026-09-13",
  });
  assert.equal(isError, false, JSON.stringify(body));
  const merge = body.events.find((e) => e.title === "Merge Tactics");
  // Three UTC days; the 04:00Z read on the 13th is game day the 12th,
  // and the two reads without a receipt keep their UTC day.
  assert.deepEqual(merge.game_days_seen, ["2026-09-11", "2026-09-12"]);
  assert.ok(!("days_seen" in merge));
  assert.equal(merge.running_on_latest_day, true);
  assert.ok("season" in body.applied.window);
  assert.ok(Array.isArray(body.applied.window.crosses));
  assert.ok(body.notes.some((n) => /game_days_seen is the game days/.test(n)));
});

// --- 6.2.0: the Elixir Gym's rankings run (feedback #71-#74, #76) ---------
