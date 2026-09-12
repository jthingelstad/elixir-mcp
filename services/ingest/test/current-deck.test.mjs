import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { processResult } from "../src/pipeline.mjs";
import { fixture, fixtureMeta, scratchDb } from "./helpers.mjs";

let ctx;
let gatewayId;
let meta;

function message({ endpoint, entityKey, payload, fetchedAt }) {
  return {
    v: 1,
    job: { endpoint, entity_key: entityKey, lane: "bulk" },
    gateway_id: gatewayId,
    fetched_at: fetchedAt,
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  };
}

before(async () => {
  ctx = await scratchDb("deck");
  const {
    rows: [account],
  } = await ctx.db.query(
    `insert into account (email_hash, status, is_owner, role) values ('deck-owner', 'approved', true, 'owner')
     returning account_id`,
  );
  const {
    rows: [gw],
  } = await ctx.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'deck-gw', '127.0.0.1', 'active') returning gateway_id`,
    [account.account_id],
  );
  gatewayId = gw.gateway_id;
  meta = await fixtureMeta();
});
after(async () => {
  await ctx.drop();
});

test("the active deck is projected once per deck: same deck writes nothing, a new deck moves observed_at, a replay never regresses", async () => {
  const profile = await fixture("player/profile.json");
  const tag = meta["player/profile.json"].entity_key;
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-02T10:00:00Z",
    }),
  );
  const row = async () =>
    (
      await ctx.db.query(
        `select cards, deck_hash, observed_at, xmin::text as v from player_current_deck where player_tag = $1`,
        [tag],
      )
    ).rows[0];
  const first = await row();
  assert.equal(first.cards.length, 8, "eight slots");
  assert.deepEqual(
    first.cards.map((c) => c.id).sort(),
    profile.currentDeck.map((c) => c.id).sort(),
    "the API's card ids, nothing else decides identity",
  );
  assert.equal(
    new Date(first.observed_at).toISOString(),
    "2026-09-02T10:00:00.000Z",
  );

  // The same deck an hour on: no write at all.
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-02T11:00:00Z",
    }),
  );
  const same = await row();
  assert.equal(same.v, first.v, "same deck: no new tuple version");
  assert.equal(
    new Date(same.observed_at).toISOString(),
    "2026-09-02T10:00:00.000Z",
  );

  // Swap one card (levels and order do not matter; ids do).
  const swapped = structuredClone(profile);
  const spare = profile.cards.find(
    (c) => !profile.currentDeck.some((d) => d.id === c.id),
  );
  swapped.currentDeck = [
    ...profile.currentDeck.slice(1).reverse(),
    { ...spare, level: 1 },
  ];
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: swapped,
      fetchedAt: "2026-09-02T12:00:00Z",
    }),
  );
  const moved = await row();
  assert.notEqual(moved.deck_hash, first.deck_hash);
  assert.equal(
    new Date(moved.observed_at).toISOString(),
    "2026-09-02T12:00:00.000Z",
  );
  assert.ok(moved.cards.some((c) => c.id === spare.id));

  // A replay of the original deck fetched BEFORE the swap lands late: the
  // row keeps the newer deck.
  await processResult(
    ctx.db,
    message({
      endpoint: "player",
      entityKey: tag,
      payload: profile,
      fetchedAt: "2026-09-02T11:30:00Z",
    }),
  );
  const kept = await row();
  assert.equal(
    kept.deck_hash,
    moved.deck_hash,
    "an older payload never regresses the deck",
  );
});
