/**
 * The arena and battle-log player upserts leave alone the rows they would
 * not change, so a submit no longer queues behind another that named the
 * same arena or player (2026-10-21, platform review §2: 83 lock waits
 * over a second in a week). What they write is what they wrote before.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { scratchDb } from "./helpers.mjs";
import {
  upsertArenaNames,
  upsertPlayersSeen,
} from "../src/catalog-upserts.mjs";

let scratch;
let other;
const AT = "2026-10-20T12:00:00Z";

// The statements as they were, to show the wait they made.
const OLD_ARENA = `insert into arena (arena_id, name, observed_at)
  select t.id, t.name, $3::timestamptz from unnest($1::int[], $2::text[]) as t(id, name)
  on conflict (arena_id) do update
    set name = excluded.name, observed_at = excluded.observed_at
  where arena.name is distinct from excluded.name`;
const OLD_PLAYER = `insert into player (player_tag, name)
  select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
  on conflict (player_tag) do update set
    last_seen_at = now(),
    name = coalesce(player.name, excluded.name)
  where (player.name is null and excluded.name is not null)
     or player.last_seen_at < now() - interval '1 day'`;

before(async () => {
  scratch = await scratchDb("catalog_upserts");
  other = new pg.Client({ connectionString: scratch.url });
  await other.connect();
  await scratch.db.query(
    `insert into arena (arena_id, name, observed_at) values
       (54000001, 'Goblin Stadium', $1), (54000002, 'Bone Pit', $1)`,
    [AT],
  );
  await scratch.db.query(
    `insert into player (player_tag, name, last_seen_at) values
       ('#2PYLQ0', 'Seen today', now()),
       ('#2PYLQ2', null, now()),
       ('#2PYLQ8', 'Seen long ago', now() - interval '3 days')`,
  );
});
after(async () => {
  await other?.end();
  await scratch?.drop();
});

/** Run `work` on the second connection while the first holds an open
 *  transaction that has run `holder`; the second gives up after 300 ms. */
async function whileHeld(holder, work) {
  await scratch.db.query("begin");
  try {
    await holder(scratch.db);
    await other.query("set lock_timeout = '300ms'");
    return await work(other).then(
      () => "done",
      (err) => err.code,
    );
  } finally {
    await scratch.db.query("rollback");
    await other.query("reset lock_timeout");
  }
}

test("a known arena under its own name is not locked", async () => {
  const same = new Map([[54000001, "Goblin Stadium"]]);
  // The old statement locked it for the holder's whole transaction.
  assert.equal(
    await whileHeld(
      (db) => db.query(OLD_ARENA, [[54000001], ["Goblin Stadium"], AT]),
      (db) => db.query(OLD_ARENA, [[54000001], ["Goblin Stadium"], AT]),
    ),
    "55P03",
  );
  assert.equal(
    await whileHeld(
      (db) => upsertArenaNames(db, same, AT),
      (db) => upsertArenaNames(db, same, AT),
    ),
    "done",
  );
});

test("an arena's new name and a new arena are still written", async () => {
  await upsertArenaNames(
    scratch.db,
    new Map([
      [54000002, "Bone Pit (renamed)"],
      [54000003, "Barbarian Bowl"],
      [54000001, "Goblin Stadium"],
    ]),
    "2026-10-21T00:00:00Z",
  );
  const { rows } = await scratch.db.query(
    "select arena_id, name, observed_at from arena order by arena_id",
  );
  assert.deepEqual(
    rows.map((r) => [r.arena_id, r.name, r.observed_at.toISOString()]),
    [
      [54000001, "Goblin Stadium", "2026-10-20T12:00:00.000Z"],
      [54000002, "Bone Pit (renamed)", "2026-10-21T00:00:00.000Z"],
      [54000003, "Barbarian Bowl", "2026-10-21T00:00:00.000Z"],
    ],
  );
  await upsertArenaNames(scratch.db, new Map(), AT); // nothing to name
});

test("a player seen today under a name is not locked", async () => {
  const args = [["#2PYLQ0"], ["Another name"]];
  assert.equal(
    await whileHeld(
      (db) => db.query(OLD_PLAYER, args),
      (db) => db.query(OLD_PLAYER, args),
    ),
    "55P03",
  );
  assert.equal(
    await whileHeld(
      (db) => upsertPlayersSeen(db, ...args),
      (db) => upsertPlayersSeen(db, ...args),
    ),
    "done",
  );
});

test("a first name, a stale sighting and a new tag are still written, as before", async () => {
  const before = (
    await scratch.db.query(
      "select player_tag, name, last_seen_at from player order by player_tag",
    )
  ).rows;
  await upsertPlayersSeen(
    scratch.db,
    ["#2PYLQ0", "#2PYLQ2", "#2PYLQ8", "#2PYLQ9"],
    ["Renamed in a log", "First name", "Renamed too", null],
  );
  const after = (
    await scratch.db.query(
      "select player_tag, name, last_seen_at from player order by player_tag",
    )
  ).rows;
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.player_tag, r]));
  const [b, a] = [by(before), by(after)];
  // Seen today with a name: untouched, the battle log's name ignored.
  assert.deepEqual(a["#2PYLQ0"], b["#2PYLQ0"]);
  // No name yet: the log's name fills it.
  assert.equal(a["#2PYLQ2"].name, "First name");
  // Seen three days ago: last_seen_at moves, the known name stays.
  assert.equal(a["#2PYLQ8"].name, "Seen long ago");
  assert.ok(a["#2PYLQ8"].last_seen_at > b["#2PYLQ8"].last_seen_at);
  // A new tag is a row.
  assert.equal(a["#2PYLQ9"].name, null);
  await upsertPlayersSeen(scratch.db, [], []);
});
