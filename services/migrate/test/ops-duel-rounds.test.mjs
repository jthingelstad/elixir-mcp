/**
 * {duel_round_decks} over a scratch database: duels recorded before 0182
 * (their round rows without deck_hash or outcome, their round decks not
 * yet deck rows) are filled to exactly what ingest now writes, a batch
 * at a time from a cursor, and a rerun writes nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestBattlelog } from "../../ingest/src/battles.mjs";
import {
  fixture,
  fixtureMeta,
  scratchDb,
  seedReceipt,
} from "../../ingest/test/helpers.mjs";
import { duelRoundDecks } from "../src/ops-duel-rounds.mjs";

let ctx;
let written;

const rounds = async () =>
  (
    await ctx.db.query(
      `select battle_id, player_tag, round, deck_hash, outcome
         from battle_participant_round order by battle_id, player_tag, round`,
    )
  ).rows;

before(async () => {
  ctx = await scratchDb("duel_rounds");
  const receiptId = await seedReceipt(ctx.db);
  const meta = await fixtureMeta();
  for (const rel of [
    "player_battlelog/with_boat_and_duel.json",
    "player_battlelog/with_colosseum_duel.json",
  ])
    await ingestBattlelog(ctx.db, {
      observerTag: meta[rel].entity_key,
      receiptId,
      payload: await fixture(rel),
    });
  written = await rounds();
  // Back to the shape a duel recorded before 0182 has.
  const hashes = [...new Set(written.map((r) => r.deck_hash).filter(Boolean))];
  await ctx.db.query(
    `update battle_participant_round set deck_hash = null, outcome = null`,
  );
  await ctx.db.query(
    `delete from deck_card where deck_hash = any($1)
        and not exists (select 1 from battle_participant bp
                         where bp.deck_hash = deck_card.deck_hash)`,
    [hashes],
  );
  await ctx.db.query(
    `delete from deck d where d.deck_hash = any($1)
        and not exists (select 1 from battle_participant bp
                         where bp.deck_hash = d.deck_hash)`,
    [hashes],
  );
});

after(async () => ctx?.drop());

test("the op fills each round to what ingest writes, from a cursor, and a rerun writes nothing", async () => {
  assert.ok(written.length >= 4, "the fixtures carry duels");
  assert.ok(
    written.some((r) => r.deck_hash) && written.some((r) => r.outcome),
    "ingest stamped the rounds",
  );

  // One small batch, then the rest from where it stopped.
  const first = await duelRoundDecks(ctx.url, { batch: 2, max_batches: 1 });
  assert.equal(first.batches, 1);
  assert.equal(first.done, false);
  assert.equal(first.after.length, 3);
  assert.ok(first.remaining > 0);
  const rest = await duelRoundDecks(ctx.url, { after: first.after, batch: 2 });
  assert.equal(rest.done, true);
  assert.equal(rest.remaining, 0);

  assert.deepEqual(await rounds(), written, "exactly what ingest writes");
  const hashes = [...new Set(written.map((r) => r.deck_hash).filter(Boolean))];
  const { rows: decks } = await ctx.db.query(
    `select d.tower_troop_id, d.card_count, count(dc.card_id)::int as cards,
            d.archetype_version is not null as named
       from deck d join deck_card dc on dc.deck_hash = d.deck_hash
      where d.deck_hash = any($1)
      group by d.deck_hash`,
    [hashes],
  );
  assert.equal(decks.length, hashes.length, "every round deck is a deck row");
  for (const d of decks) {
    assert.equal(d.tower_troop_id, null);
    assert.equal(d.card_count, 8);
    assert.equal(d.cards, 8);
    assert.ok(d.named, "named the moment it exists");
  }

  // Nothing left: a rerun from the start reads only what cannot be filled
  // and writes nothing.
  const again = await duelRoundDecks(ctx.url, {});
  assert.equal(again.decks_filled, 0);
  assert.equal(again.outcomes_filled, 0);
  assert.equal(again.done, true);
  assert.deepEqual(again.still_null, rest.still_null);
});
