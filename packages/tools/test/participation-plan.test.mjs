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
        clan_tag text, type text, side int,
        primary key (battle_id, player_tag));
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
        (100003, null, ''), (100005, 'defender', ''),
        (100006, 'attacker', ''), (100007, 'defender', ''),
        (100008, 'defender', ''), (100009, 'defender', '');
      insert into battle_participant
        select id, 'member-0', '2026-09-15'::timestamptz, clan, type, side
        from (values
          (100001, '#CLAN', 'boatBattle', 0),
          (100005, '#CLAN', 'boatBattle', 1),
          (100002, '#CLAN', 'boatBattle', 0),
          (100006, '#CLAN', 'boatBattle', 1),
          (100003, '#CLAN', 'boatBattle', 0),
          (100004, '#CLAN', 'boatBattle', 0),
          (100007, '#CLAN', 'boatBattle', null),
          (100008, '#CLAN', null, 0),
          (100009, '#OTHER', 'boatBattle', 1)
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
        /and not \(bp\.type = 'boatBattle'[\s\S]*?(?=\n             group by)/,
        `and ${notBoatDefense()}`,
      );
      assert.notEqual(
        legacy,
        q.text,
        "reference uses the original EXISTS predicate",
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

test("weekly participation keeps the wide participant scan index-only and side lookups boat-bounded", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  try {
    await db.query(`create temporary table battle (
      battle_id bigint primary key, boat_battle_side text);
      create temporary table battle_participant (
        battle_id bigint, player_tag text, battle_time timestamptz,
        clan_tag text, type text, type_class text, side int not null,
        deck_hash text, outcome text, padding text,
        primary key (battle_id, player_tag));
      create index participation_player_time_cover
        on battle_participant(player_tag, battle_time desc)
        include(battle_id, clan_tag, deck_hash, outcome, type, type_class);
      insert into battle select i,
        case when i % 997 = 0 then 'defender'
             when i % 991 = 0 then 'attacker' end
        from generate_series(1, 100000) i;
      insert into battle_participant
        select i, 'member-' || (i % 400), '2026-09-15'::timestamptz,
          '#CLAN', case when i % 997 = 0 or i % 991 = 0 then 'boatBattle'
                        when i % 983 = 0 then null else 'ranked' end,
          null, i % 2, null, 'win', repeat('x', 1000)
        from generate_series(1, 100000) i;`);
    await db.query("vacuum analyze battle");
    await db.query("vacuum analyze battle_participant");
    const queries = participationQueries({
      clanTag: "#CLAN",
      tags: Array.from({ length: 50 }, (_, i) => `member-${i}`),
      formerTags: ["member-0"],
      from: "2026-09-01T00:00:00Z",
      rankedTypes: ["ranked"],
    });
    const plan = async (sql, values) => {
      const r = await db.query(
        `explain (analyze, buffers, format json) ${sql}`,
        values,
      );
      const nodes = [];
      const walk = (node) => {
        nodes.push(node);
        for (const child of node.Plans ?? []) walk(child);
      };
      walk(r.rows[0]["QUERY PLAN"][0].Plan);
      return nodes;
    };
    for (const name of ["battles_by_week", "former_battles_by_week"]) {
      const q = queries.find((item) => item.name === name);
      // The prior scalar battle lookup referenced side on every outer
      // participant, forcing its heap. Keep that as the regression control.
      const before = q.text.replace(
        /\(select own\.side from battle_participant own[\s\S]*?\)/,
        "bp.side",
      );
      assert.notEqual(before, q.text);
      const sorted = (rows) =>
        rows.sort((a, b) => a.player_tag.localeCompare(b.player_tag));
      assert.deepEqual(
        sorted((await db.query(q.text, q.values)).rows),
        sorted((await db.query(before, q.values)).rows),
        name,
      );
      const nodes = await plan(q.text, q.values);
      const cover = nodes.find(
        (node) => node["Index Name"] === "participation_player_time_cover",
      );
      assert.equal(cover?.["Node Type"], "Index Only Scan", name);
      assert.equal(cover["Heap Fetches"], 0, name);
      const side = nodes.find(
        (node) => node["Index Name"] === "battle_participant_pkey",
      );
      assert.ok(side && side["Actual Loops"] <= 31, name);
      const battle = nodes.find((node) => node["Relation Name"] === "battle");
      assert.equal(battle?.["Index Name"], "battle_pkey", name);
      assert.ok(battle["Actual Loops"] <= 31, name);
      if (name === "battles_by_week") {
        const oldNodes = await plan(before, q.values);
        assert.ok(
          oldNodes.some(
            (node) =>
              node["Relation Name"] === "battle_participant" &&
              node["Node Type"] === "Bitmap Heap Scan",
          ),
          "control reproduces the uncovered-side participant heap scan",
        );
      }
    }
  } finally {
    await db.end();
  }
});

// The flat donation statements as they stood before 2026-11-09: the
// reference the per-member reads must equal row for row.
const LEGACY_DONATIONS = {
  donations_by_week: `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                    max(donations)::int as donations, count(*)::int as snapshots
             from player_snapshot_daily
             where player_tag = any($1) and snapshot_kind in ('daily', 'pre_reset')
               and snapshot_date >= $2::date
             group by player_tag, date_trunc('week', snapshot_date::timestamp)`,
  former_donations_by_week: `select player_tag, date_trunc('week', snapshot_date::timestamp) as week_start,
                    max(donations)::int as donations, count(*)::int as snapshots
             from player_snapshot_daily
             where player_tag = any($1) and snapshot_kind in ('daily', 'pre_reset')
               and snapshot_date >= $2::date and clan_tag = $3
             group by player_tag, date_trunc('week', snapshot_date::timestamp)`,
};

test("weekly donations read each member's key range, never the whole table, with the flat statement's rows", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  try {
    // Day rows written day by day for many players, as ingest writes
    // them: one member's weeks are scattered across the table, so the
    // flat statement over a clan costs above a sequential scan (live,
    // 2026-11-09: 8,638 pages read from disk on every call).
    await db.query(`create temporary table player_snapshot_daily (
        player_tag text not null, snapshot_date date not null,
        snapshot_kind text not null, donations int, clan_tag text,
        padding text, primary key (player_tag, snapshot_date, snapshot_kind));
      insert into player_snapshot_daily
        select 'p-' || p, '2026-11-09'::date - d, 'daily',
               case when (p + d) % 11 = 0 then null else (p * 7 + d * 13) % 500 end,
               case when p % 3 = 0 then '#OTHER' else '#CLAN' end, repeat('x', 300)
          from generate_series(0, 90) d, generate_series(1, 2000) p
         order by d desc, p;
      -- The high-water mark near the reset counts; a season roll does not.
      insert into player_snapshot_daily
        select 'p-' || p, '2026-11-02'::date, kind, 999 + p, '#CLAN', ''
          from generate_series(1, 2000, 7) p,
               unnest(array['pre_reset', 'season_roll']) kind;`);
    await db.query("vacuum analyze player_snapshot_daily");
    const tags = Array.from({ length: 300 }, (_, i) => `p-${i * 6 + 1}`);
    // A repeated tag and one with no rows change nothing.
    tags.push("p-1", "p-none");
    const queries = participationQueries({
      clanTag: "#CLAN",
      tags,
      formerTags: tags.slice(0, 40),
      from: "2026-09-21T00:00:00Z",
      rankedTypes: ["ranked"],
    });
    const nodesOf = async (sql, values) => {
      const r = await db.query(`explain (analyze, format json) ${sql}`, values);
      const nodes = [];
      const walk = (node) => {
        nodes.push(node);
        for (const child of node.Plans ?? []) walk(child);
      };
      walk(r.rows[0]["QUERY PLAN"][0].Plan);
      return nodes;
    };
    const key = (r) => `${r.player_tag}|${r.week_start.toISOString()}`;
    const sorted = (rows) => rows.sort((a, b) => key(a).localeCompare(key(b)));
    for (const [name, legacy] of Object.entries(LEGACY_DONATIONS)) {
      const q = queries.find((x) => x.name === name);
      const newRows = sorted((await db.query(q.text, q.values)).rows);
      const oldRows = sorted((await db.query(legacy, q.values)).rows);
      assert.ok(oldRows.length > 100, name);
      assert.deepEqual(newRows, oldRows, name);
      const scans = (nodes) =>
        nodes.filter(
          (n) =>
            n["Relation Name"] === "player_snapshot_daily" &&
            n["Node Type"] === "Seq Scan",
        );
      // The production plan of the flat statement is the control: a Seq
      // Scan whatever the clan (the explain_participation op). The per-
      // member read is one key-range read per distinct tag, whatever
      // the planner thinks of the table.
      const nodes = await nodesOf(q.text, q.values);
      assert.deepEqual(scans(nodes), [], name);
      const reads = nodes.filter(
        (n) => n["Relation Name"] === "player_snapshot_daily",
      );
      assert.equal(reads.length, 1, name);
      assert.equal(reads[0]["Actual Loops"], new Set(q.values[0]).size, name);
    }
  } finally {
    await db.end();
  }
});
