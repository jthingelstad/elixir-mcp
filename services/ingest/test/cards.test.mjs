import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { projectCardCatalog, projectPlayerCards } from "../src/cards.mjs";
import { fixture, fixtureMeta, scratchDb } from "./helpers.mjs";

let ctx;
let meta;
let tag;

before(async () => {
  ctx = await scratchDb("cards");
  meta = await fixtureMeta();
  tag = meta["player/profile.json"].entity_key;
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [tag]);
});

after(async () => ctx.drop());

test("the catalog lands as rows, kind by list, and a re-fetch writes nothing", async () => {
  const catalog = await fixture("cards/catalog.json");
  const first = await projectCardCatalog(ctx.db, {
    payload: catalog,
    fetchedAt: "2026-09-10T10:00:00Z",
  });
  assert.equal(
    first.changed,
    catalog.items.length + catalog.supportItems.length,
  );
  const { rows } = await ctx.db.query(
    `select kind, count(*)::int n from card group by kind order by kind`,
  );
  assert.deepEqual(rows, [
    { kind: "card", n: catalog.items.length },
    { kind: "support", n: catalog.supportItems.length },
  ]);
  const versions = async () =>
    (await ctx.db.query(`select card_id, xmin::text v from card order by 1`))
      .rows;
  const before = await versions();
  const again = await projectCardCatalog(ctx.db, {
    payload: catalog,
    fetchedAt: "2026-09-11T10:00:00Z",
  });
  assert.equal(again.changed, 0);
  assert.deepEqual(await versions(), before, "no row version moved");
});

test("a collection: first observation is silent, then unlocks and level-ups nod; unchanged re-polls write nothing", async () => {
  const profile = structuredClone(await fixture("player/profile.json"));
  const first = await projectPlayerCards(ctx.db, {
    playerTag: tag,
    payload: profile,
    fetchedAt: "2026-09-10T12:00:00Z",
  });
  assert.equal(
    first.changed,
    profile.cards.length + (profile.supportCards?.length ?? 0),
  );
  const ledger = async () =>
    (
      await ctx.db.query(
        `select event_type, payload from player_event where player_tag = $1 order by event_id`,
        [tag],
      )
    ).rows;
  assert.deepEqual(await ledger(), [], "first sight is history, not news");
  const { rows: stored } = await ctx.db.query(
    `select level, count from player_card where player_tag = $1 and card_id = $2`,
    [tag, profile.cards[0].id],
  );
  assert.ok(stored[0].level <= 16, "display scale");
  assert.equal(stored[0].count, profile.cards[0].count);

  // Same payload, later: nothing written.
  const versions = async () =>
    (
      await ctx.db.query(
        `select card_id, xmin::text v from player_card where player_tag = $1 order by 1`,
        [tag],
      )
    ).rows;
  const before = await versions();
  const same = await projectPlayerCards(ctx.db, {
    playerTag: tag,
    payload: profile,
    fetchedAt: "2026-09-10T20:00:00Z",
  });
  assert.equal(same.changed, 0);
  assert.deepEqual(await ledger(), []);
  assert.deepEqual(await versions(), before, "no row version moved");

  // A count tick is recorded, not announced; a level-up and a new card nod.
  profile.cards[0].count += 5;
  profile.cards[1].level += 1;
  profile.cards.push({
    id: 26000999,
    name: "Test Card",
    level: 1,
    maxLevel: 16,
    count: 1,
  });
  const moved = await projectPlayerCards(ctx.db, {
    playerTag: tag,
    payload: profile,
    fetchedAt: "2026-09-11T12:00:00Z",
  });
  assert.equal(moved.changed, 3);
  // The ledger names both moments; the timeline shows the unlock and
  // keeps the level-up as a count.
  const rows = await ledger();
  assert.deepEqual(rows.map((r) => r.event_type).sort(), [
    "card_leveled",
    "card_unlocked",
  ]);
  const unlocked = rows.find((r) => r.event_type === "card_unlocked");
  assert.equal(unlocked.payload.card_id, 26000999);
  const leveled = rows.find((r) => r.event_type === "card_leveled");
  assert.equal(leveled.payload.card_id, profile.cards[1].id);
  assert.equal(leveled.payload.prior_level + 1, leveled.payload.level);
});
