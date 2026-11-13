import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { clanMostQuery } from "../src/activity/entries.mjs";

const DAY_MS = 86_400_000;
const ts = (ms) => `to_timestamp(${Math.floor(ms)} / 1000.0)`;

/** The joined statement clan.most served before 2026-11-13 (#649): the
 *  reference the per-member count must equal, row for row and in order. */
function joinedMost({ tag, fromMs, toMs, basis = "observed" }) {
  const occurred = basis === "occurred";
  return {
    text: `select bp.player_tag, p.name, count(distinct bp.battle_id)::int as battles
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       join player p on p.player_tag = bp.player_tag
      where bp.clan_tag = $1
        and ${
          occurred
            ? `bp.battle_time >= ${ts(fromMs + 1)} and bp.battle_time < ${ts(toMs + 1)}`
            : `bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
        and b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}`
        }
        and b.battle_time >= b.created_at - interval '1 day'
      group by bp.player_tag, p.name
      order by battles desc, p.name nulls last limit $2`,
    values: [tag, 5],
  };
}

test("clan.most names the window's members by key, never the whole player table, with the joined statement's rows", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  try {
    // Many recorded players beside one clan's few. In production the
    // joined statement hashed every player row to name a handful (a
    // parallel seq scan of 37,817 rows, explain 2026-11-13, note
    // 2026-11-13-battle-timeline-cover); a scratch planner with memoize
    // picks the key here, so the pin is the shape: the name lookup is a
    // lateral the planner cannot turn into a hash of the table.
    await db.query(`create temporary table player (
        player_tag text primary key, name text, padding text);
      create temporary table battle (
        battle_id bigint primary key, battle_time timestamptz not null,
        created_at timestamptz not null);
      create temporary table battle_participant (
        battle_id bigint, player_tag text, clan_tag text,
        battle_time timestamptz, primary key (battle_id, player_tag));
      create index battle_participant_clan_time
        on battle_participant (clan_tag, battle_time desc);
      insert into player
        select 'p-' || i, case when i = 27 then null else 'name ' || i end,
               repeat('x', 400)
          from generate_series(1, 60000) i;
      -- Ten members' week: ties on battles broken by name (names are
      -- distinct, so the order is defined), a null name, and one battle
      -- learned long after it was played (not counted).
      insert into battle
        select i, '2026-11-05'::timestamptz + i * interval '7 minutes',
               '2026-11-05'::timestamptz + i * interval '7 minutes'
                 + case when i = 3 then interval '3 days' else interval '5 minutes' end
          from generate_series(1, 400) i;
      insert into battle_participant
        select i, 'p-' || (9 * (1 + i % 10)), '#CLAN', b.battle_time
          from generate_series(1, 400) i join battle b on b.battle_id = i
         where i % 10 < 7 or i % 3 = 0;
      insert into battle_participant
        select i, 'p-' || (40000 + i % 50), '#OTHER', b.battle_time
          from generate_series(1, 400) i join battle b on b.battle_id = i;`);
    await db.query("vacuum analyze player");
    await db.query("vacuum analyze battle");
    await db.query("vacuum analyze battle_participant");
    const fromMs = Date.parse("2026-11-06T00:00:00Z");
    const toMs = Date.parse("2026-11-07T00:00:00Z");
    for (const basis of ["observed", "occurred"]) {
      const args = { tag: "#CLAN", fromMs, toMs, basis };
      const q = clanMostQuery(args);
      const rows = (await db.query(q)).rows;
      assert.ok(rows.length === 5, basis);
      assert.deepEqual(rows, (await db.query(joinedMost(args))).rows, basis);
      const r = await db.query(
        `explain (analyze, format json) ${q.text}`,
        q.values,
      );
      const nodes = [];
      const walk = (n) => {
        nodes.push(n);
        for (const c of n.Plans ?? []) walk(c);
      };
      walk(r.rows[0]["QUERY PLAN"][0].Plan);
      const names = nodes.filter((n) => n["Relation Name"] === "player");
      assert.equal(names.length, 1, basis);
      assert.notEqual(names[0]["Node Type"], "Seq Scan", basis);
      assert.equal(names[0]["Index Name"], "player_pkey", basis);
      // One name per counted member, never a member twice.
      assert.ok(names[0]["Actual Loops"] <= 10, basis);
    }
  } finally {
    await db.end();
  }
});
