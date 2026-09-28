/**
 * cards_catalog's tower_troops is what the current /cards lists (#44).
 *
 * On 2026-09-15 the tool answered five tower troops against the official
 * four. The fifth, 29000000 "Archer Queen", was never sent by the API: an
 * elixir-bot unit test's mocked /cards response had leaked into the bot's
 * raw payload table on 2026-05-28, and the 2026-09-15 archive replay
 * admitted it as a catalog fetch. Support rows also arrive as stubs from
 * a battle's or a profile's supportCards (0091). in_catalog (0191) is what
 * the newest fetch lists; every row stays for the history that names it.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb, fixture } from "../../ingest/test/helpers.mjs";
import { ensureCards } from "../../ingest/src/deck-cards.mjs";
import { projectCardCatalog } from "../../ingest/src/cards.mjs";
import { makeRegistry } from "../src/tools.mjs";

let scratch;
let catalog;
const registry = makeRegistry();
// A tower troop released after the fixture catalog, first seen in a battle.
const STUB = { card_id: 159000005, name: "New Tower", kind: "support" };
const OFFICIAL = [159000000, 159000001, 159000002, 159000004];

const towerIds = async () => {
  const body = await registry.invoke(
    "cards_catalog",
    { db: scratch.db, account: null },
    {},
  );
  return body.tower_troops.map((t) => t.id);
};
const inCatalog = async (id) =>
  (
    await scratch.db.query(
      `select in_catalog, catalog_seen_at from card where card_id = $1`,
      [id],
    )
  ).rows[0];
const versions = async () =>
  (await scratch.db.query(`select card_id, xmin::text v from card order by 1`))
    .rows;
const withSupport = (ids) => ({
  ...catalog,
  supportItems: [
    ...catalog.supportItems.filter((s) => ids.includes(s.id)),
    ...(ids.includes(STUB.card_id)
      ? [{ id: STUB.card_id, name: STUB.name, rarity: "epic", maxLevel: 7 }]
      : []),
  ],
});
// Admission advances poll_state after the projector (ingest pipeline);
// the tests do the same so the stale-fetch guard sees real history.
async function admit(payload, fetchedAt) {
  const out = await projectCardCatalog(scratch.db, { payload, fetchedAt });
  await scratch.db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ('GLOBAL', 'cards', $1)
     on conflict (subject_tag, endpoint) do update set last_admitted_at =
       greatest(poll_state.last_admitted_at, excluded.last_admitted_at)`,
    [fetchedAt],
  );
  return out;
}

before(async () => {
  scratch = await scratchDb("catalog_towers");
  catalog = await fixture("cards/catalog.json");
  assert.deepEqual(
    catalog.supportItems.map((s) => s.id),
    OFFICIAL,
  );
});

after(async () => scratch.drop());

test("a replayed old catalog lists nothing: the 2026-05-28 leak stays out", async () => {
  await admit(catalog, "2026-09-10T10:00:00Z");
  assert.deepEqual(await towerIds(), OFFICIAL);
  // The leaked payload, replayed after the live catalog was recorded.
  await projectCardCatalog(scratch.db, {
    payload: {
      items: [{ name: "Knight", id: 26000000 }],
      supportItems: [{ name: "Archer Queen", id: 29000000 }],
    },
    fetchedAt: "2026-05-28T22:20:24Z",
  });
  const leaked = await inCatalog(29000000);
  assert.equal(leaked.in_catalog, false, "recorded, not listed");
  assert.deepEqual(await towerIds(), OFFICIAL, "four, not five");
  const { rows } = await scratch.db.query(
    `select count(*)::int n from card where kind = 'card' and in_catalog`,
  );
  assert.equal(rows[0].n, catalog.items.length, "the deck cards stay listed");
});

test("a support stub from a battle is not a Tower Troop the catalog lists", async () => {
  // The battle arrives first: the stub is written, unconfirmed.
  await ensureCards(scratch.db, [STUB], "2026-09-10T12:00:00Z");
  assert.deepEqual(await inCatalog(STUB.card_id), {
    in_catalog: false,
    catalog_seen_at: null,
  });
  // The next catalog does not list it: still a stub, still not listed.
  await admit(catalog, "2026-09-11T10:00:00Z");
  assert.deepEqual(await towerIds(), OFFICIAL);
  const row = await inCatalog(STUB.card_id);
  assert.equal(row.in_catalog, false);
  assert.equal(row.catalog_seen_at, null, "still a stub");

  // An unchanged re-fetch writes nothing, stub included.
  const before = await versions();
  const again = await admit(catalog, "2026-09-11T11:00:00Z");
  assert.equal(again.changed, 0);
  assert.deepEqual(await versions(), before, "no row version moved");
});

test("an event-only card from a battle is on the record, not in the catalog's cards", async () => {
  // Super Archers is played in event modes and never listed by /cards.
  await ensureCards(
    scratch.db,
    [{ card_id: 26000078, name: "Super Archers", kind: "card" }],
    "2026-09-11T12:00:00Z",
  );
  const body = await registry.invoke(
    "cards_catalog",
    { db: scratch.db, account: null },
    {},
  );
  assert.equal(body.cards.length, catalog.items.length, "the catalog's own");
  assert.ok(!body.cards.some((c) => c.id === 26000078));
  const { rows } = await scratch.db.query(
    `select name from card where card_id = 26000078`,
  );
  assert.equal(rows[0].name, "Super Archers", "the row stays");
});

test("a later catalog that lists the stub confirms it", async () => {
  await admit(withSupport([...OFFICIAL, STUB.card_id]), "2026-09-12T10:00:00Z");
  const row = await inCatalog(STUB.card_id);
  assert.equal(row.in_catalog, true);
  assert.ok(row.catalog_seen_at, "confirmed");
  assert.deepEqual(await towerIds(), [...OFFICIAL, STUB.card_id]);
});

test("a tower troop the current catalog drops leaves tower_troops; its row stays", async () => {
  const dropped = [OFFICIAL[1], STUB.card_id];
  const kept = OFFICIAL.filter((id) => !dropped.includes(id));
  const out = await admit(withSupport(kept), "2026-09-13T10:00:00Z");
  assert.equal(out.changed, 2, "only the two rows whose membership moved");
  assert.deepEqual(await towerIds(), kept);
  for (const id of dropped) {
    const row = await inCatalog(id);
    assert.equal(row.in_catalog, false, `${id} no longer listed`);
    assert.ok(row.catalog_seen_at, `${id} keeps its confirmation`);
  }
  // A delayed older fetch that still listed them does not list them again.
  await projectCardCatalog(scratch.db, {
    payload: catalog,
    fetchedAt: "2026-09-12T12:00:00Z",
  });
  assert.deepEqual(await towerIds(), kept, "a stale fetch moves nothing");
  // The deck cards are untouched by a supportItems change.
  const { rows } = await scratch.db.query(
    `select count(*)::int n from card where kind = 'card' and in_catalog`,
  );
  assert.equal(rows[0].n, catalog.items.length);
});

test("a payload without supportItems says nothing about tower troops", async () => {
  const itemsOnly = { ...catalog };
  delete itemsOnly.supportItems;
  await admit(itemsOnly, "2026-09-14T10:00:00Z");
  assert.deepEqual(
    await towerIds(),
    OFFICIAL.filter((id) => id !== OFFICIAL[1]),
  );
  // And the catalog lists the returning tower troop again.
  await admit(catalog, "2026-09-15T10:00:00Z");
  assert.deepEqual(await towerIds(), OFFICIAL);
});
