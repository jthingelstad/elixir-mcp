import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { prefetchStatements } from "../src/activity/entries.mjs";

/**
 * Home's batched player reads (prefetchPlayers, G1 2026-11-12) run each
 * player's own statement once per tag. The first batch put every tag in
 * one `player_tag = any(...)` join, which production planned over
 * everyone's week and ran past its 120 s statement timeout for an account
 * of 52 players. This pins the per-tag form: one probe of the player's
 * own index per tag, never a scan or a hash of battle_participant, and
 * rows equal to what each player's statement returns alone.
 *
 * An observed window's late count is the exception (2026-11-13): per tag
 * it read the whole week's battles by created_at once for every player,
 * so it reads the week's late captures once and counts them by player.
 * Its counts must be the ones the per-player statement gave.
 */
const planNodes = async (db, text, values) => {
  const r = await db.query(
    `explain (analyze, buffers, format json) ${text}`,
    values,
  );
  const nodes = [];
  const walk = (n) => {
    nodes.push(n);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(r.rows[0]["QUERY PLAN"][0].Plan);
  return nodes;
};

test("prefetchStatements: each tag reads its own index, once, and gets its own rows", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  try {
    // Session-local tables shaped like production's: many players' weeks
    // around the few the batch asks for.
    await db.query(`create temporary table battle (
        battle_id text primary key, type text, event_tag text,
        game_mode_name text, battle_time timestamptz not null,
        created_at timestamptz not null, boat_battle_side text);
      create index battle_created_at on battle (created_at);
      create temporary table battle_participant (
        battle_id text, player_tag text, side int, outcome text,
        crowns int, trophy_change int, clan_tag text, deck_hash text,
        battle_time timestamptz, padding text,
        primary key (battle_id, player_tag));
      create index battle_participant_player_time_cover
        on battle_participant (player_tag, battle_time desc)
        include (battle_id, clan_tag, deck_hash, outcome);
      create temporary table player_snapshot_daily (
        player_tag text, snapshot_date date, snapshot_kind text default 'daily',
        profile_observed_at timestamptz, trophies int, best_trophies int,
        arena_id int, collection_level int, wins int, battle_count int,
        donations int, pol_league int, pol_trophies int, pol_rank int,
        primary key (player_tag, snapshot_date, snapshot_kind));
      -- 3,000 players, 40 battles each over November's first two weeks;
      -- every battle has an opponent, and every fifth was learned late.
      insert into battle
        select 'b' || i, 'PvP', null, 'Ladder',
               '2026-11-01'::timestamptz + (i % 20160) * interval '1 minute',
               '2026-11-01'::timestamptz + (i % 20160) * interval '1 minute'
                 + case when i % 5 = 0 then interval '3 days' else interval '5 minutes' end,
               null
          from generate_series(1, 120000) i;
      insert into battle_participant
        select 'b' || i, 'p' || (i % 3000), 0, case when i % 2 = 0 then 'win' else 'loss' end,
               i % 4, 30, '#C' || (i % 40), 'd' || (i % 300),
               '2026-11-01'::timestamptz + (i % 20160) * interval '1 minute', repeat('x', 200)
          from generate_series(1, 120000) i;
      insert into battle_participant
        select 'b' || i, 'q' || i, 1, 'loss', i % 3, -30, null, 'e' || (i % 300),
               '2026-11-01'::timestamptz + (i % 20160) * interval '1 minute', repeat('x', 200)
          from generate_series(1, 120000) i;
      insert into player_snapshot_daily
        select 'p' || p, d::date, 'daily', d + interval '6 hours', 7000 + p, 7500, 54,
               60, 1000, 2000, 10, null, null, null
          from generate_series(0, 2999) p,
               generate_series('2026-10-20'::timestamptz, '2026-11-14', interval '1 day') d;`);
    for (const t of ["battle", "battle_participant", "player_snapshot_daily"])
      await db.query(`vacuum analyze ${t}`);

    const tags = Array.from({ length: 52 }, (_, i) => `p${i * 37}`);
    tags.push("p-none"); // a player with no battles in the window
    const fromMs = Date.parse("2026-11-05T00:00:00Z");
    const toMs = Date.parse("2026-11-12T00:00:00Z");

    for (const basis of ["observed", "occurred"]) {
      const q = prefetchStatements({ fromMs, toMs, basis });
      const alone = prefetchStatements({ fromMs, toMs, basis });
      // Rows: the batch is the per-player statements, tag by tag.
      const wide = (await db.query(q.wide, [tags])).rows;
      const late = (await db.query(q.late, [tags])).rows;
      for (const tag of tags) {
        const mine = (await db.query(alone.wide, [[tag]])).rows;
        assert.deepEqual(
          wide.filter((r) => r.batch_tag === tag),
          mine,
          `${basis} ${tag}`,
        );
        assert.deepEqual(
          late.filter((r) => r.batch_tag === tag),
          (await db.query(alone.late, [[tag]])).rows,
        );
      }
      assert.ok(wide.length > 52, `${basis}: the batch found battles`);
      assert.ok(
        late.some((r) => r.n > 0),
        `${basis}: some battles were learned late`,
      );
      assert.equal(late.length, tags.length, "one count per tag, zero too");

      // Plans: the player's own index, probed once per tag; never a scan
      // or a hash of battle_participant (the opponent's crowns come off
      // the primary key).
      // The observed late count against the per-player statement it
      // replaced, as that statement read.
      if (basis === "observed")
        for (const tag of tags) {
          const { rows } = await db.query(
            `select count(*)::int as n
               from battle b
               join battle_participant bp on bp.battle_id = b.battle_id
              where b.created_at >= to_timestamp(${fromMs + 1} / 1000.0)
                and b.created_at < to_timestamp(${toMs + 1} / 1000.0)
                and b.battle_time < b.created_at - interval '1 day'
                and bp.player_tag = $1`,
            [tag],
          );
          assert.equal(
            late.find((r) => r.batch_tag === tag).n,
            rows[0].n,
            `observed late ${tag}`,
          );
        }
      if (basis === "observed") {
        // The week's late captures once, by created_at; each one's
        // players by the primary key.
        const nodes = await planNodes(db, q.late, [tags]);
        for (const n of nodes)
          if (["battle", "battle_participant"].includes(n["Relation Name"]))
            assert.ok(
              !n["Node Type"].includes("Seq Scan"),
              `observed late: a scan of ${n["Relation Name"]}`,
            );
        const week = nodes.filter(
          (n) => n["Index Name"] === "battle_created_at",
        );
        assert.equal(week.length, 1, "observed late: the week read once");
        assert.equal(week[0]["Actual Loops"], 1);
        const sides = nodes.filter(
          (n) => n["Index Name"] === "battle_participant_pkey",
        );
        assert.equal(sides.length, 1, "observed late: sides by key");
      }
      for (const [name, text] of [
        ["wide", q.wide],
        ...(basis === "occurred" ? [["late", q.late]] : []),
      ]) {
        const nodes = await planNodes(db, text, [tags]);
        const own = nodes.filter(
          (n) => n["Index Name"] === "battle_participant_player_time_cover",
        );
        assert.equal(own.length, 1, `${basis} ${name}: one probe node`);
        assert.equal(
          own[0]["Actual Loops"],
          tags.length,
          `${basis} ${name}: one probe per tag`,
        );
        const bp = nodes.filter(
          (n) => n["Relation Name"] === "battle_participant",
        );
        assert.ok(
          !bp.some((n) => n["Node Type"].includes("Seq Scan")),
          `${basis} ${name}: no scan of battle_participant`,
        );
        assert.ok(
          !nodes.some((n) => n["Node Type"] === "Hash"),
          `${basis} ${name}: nothing hashed`,
        );
      }
    }

    // Snapshots: one row per player that has one, off the primary key.
    const q = prefetchStatements({ fromMs, toMs });
    const snaps = (await db.query(q.snapshot(fromMs), [tags])).rows;
    assert.equal(snaps.length, 52);
    for (const s of snaps)
      assert.ok(
        s.observed_at.getTime() <= fromMs &&
          s.observed_at.getTime() > fromMs - 86_400_000,
        "the last profile at or before the window's start",
      );
    const nodes = await planNodes(db, q.snapshot(fromMs), [tags]);
    assert.ok(
      !nodes.some((n) => n["Node Type"].includes("Seq Scan")),
      "no snapshot scan",
    );
  } finally {
    await db.end();
  }
});
