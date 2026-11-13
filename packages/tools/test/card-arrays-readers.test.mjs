/**
 * Every card reader moved from battle_participant_card and deck_card to
 * the arrays on the rows that own them (0255). Each statement a reader
 * runs must return what the one it replaced returned for the same
 * record, so the old statements are kept here as the reference and both
 * run over the same scratch database: real battle logs (anonymized:
 * duels, 2v2, tower troops, cards with and without star levels) through
 * the real ingest, plus three shapes the arrays carry in a special way
 * (a slot with no row, a card with no level, a round 0 with only a tower
 * troop). Row-for-row equality of a reader's statement means equal tool,
 * route and mail output, since the code around each statement did not
 * change.
 *
 * This file goes with the old tables in the contract step.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fixture, fixtureMeta, scratchDb } from "../../ingest/test/helpers.mjs";
import { ingestBattlelog } from "../../ingest/src/battles.mjs";
import { STAMP_SQL } from "../../ingest/src/card-roles.mjs";
import { fillParticipantArrays } from "../../ingest/src/card-arrays.mjs";
// The registry first: the tool modules import each other through it.
import "../src/tools.mjs";
import {
  DECK_IDENTITY_SQL,
  PARTICIPANT_GAMES,
  RENDER_DECKS_SQL,
  gameCardsSql,
  holdsCardsSql,
  playedCardsSql,
} from "../src/tools/shared.mjs";
import { VERSUS_DECK_SQL } from "../src/activity/entries.mjs";
import { DECK_CARD_IDS_SQL } from "../../../services/web-api/src/routes/verify.mjs";

const FIXTURES = [
  "player_battlelog/with_boat_and_duel.json",
  "player_battlelog/with_colosseum_duel.json",
  "player_battlelog/with_path_of_legend.json",
  "player_battlelog/with_clanmate_2v2.json",
];

let scratch;
let db;

before(async () => {
  scratch = await scratchDb("card_arrays_readers");
  db = scratch.db;
  const meta = await fixtureMeta();
  for (const name of FIXTURES)
    await ingestBattlelog(db, {
      observerTag: meta[name].entity_key,
      payload: await fixture(name),
    });
  // Three shapes, cut from a real battle with a new time so each is its
  // own battle: a card the payload sent with no id (an empty slot), a
  // card with no level, and a round 0 with only a tower troop.
  const name = FIXTURES[0];
  const [base] = await fixture(name);
  const shaped = (minute, edit) => {
    const b = structuredClone(base);
    b.battleTime = `20260903T0${minute}0000.000Z`;
    edit(b.team[0], b.opponent[0]);
    return b;
  };
  await ingestBattlelog(db, {
    observerTag: meta[name].entity_key,
    payload: [
      shaped(1, (me, opp) => {
        delete me.cards[2].id;
        delete opp.cards[5].level;
        delete opp.cards[0].starLevel;
      }),
      shaped(2, (me) => {
        me.cards = [];
      }),
    ],
  });
  // Ingest keeps no deck when the cards list is empty, so the round 0
  // with only a tower troop (which history holds) is written as history
  // got it: its card row, then the arrays from it by ingest's own fill.
  const [bare] = await rows(
    `select battle_id, player_tag from battle_participant
      where battle_time = '2026-09-03T02:00:00Z' and deck_hash is null`,
  );
  await db.query(
    `insert into battle_participant_card (battle_id, player_tag, round, card_id, form, slot, level)
     values ($1, $2, 0, 159000000, 0, 0, 15)`,
    [bare.battle_id, bare.player_tag],
  );
  await fillParticipantArrays(db, [bare]);
});

after(async () => {
  await scratch?.drop();
});

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;

test("the record holds every shape the arrays carry specially", async () => {
  const [s] = await rows(`
    select count(*) filter (where array_position(cards, null) is not null)::int as gap,
           count(*) filter (where cards = '{}' and tower_troop_id is not null)::int as tower_only,
           count(*) filter (where array_position(card_levels, null) is not null
                              and array_position(cards, null) is null)::int as no_level,
           (select count(*)::int from battle_participant_round where cards is not null) as rounds,
           count(*) filter (where cards is null and exists (
             select 1 from battle_participant_round r
              where r.battle_id = bp.battle_id and r.player_tag = bp.player_tag))::int as duelists
    from battle_participant bp`);
  assert.ok(s.gap > 0, "a slot with no row");
  assert.ok(s.tower_only > 0, "a round 0 with only a tower troop");
  assert.ok(s.no_level > 0, "a card with no level");
  assert.ok(s.rounds > 0 && s.duelists > 0, "duels");
});

test("renderDecks: the played cards, every participant, as the card rows gave them", async () => {
  const ids = (await rows(`select battle_id from battle`)).map(
    (r) => r.battle_id,
  );
  const OLD = `select pc.battle_id, pc.player_tag, pc.round, pc.slot, pc.card_id, pc.form,
            pc.level, pc.star_level, c.name, c.elixir_cost
     from battle_participant_card pc
     join card c on c.card_id = pc.card_id
     where pc.battle_id = any($1)
     order by pc.battle_id, pc.player_tag, pc.round, pc.slot`;
  const old = await rows(OLD, [ids]);
  assert.ok(old.length > 1000);
  assert.deepEqual(await rows(RENDER_DECKS_SQL, [ids]), old);
  // And the bare helper, every row in the record, tower troops included.
  assert.deepEqual(
    await rows(
      `select * from ${playedCardsSql("true")} pc
        order by battle_id, player_tag, round, slot`,
    ),
    await rows(
      `select battle_id, player_tag, round, slot::int, card_id, form, level, star_level
         from battle_participant_card order by battle_id, player_tag, round, slot`,
    ),
  );
});

test("deckIdentities: every deck's cards in identity order", async () => {
  const hashes = (await rows(`select deck_hash from deck`)).map(
    (r) => r.deck_hash,
  );
  hashes.push("0".repeat(64)); // no such deck
  const OLD = `select d.deck_hash, dc.card_id, dc.form, c.name, c.elixir_cost,
            d.tower_troop_id, t.name as tower_name
     from deck d
     left join deck_card dc on dc.deck_hash = d.deck_hash
     left join card c on c.card_id = dc.card_id
     left join card t on t.card_id = d.tower_troop_id
     where d.deck_hash = any($1)
     order by d.deck_hash, dc.card_id, dc.form`;
  const old = await rows(OLD, [hashes]);
  assert.ok(old.length > 100);
  assert.deepEqual(await rows(DECK_IDENTITY_SQL, [hashes]), old);
});

test("archetype stamps read the same cards, by hash and by version", async () => {
  const hashes = (await rows(`select deck_hash from deck`)).map(
    (r) => r.deck_hash,
  );
  const select = (from) => `select d.deck_hash,
                  jsonb_agg(jsonb_build_object('id', dc.card_id, 'name', c.name, 'form', dc.form, 'elixir_cost', c.elixir_cost) order by dc.card_id) as cards
           from deck d
           ${from}
           join card c on c.card_id = dc.card_id`;
  const OLD_JOIN = "join deck_card dc on dc.deck_hash = d.deck_hash";
  const byHash = await rows(
    `${select(OLD_JOIN)} where d.deck_hash = any($1) group by d.deck_hash order by 1`,
    [hashes],
  );
  assert.ok(byHash.length > 100);
  assert.deepEqual(
    await rows(`select * from (${STAMP_SQL.hashes}) s order by 1`, [hashes]),
    byHash,
  );
  const stale = await rows(
    `${select(OLD_JOIN)} where d.archetype_version is distinct from $1 group by d.deck_hash order by 1`,
    ["no such version"],
  );
  assert.deepEqual(
    await rows(
      `select * from (${STAMP_SQL.stale.replace(/limit \$2\s*$/, "")}) s order by 1`,
      ["no such version"],
    ),
    stale,
  );
});

test("a highlight's two decks read the same cards", async () => {
  const OLD = (hash) => `(select jsonb_build_object(
          'label', case when d.archetype_family <> 'unclassified'
                        then d.archetype_label end,
          'cards', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', dc.card_id, 'form', dc.form, 'name', c.name,
                       'elixir_cost', c.elixir_cost)
                     order by dc.card_id, dc.form), '[]'::jsonb)
                      from deck_card dc join card c on c.card_id = dc.card_id
                     where dc.deck_hash = d.deck_hash))
         from deck d where d.deck_hash = ${hash})`;
  const q = (sql) =>
    rows(
      `select h.deck_hash, ${sql("h.deck_hash")} as v
         from (select deck_hash from deck union all select null) h
        order by 1`,
    );
  const old = await q(OLD);
  assert.ok(old.length > 100);
  assert.deepEqual(await q(VERSUS_DECK_SQL), old);
});

test("Verify reads each battle's deck card ids as the same set", async () => {
  const q = (sql) =>
    rows(
      `select bp.battle_id, bp.player_tag,
              (select array_agg(x order by x) from unnest(${sql}) x) as ids,
              cardinality(${sql}) as n
         from battle_participant bp order by 1, 2`,
    );
  const old = await q(
    `(select array_agg(dc.card_id) from deck_card dc where dc.deck_hash = bp.deck_hash)`,
  );
  assert.deepEqual(await q(DECK_CARD_IDS_SQL), old);
  // And in deck_card's primary-key order, the order its aggregate read.
  assert.deepEqual(
    await rows(
      `select bp.battle_id, bp.player_tag, ${DECK_CARD_IDS_SQL} as ids
         from battle_participant bp order by 1, 2`,
    ),
    await rows(
      `select bp.battle_id, bp.player_tag,
              (select array_agg(dc.card_id order by dc.card_id, dc.form)
                 from deck_card dc where dc.deck_hash = bp.deck_hash) as ids
         from battle_participant bp order by 1, 2`,
    ),
  );
});

test("battles_query's card filters match the same participants", async () => {
  // Every participant against every card id in the record, one id never
  // seen and a tower troop: with_card and against_card.
  const OLD_WITH = `exists (select 1 from battle_participant_card c
                   where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                     and c.slot > 0 and c.card_id = k.id)`;
  const OLD_AGAINST = `exists (select 1 from battle_participant o
                   join battle_participant_card c
                     on c.battle_id = o.battle_id and c.player_tag = o.player_tag
                   where o.battle_id = bp.battle_id and o.side <> bp.side
                     and c.slot > 0 and c.card_id = k.id)`;
  const NEW_AGAINST = `exists (select 1 from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side
                     and ${holdsCardsSql("o", "array[k.id]")})`;
  const q = (clause) =>
    rows(
      `select bp.battle_id, bp.player_tag, k.id, ${clause} as hit
         from battle_participant bp
         cross join (select distinct card_id as id from battle_participant_card
                     union all select 26999999) k
        order by 1, 2, 3`,
    );
  const oldWith = await q(OLD_WITH);
  assert.ok(oldWith.filter((r) => r.hit).length > 1000);
  assert.deepEqual(await q(holdsCardsSql("bp", "array[k.id]")), oldWith);
  assert.deepEqual(await q(NEW_AGAINST), await q(OLD_AGAINST));

  // with_cards: all in ONE deck. Sets from each participant's own rounds,
  // across two rounds of a duel (never one deck), and with a card the
  // participant never played.
  const sets = `with s as (
      select battle_id, player_tag, array_agg(card_id order by slot) filter (where slot between 1 and 3) as ids
        from battle_participant_card where slot > 0 group by battle_id, player_tag, round
      union all
      select a.battle_id, a.player_tag, array[a.card_id, b.card_id]
        from battle_participant_card a join battle_participant_card b
          on b.battle_id = a.battle_id and b.player_tag = a.player_tag
         and a.round = 1 and b.round = 2 and a.slot = 1 and b.slot = 2
       where a.card_id <> b.card_id
      union all
      select battle_id, player_tag, array[card_id, 26999999]
        from battle_participant_card where slot = 1)
    select bp.battle_id, bp.player_tag, s.ids, CLAUSE as hit
      from s join battle_participant bp using (battle_id, player_tag)
     order by 1, 2, 3`;
  const OLD_ALL = `exists (select 1 from battle_participant_card c
                   where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                     and c.slot > 0 and c.card_id = any(s.ids)
                   group by c.round
                  having count(distinct c.card_id) = cardinality(s.ids))`;
  const oldAll = await rows(sets.replace("CLAUSE", OLD_ALL));
  assert.ok(oldAll.some((r) => r.hit) && oldAll.some((r) => !r.hit));
  assert.deepEqual(
    await rows(sets.replace("CLAUSE", holdsCardsSql("bp", "s.ids"))),
    oldAll,
  );
});

test("battles_cards: each game's cards, mine and the opponent's", async () => {
  const opp = `join lateral (select o.player_tag from battle_participant o
                         where o.battle_id = bp.battle_id and o.side <> bp.side
                           and (o.deck_hash is not null or bp.round > 0)
                         order by o.player_tag limit 1) opp on true`;
  const q = (source) =>
    rows(
      `select bp.battle_id, bp.player_tag, bp.round, pc.card_id, pc.form, pc.level
         from ${PARTICIPANT_GAMES} bp ${source}
        order by 1, 2, 3, 4, 5`,
    );
  const oldMine = await q(`join battle_participant_card pc
             on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag
            and pc.round = bp.round and pc.slot > 0`);
  assert.ok(
    oldMine.some((r) => r.round > 0),
    "duel rounds as games",
  );
  assert.deepEqual(
    await q(
      `cross join lateral ${gameCardsSql("bp.battle_id", "bp.player_tag", "bp.round")} pc`,
    ),
    oldMine,
  );
  assert.deepEqual(
    await q(
      `${opp} cross join lateral ${gameCardsSql("bp.battle_id", "opp.player_tag", "bp.round")} pc`,
    ),
    await q(`${opp} join battle_participant_card pc
             on pc.battle_id = bp.battle_id and pc.player_tag = opp.player_tag
            and pc.round = bp.round and pc.slot > 0`),
  );
});

test("the probe's level census averages the same levels", async () => {
  const q = (join) =>
    rows(
      `select bp.battle_id,
              avg(pc.level::numeric) filter (where bp.side = 0) as lvl0,
              avg(pc.level::numeric) filter (where bp.side = 1) as lvl1
         from battle b
         join battle_participant bp on bp.battle_id = b.battle_id
         ${join}
        group by bp.battle_id order by 1`,
    );
  const old = await q(`join battle_participant_card pc
           on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag
          and pc.round = 0 and pc.slot > 0
        where bp.deck_hash is not null`);
  assert.ok(old.length > 100);
  assert.deepEqual(
    await q(`cross join lateral unnest(bp.cards, bp.card_levels) as pc(card_id, level)
        where bp.deck_hash is not null and pc.card_id is not null`),
    old,
  );
});
