import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { participationQueries } from "../../record/src/participation-sql.mjs";
import { notBoatDefense } from "../../record/src/boat-defense-sql.mjs";

test("weekly participation keeps boat counts and bounds battle lookups", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  try {
    // Session-local tables: unrelated history dwarfs the requested members.
    // The old EXISTS can choose a hashed subplan scanning all of battle.
    await db.query(`create temporary table battle (
      battle_id bigint primary key, boat_battle_side text, padding text);
      create temporary table battle_participant (
        battle_id bigint, player_tag text, battle_time timestamptz,
        clan_tag text, type text, side int);
      create index participation_player_time
        on battle_participant(player_tag, battle_time desc);
      insert into battle
        select i, case when i % 20 = 0 then 'defender' end, repeat('x', 200)
        from generate_series(1, 100000) i;
      insert into battle_participant
        select i, 'member-' || (i % 50), '2026-09-15'::timestamptz,
          '#CLAN', 'ranked', 0 from generate_series(1, 10000) i;
      insert into battle values
        (100001, 'defender', ''), (100002, 'attacker', ''),
        (100003, null, '');
      insert into battle_participant
        select id, 'member-0', '2026-09-15'::timestamptz, clan, type, side
        from (values
          (100001, '#CLAN', 'boatBattle', 0),
          (100001, '#CLAN', 'boatBattle', 1),
          (100002, '#CLAN', 'boatBattle', 0),
          (100002, '#CLAN', 'boatBattle', 1),
          (100003, '#CLAN', 'boatBattle', 0),
          (100004, '#CLAN', 'boatBattle', 0),
          (100001, '#CLAN', 'boatBattle', null),
          (100001, '#CLAN', null, 0),
          (100001, '#OTHER', 'boatBattle', 1)
        ) v(id, clan, type, side);
      analyze battle; analyze battle_participant;`);
    const queries = participationQueries({
      clanTag: "#CLAN",
      tags: Array.from({ length: 50 }, (_, i) => `member-${i}`),
      formerTags: ["member-0"],
      from: "2026-09-01T00:00:00Z",
      rankedTypes: ["ranked"],
    });
    for (const name of ["battles_by_week", "former_battles_by_week"]) {
      const q = queries.find((x) => x.name === name);
      const legacy = q.text.replace(
        notBoatDefense("bp", { lookupByKey: true }),
        notBoatDefense(),
      );
      const oldRows = (await db.query(legacy, q.values)).rows;
      const newRows = (await db.query(q.text, q.values)).rows;
      const sort = (rows) =>
        rows.sort((a, b) => a.player_tag.localeCompare(b.player_tag));
      assert.deepEqual(sort(newRows), sort(oldRows), name);
      const member = newRows.find((r) => r.player_tag === "member-0");
      assert.equal(member.ranked_battles, 200);
      assert.equal(member.battles, name === "battles_by_week" ? 206 : 205);
      const result = await db.query(
        `explain (analyze, buffers, format json) ${q.text}`,
        q.values,
      );
      const nodes = [];
      const walk = (n) => {
        nodes.push(n);
        for (const child of n.Plans ?? []) walk(child);
      };
      walk(result.rows[0]["QUERY PLAN"][0].Plan);
      const lookups = nodes.filter((n) => n["Relation Name"] === "battle");
      assert.equal(lookups.length, 1, name);
      assert.equal(lookups[0]["Index Name"], "battle_pkey", name);
      assert.ok(lookups[0]["Actual Loops"] <= 9, name);
      if (name === "battles_by_week") {
        const before = await db.query(
          `explain (format json) ${legacy}`,
          q.values,
        );
        nodes.length = 0;
        walk(before.rows[0]["QUERY PLAN"][0].Plan);
        assert.ok(
          nodes.some(
            (n) =>
              n["Relation Name"] === "battle" && n["Node Type"] === "Seq Scan",
          ),
          "fixture reproduces the original whole-history boat scan",
        );
      }
    }
  } finally {
    await db.end();
  }
});
