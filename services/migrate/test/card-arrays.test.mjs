// 0255: cards as arrays on the rows that own them. Ingest dual-writes,
// {card_arrays} fills history, {card_arrays_census} proves the arrays
// equal the rows. Real fixtures (anonymized) carry duels, tower troops
// and cards with and without star levels.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { cardArrays, cardArraysCensus } from "../src/ops-card-arrays.mjs";
import { ingestBattlelog } from "../../../packages/ingest/src/battles.mjs";
import { fillParticipantArrays } from "../../../packages/ingest/src/card-arrays.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const MIGRATIONS_DIR = path.join(repoRoot, "db/migrations");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_card_arrays_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

const FIXTURES = [
  "player_battlelog/with_boat_and_duel.json",
  "player_battlelog/with_colosseum_duel.json",
  "player_battlelog/with_path_of_legend.json",
  "player_battlelog/with_clanmate_2v2.json",
];

let db;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({ databaseUrl: SCRATCH_URL, migrationsDir: MIGRATIONS_DIR });
  const meta = JSON.parse(
    await readFile(path.join(repoRoot, "fixtures/meta.json"), "utf8"),
  );
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  for (const name of FIXTURES)
    await ingestBattlelog(db, {
      observerTag: meta[name].entity_key,
      payload: JSON.parse(
        await readFile(path.join(repoRoot, "fixtures", name), "utf8"),
      ),
    });
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

/** Run the census to the end, page by page, as an operator would. */
async function censusToEnd(spec = {}) {
  let out = await cardArraysCensus(SCRATCH_URL, spec);
  let calls = 1;
  while (!out.done) {
    out = await cardArraysCensus(SCRATCH_URL, {
      ...out.next.card_arrays_census,
      max_batches: spec.max_batches,
    });
    calls += 1;
  }
  return { ...out, calls };
}

async function fillToEnd(spec = {}) {
  let out = await cardArrays(SCRATCH_URL, spec);
  const calls = [out];
  while (!out.done) {
    out = await cardArrays(SCRATCH_URL, {
      ...out.next.card_arrays,
      max_batches: spec.max_batches,
    });
    calls.push(out);
  }
  return calls;
}

const clearArrays = () =>
  db.query(`
    update battle_participant set cards = null, card_forms = null, card_levels = null,
      card_stars = null, tower_troop_id = null, tower_form = null, tower_level = null,
      tower_star = null;
    update battle_participant_round set cards = null, card_forms = null,
      card_levels = null, card_stars = null, cards_used = null;
    update deck set card_ids = null, card_forms = null;`);

test("ingest dual-writes: every array equals its card rows, and the census passes", async () => {
  const census = await censusToEnd();
  assert.equal(census.pass, true, JSON.stringify(census.failures));
  const { participants, rounds, decks } = census.counts;
  assert.ok(participants.rows > 1000, "fixtures hold real decks");
  assert.equal(participants.matched, participants.rows);
  assert.ok(rounds.rows > 0, "the fixtures hold duels");
  assert.equal(rounds.matched, rounds.rows);
  assert.ok(decks.rows > 0);
  assert.equal(decks.elements, decks.rows);

  // The same claim written out without the census: round-0 cards in slot
  // order are the array, and slot 0 is the tower column.
  const {
    rows: [p],
  } = await db.query(`
    select count(*)::int as participants,
           count(*) filter (where bp.cards is distinct from
             (select array_agg(c.card_id order by c.slot) from battle_participant_card c
               where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                 and c.round = 0 and c.slot > 0))::int as cards_differ,
           count(*) filter (where bp.card_stars is distinct from
             (select array_agg(c.star_level order by c.slot) from battle_participant_card c
               where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                 and c.round = 0 and c.slot > 0))::int as stars_differ,
           count(*) filter (where bp.tower_troop_id is distinct from
             (select c.card_id from battle_participant_card c
               where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                 and c.round = 0 and c.slot = 0))::int as tower_differs,
           count(*) filter (where bp.tower_troop_id is not null)::int as with_tower,
           count(*) filter (where array_position(bp.card_stars, null) is not null
                              and array_position(bp.cards, null) is null)::int as null_stars
    from battle_participant bp
    where exists (select 1 from battle_participant_card c
                   where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag and c.round = 0)`);
  assert.equal(p.cards_differ, 0);
  assert.equal(p.stars_differ, 0);
  assert.equal(p.tower_differs, 0);
  assert.ok(p.with_tower > 0, "decks with a tower troop");
  assert.ok(p.null_stars > 0, "cards with no star level are NULL elements");
});

test("a duel: the participant row has no round-0 cards; each round carries its deck and what was used", async () => {
  const {
    rows: [d],
  } = await db.query(`
    select count(distinct (r.battle_id, r.player_tag))::int as duelists,
           count(*)::int as rounds,
           count(*) filter (where r.cards is null)::int as rounds_unfilled,
           count(*) filter (where cardinality(r.cards) = 8 and cardinality(r.cards_used) = 8)::int as eight,
           count(*) filter (where true = any(r.cards_used))::int as with_used,
           count(*) filter (where bp.cards is not null)::int as bp_filled
    from battle_participant_round r
    join battle_participant bp using (battle_id, player_tag)`);
  assert.ok(d.duelists > 0 && d.rounds >= 2 * d.duelists);
  assert.equal(d.rounds_unfilled, 0);
  assert.equal(d.eight, d.rounds);
  assert.ok(d.with_used > 0);
  assert.equal(d.bp_filled, 0, "a duel's decks are its rounds'");
});

test("a deck: canonical (card_id, form) order, the tower troop not among its cards", async () => {
  const {
    rows: [d],
  } = await db.query(`
    select count(*)::int as decks,
           count(*) filter (where card_ids is null)::int as unfilled,
           count(*) filter (where cardinality(card_ids) <> card_count)::int as count_differs,
           count(*) filter (where tower_troop_id = any(card_ids))::int as tower_in_cards,
           count(*) filter (where tower_troop_id is not null)::int as with_tower,
           count(*) filter (where card_ids is distinct from
             (select array_agg(x order by x) from unnest(card_ids) x))::int as unsorted
    from deck`);
  assert.ok(d.decks > 0);
  assert.equal(d.unfilled, 0);
  assert.equal(d.count_differs, 0);
  assert.equal(d.tower_in_cards, 0);
  assert.ok(d.with_tower > 0);
  assert.equal(d.unsorted, 0);
});

test("{card_arrays} fills history: resumable across calls, idempotent, and the census passes after", async () => {
  await clearArrays();
  const before = await censusToEnd();
  assert.equal(before.pass, false);
  assert.ok(before.counts.participants.null_where_rows_exist > 0);
  assert.ok(before.counts.rounds.null_where_rows_exist > 0);
  assert.ok(before.counts.decks.null_where_rows_exist > 0);

  const calls = await fillToEnd({ batch: 17, max_batches: 3 });
  assert.ok(calls.length > 3, "the work spans several calls");
  for (const c of calls.slice(0, -1)) {
    assert.equal(c.done, false);
    assert.ok(c.next.card_arrays.after, "each call hands back its cursor");
    assert.ok(c.remaining > 0);
  }
  const last = calls.at(-1);
  assert.equal(last.done, true);
  assert.equal(last.next, null);
  const filled = calls.reduce((s, c) => s + c.filled, 0);
  const {
    rows: [n],
  } = await db.query(`
    select (select count(*) from battle_participant where cards is not null)
         + (select count(*) from battle_participant_round where cards is not null)
         + (select count(*) from deck where card_ids is not null) as n`);
  assert.equal(filled, Number(n.n));

  const after = await censusToEnd({ batch: 23, max_batches: 2 });
  assert.equal(after.pass, true, JSON.stringify(after.failures));
  assert.ok(after.calls > 2, "the census pages too");

  // Again: only rows that stay null for good (a duel's participant row)
  // are visited, and nothing is written.
  const again = await fillToEnd({});
  assert.equal(
    again.reduce((s, c) => s + c.filled, 0),
    0,
  );
});

test("the census reports tampering: a level, a used flag, a deck form, a cleared row, a stray row", async () => {
  const clean = await censusToEnd();
  assert.equal(clean.pass, true);

  await db.query("begin");
  try {
    await db.query(`
      update battle_participant set card_levels[2] = card_levels[2] + 1
       where (battle_id, player_tag) = (select battle_id, player_tag from battle_participant
                                         where cardinality(cards) = 8 order by 1, 2 limit 1)`);
    await db.query(`
      update battle_participant_round set cards_used[1] = not coalesce(cards_used[1], false)
       where (battle_id, player_tag, round) = (select battle_id, player_tag, round
                                                from battle_participant_round order by 1, 2, 3 limit 1)`);
    await db.query(`
      update deck set card_forms[1] = card_forms[1] + 1
       where deck_hash = (select deck_hash from deck where card_ids is not null order by 1 limit 1)`);
    await db.query(`
      update battle_participant set cards = null, card_forms = null, card_levels = null,
             card_stars = null, tower_troop_id = null, tower_form = null,
             tower_level = null, tower_star = null
       where (battle_id, player_tag) = (select battle_id, player_tag from battle_participant
                                         where cardinality(cards) = 8 order by 1 desc, 2 desc limit 1)`);
    // A row the arrays cannot place: a second card in a filled slot.
    await db.query(
      `insert into card (card_id, name, kind, first_seen_at, observed_at)
       values (26999999, 'card 26999999', 'card', now(), now()) on conflict do nothing`,
    );
    await db.query(`
      insert into battle_participant_card (battle_id, player_tag, round, card_id, form, slot)
      select battle_id, player_tag, 0, 26999999, 0, 3 from battle_participant
       where cardinality(cards) = 8 order by battle_id, player_tag offset 5 limit 1`);
    // The census reads in its own session: commit, then put it back.
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
  const bad = await censusToEnd();
  assert.equal(bad.pass, false);
  const { participants, rounds, decks } = bad.counts;
  assert.equal(
    participants.mismatched,
    1 + 1,
    "the level and the stray row's slot",
  );
  assert.equal(rounds.mismatched, 1);
  assert.equal(decks.mismatched, 1);
  assert.equal(participants.null_where_rows_exist, 1);
  assert.ok(participants.rows_missing_from_arrays >= 8);
  assert.ok(bad.failures.includes("participants.mismatched"));
  assert.ok(
    bad.failures.includes("participants.rows != participants.elements"),
  );

  // The fill leaves the unplaceable participant alone (two rows in one
  // slot), and the census goes on naming it.
  const {
    rows: [stray],
  } = await db.query(
    `select battle_id, player_tag from battle_participant_card where card_id = 26999999`,
  );
  await db.query(
    `update battle_participant set cards = null where battle_id = $1 and player_tag = $2`,
    [stray.battle_id, stray.player_tag],
  );
  assert.equal(await fillParticipantArrays(db, [stray]), 0);
  await db.query(
    `delete from battle_participant_card where card_id = 26999999`,
  );
  await clearArrays();
  await fillToEnd({});
  const healed = await censusToEnd();
  assert.equal(healed.pass, true, JSON.stringify(healed.failures));
});

test("a slot gap is a NULL element in every array, and stays lossless", async () => {
  const {
    rows: [k],
  } = await db.query(`
    select battle_id, player_tag from battle_participant
     where cardinality(cards) = 8 order by battle_id, player_tag offset 2 limit 1`);
  const {
    rows: [gone],
  } = await db.query(
    `delete from battle_participant_card
      where battle_id = $1 and player_tag = $2 and round = 0 and slot = 3
      returning card_id`,
    [k.battle_id, k.player_tag],
  );
  assert.ok(gone);
  assert.equal(await fillParticipantArrays(db, [k]), 1);
  const {
    rows: [bp],
  } = await db.query(
    `select cards, card_forms, card_levels, card_stars from battle_participant
      where battle_id = $1 and player_tag = $2`,
    [k.battle_id, k.player_tag],
  );
  assert.equal(bp.cards.length, 8);
  assert.equal(bp.cards[2], null);
  assert.equal(bp.card_forms[2], null);
  assert.equal(bp.card_levels[2], null);
  assert.equal(bp.card_stars[2], null);
  const census = await censusToEnd();
  assert.equal(census.pass, true, JSON.stringify(census.failures));
});

test("refusals: an unknown phase or a malformed cursor runs nothing", async () => {
  await assert.rejects(
    cardArrays(SCRATCH_URL, { phase: "cards" }),
    /phase: one of/,
  );
  await assert.rejects(
    cardArraysCensus(SCRATCH_URL, {
      phase: "rounds",
      after: { battle_id: "x" },
    }),
    /missing player_tag/,
  );
  await assert.rejects(
    cardArrays(SCRATCH_URL, { after: "x" }),
    /after: the cursor/,
  );
});
