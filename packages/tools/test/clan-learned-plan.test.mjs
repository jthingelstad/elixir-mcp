import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { clanLearnedQuery } from "../src/activity/entries.mjs";

/** The joined statement clanLearnedQuery served before 2026-11-09, the
 *  reference the per-battle probe must count equal to. */
function joinedLearned({ tag, fromMs, toMs }) {
  const ts = (ms) => `to_timestamp(${Math.floor(ms)} / 1000.0)`;
  return {
    text: `select count(distinct b.battle_id) filter (where b.battle_time >= b.created_at - interval '1 day')::int as recent,
                  count(distinct b.battle_id) filter (where b.battle_time < b.created_at - interval '1 day')::int as late
             from battle b
             join battle_participant bp on bp.battle_id = b.battle_id
            where b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}
              and bp.clan_tag = $1`,
    values: [tag],
  };
}

const planNodes = async (db, q) => {
  const r = await db.query(
    `explain (analyze, buffers, format json) ${q.text}`,
    q.values,
  );
  const nodes = [];
  const walk = (n) => {
    nodes.push(n);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(r.rows[0]["QUERY PLAN"][0].Plan);
  return nodes;
};

test("clan.learned: the two counts count what the join counted, without scanning the clan's history or probing every window battle", async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  try {
    // Session-local tables shaped like production's: a big clan's long
    // history dwarfs the window's battles, which is what made the joined
    // statement hash the window and scan battle_participant whole.
    await db.query(`create temporary table battle (
        battle_id text primary key, battle_time timestamptz not null,
        created_at timestamptz not null, boat_battle_side text);
      create index battle_created_at on battle (created_at);
      create temporary table battle_participant (
        battle_id text, player_tag text, clan_tag text,
        battle_time timestamptz, side int, padding text,
        primary key (battle_id, player_tag));
      create index battle_participant_clan_time
        on battle_participant (clan_tag, battle_time desc);
      -- Old history: 60,000 battles of #BIG, learned long before the window.
      insert into battle
        select 'h' || i, '2026-06-01'::timestamptz + i * interval '1 minute',
               '2026-06-01'::timestamptz + i * interval '1 minute' + interval '5 minutes', null
          from generate_series(1, 60000) i;
      insert into battle_participant
        select 'h' || i, 'm' || (i % 50), '#BIG',
               '2026-06-01'::timestamptz + i * interval '1 minute', 0, repeat('x', 300)
          from generate_series(1, 60000) i;
      -- The window (2026-11-03 to 2026-11-10), learned in it:
      insert into battle values
        -- recent, one member
        ('w1', '2026-11-04 10:00Z', '2026-11-04 10:05Z', null),
        -- recent, two members of the clan in one battle (one battle)
        ('w2', '2026-11-05 10:00Z', '2026-11-05 10:05Z', null),
        -- a late capture, played weeks before it was learned
        ('w3', '2026-10-01 10:00Z', '2026-11-06 10:00Z', null),
        -- another clan's battle in the window
        ('w4', '2026-11-06 11:00Z', '2026-11-06 11:05Z', null),
        -- learned exactly at the window's start (outside: from is exclusive)
        ('w5', '2026-11-03 00:00Z', '2026-11-03 00:00Z', null),
        -- learned exactly at the window's end (inside: to is inclusive)
        ('w6', '2026-11-09 23:59Z', '2026-11-10 00:00Z', null),
        -- a member who played for another clan then
        ('w7', '2026-11-07 10:00Z', '2026-11-07 10:05Z', null),
        -- played in the window, learned after it
        ('w8', '2026-11-09 12:00Z', '2026-11-11 00:00Z', null),
        -- exactly one day late: still recent
        ('w9', '2026-11-04 12:00Z', '2026-11-05 12:00Z', null);
      insert into battle_participant values
        ('w1', 'm1', '#BIG', '2026-11-04 10:00Z', 0, ''),
        ('w1', 'x1', '#FOE', '2026-11-04 10:00Z', 1, ''),
        ('w2', 'm1', '#BIG', '2026-11-05 10:00Z', 0, ''),
        ('w2', 'm2', '#BIG', '2026-11-05 10:00Z', 0, ''),
        ('w3', 'm3', '#BIG', '2026-10-01 10:00Z', 0, ''),
        ('w4', 'x2', '#FOE', '2026-11-06 11:00Z', 0, ''),
        ('w5', 'm1', '#BIG', '2026-11-03 00:00Z', 0, ''),
        ('w6', 'm4', '#BIG', '2026-11-09 23:59Z', 0, ''),
        ('w7', 'm5', '#FOE', '2026-11-07 10:00Z', 0, ''),
        ('w8', 'm1', '#BIG', '2026-11-09 12:00Z', 0, ''),
        ('w9', 'm2', '#BIG', '2026-11-04 12:00Z', 0, '');
      -- Many other battles learned in the window, none the clan's.
      insert into battle
        select 'o' || i, '2026-11-05'::timestamptz + i * interval '10 seconds',
               '2026-11-05'::timestamptz + i * interval '10 seconds' + interval '1 minute', null
          from generate_series(1, 3000) i;
      insert into battle_participant
        select 'o' || i, 'p' || i, '#ELSE',
               '2026-11-05'::timestamptz + i * interval '10 seconds', 0, ''
          from generate_series(1, 3000) i;`);
    await db.query("vacuum analyze battle");
    await db.query("vacuum analyze battle_participant");
    const fromMs = Date.parse("2026-11-03T00:00:00Z");
    const toMs = Date.parse("2026-11-10T00:00:00Z");
    const windows = [
      [fromMs, toMs],
      [fromMs, fromMs + 86_400_000],
      [Date.parse("2026-11-09T23:00:00Z"), toMs],
      [Date.parse("2026-06-01T00:00:00Z"), toMs],
      [Date.parse("2026-12-01T00:00:00Z"), Date.parse("2026-12-08T00:00:00Z")],
    ];
    for (const [f, t] of windows)
      for (const tag of ["#BIG", "#FOE", "#ELSE", "#NONE"]) {
        const args = { tag, fromMs: f, toMs: t };
        const now = (await db.query(clanLearnedQuery(args))).rows[0];
        const before = (await db.query(joinedLearned(args))).rows[0];
        assert.deepEqual(now, before, `${tag} ${f}..${t}`);
      }
    assert.deepEqual(
      (await db.query(clanLearnedQuery({ tag: "#BIG", fromMs, toMs }))).rows[0],
      { recent: 4, late: 1 },
      "w1, w2 once, w6, w9 recent; w3 late; w5 and w8 outside",
    );
    // The plan: the narrated count off the clan's own range, and the late
    // count probing participants (primary key) only for a late capture;
    // never a probe per battle the window learned, and never a scan of
    // battle_participant.
    const q = clanLearnedQuery({ tag: "#BIG", fromMs, toMs });
    const nodes = await planNodes(db, q);
    const bp = nodes.filter((n) => n["Relation Name"] === "battle_participant");
    assert.ok(
      nodes.some((n) => n["Index Name"] === "battle_participant_clan_time"),
      "the narrated count reads the clan's range",
    );
    const battleReads = nodes.filter((n) => n["Relation Name"] === "battle");
    assert.ok(
      battleReads.some((n) => n["Index Name"] === "battle_pkey"),
      "each of the clan's rows asks its own battle",
    );
    assert.ok(
      !nodes.some((n) => n["Node Type"] === "Hash"),
      "the window's battles are never hashed",
    );
    const probes = bp.filter(
      (n) => n["Index Name"] === "battle_participant_pkey",
    );
    assert.equal(probes.length, 1);
    assert.ok(probes[0]["Actual Loops"] <= 1, probes[0]["Actual Loops"]);
    assert.ok(
      !nodes.some((n) => n["Node Type"].includes("Seq Scan")),
      "no sequential scan",
    );
    // late: false (a read that serves no activity, #649): the same narrated
    // count, no late count, and nothing walks the window's battles.
    for (const [f, t] of windows)
      for (const tag of ["#BIG", "#FOE", "#ELSE", "#NONE"]) {
        const args = { tag, fromMs: f, toMs: t };
        const full = (await db.query(clanLearnedQuery(args))).rows[0];
        const lean = (
          await db.query(clanLearnedQuery({ ...args, late: false }))
        ).rows[0];
        assert.deepEqual(lean, { recent: full.recent, late: null });
      }
    const lean = await planNodes(
      db,
      clanLearnedQuery({ tag: "#BIG", fromMs, toMs, late: false }),
    );
    assert.ok(
      !lean.some(
        (n) =>
          n["Index Name"] === "battle_participant_pkey" ||
          n["Index Name"] === "battle_created_at",
      ),
      "no walk of the window's battles",
    );
    // The occurred basis keeps the clan's own range.
    const occurred = await planNodes(
      db,
      clanLearnedQuery({ tag: "#BIG", fromMs, toMs, basis: "occurred" }),
    );
    assert.ok(
      occurred.some((n) => n["Index Name"] === "battle_participant_clan_time"),
    );
  } finally {
    await db.end();
  }
});
