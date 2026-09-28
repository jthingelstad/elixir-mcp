import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { playerEvents } from "./event-rows.mjs";

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
    (await playerEvents(ctx.db, "player_tag = $1", [tag])).map((r) => ({
      event_type: r.event_type,
      payload: r.payload,
    }));
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

// #110 (review 2026-09-27 §7.2): an Evolution or Hero unlock is a moment.
// evolutionLevel on a collection card is a bit field (1 Evolution, 2
// Hero, 3 both), so each bit newly set is one card_form_unlocked.
test("a form unlock: each newly set form bit is one moment; first sight and a replay write none", async () => {
  const other = "#PYLQGRJC";
  await ctx.db.query(`insert into player (player_tag) values ($1)`, [other]);
  const profile = structuredClone(await fixture("player/profile.json"));
  const valkyrie = profile.cards.find((c) => c.id === 26000011);
  const tesla = profile.cards.find((c) => c.id === 27000006);
  const witch = profile.cards.find((c) => c.id === 26000007);
  assert.equal(valkyrie.evolutionLevel, 1, "fixture: Evolution Valkyrie");
  assert.equal(tesla.evolutionLevel, undefined, "fixture: no Tesla form");
  const forms = async () =>
    (
      await playerEvents(
        ctx.db,
        "player_tag = $1 and event_type = 'card_form_unlocked'",
        [other],
      )
    ).map((r) => r.payload);

  // First sight of a collection that already holds forms: history.
  await projectPlayerCards(ctx.db, {
    playerTag: other,
    payload: profile,
    fetchedAt: "2026-09-12T12:00:00Z",
  });
  assert.deepEqual(await forms(), [], "a first observation is silent");

  // A replay (moments false) records the new forms and names none.
  valkyrie.evolutionLevel = 3;
  await projectPlayerCards(ctx.db, {
    playerTag: other,
    payload: profile,
    fetchedAt: "2026-09-12T13:00:00Z",
    moments: false,
  });
  assert.deepEqual(await forms(), [], "a replay writes rows, never moments");
  const { rows: held } = await ctx.db.query(
    `select evolution_level from player_card where player_tag = $1 and card_id = 26000011`,
    [other],
  );
  assert.equal(held[0].evolution_level, 3, "the replay still wrote the row");

  // Live: the Hero bit on Evolution Valkyrie's card is the only new bit
  // there; Tesla's first form is another. Witch, unchanged, says nothing.
  valkyrie.evolutionLevel = 1;
  await projectPlayerCards(ctx.db, {
    playerTag: other,
    payload: profile,
    fetchedAt: "2026-09-12T14:00:00Z",
    moments: false,
  });
  valkyrie.evolutionLevel = 3;
  tesla.evolutionLevel = 1;
  const moved = await projectPlayerCards(ctx.db, {
    playerTag: other,
    payload: profile,
    fetchedAt: "2026-09-12T15:00:00Z",
  });
  assert.equal(moved.changed, 2);
  const got = await forms();
  assert.deepEqual(got.map((p) => `${p.card_id}:${p.form}`).sort(), [
    "26000011:hero",
    "27000006:evolution",
  ]);
  assert.ok(got.every((p) => typeof p.name === "string" && p.name));
  assert.equal(witch.evolutionLevel, 1);

  // Both bits at once on a card with none: two moments, one per form.
  const knight = profile.cards.find((c) => c.id === 26000000);
  knight.evolutionLevel = undefined;
  await projectPlayerCards(ctx.db, {
    playerTag: other,
    payload: profile,
    fetchedAt: "2026-09-12T16:00:00Z",
    moments: false,
  });
  knight.evolutionLevel = 3;
  await projectPlayerCards(ctx.db, {
    playerTag: other,
    payload: profile,
    fetchedAt: "2026-09-12T17:00:00Z",
  });
  assert.deepEqual(
    (await forms())
      .filter((p) => p.card_id === 26000000)
      .map((p) => p.form)
      .sort(),
    ["evolution", "hero"],
  );
  // No level moved, so no level moment rode along.
  const { rows: others } = await ctx.db.query(
    `select event_type from player_event where player_tag = $1 and event_type <> 'card_form_unlocked'`,
    [other],
  );
  assert.deepEqual(others, []);
});
