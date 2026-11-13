// First calls after a deploy (cold pages), 2026-11-13: clans_participation
// ran 8 to 10 s against the acceptance gate's 8 s, elixir_timeline 6 to
// 11 s. The reads that carried them are pinned here on plan shape and
// buffer counts, never milliseconds:
//
// - the members' last battle IN the clan: with `bp.clan_tag =
//   cm.clan_tag` the planner may serve it from battle_participant_clan_time
//   and aggregate the clan's whole history once per member (about 33,000
//   buffers live). It must read each member's own player/time range.
// - the same in-clan test where a read also names the player: Clan's
//   member drill-down (memberActivityWeeks) and participation's former
//   members' weeks. Each is one index-only range of the member's own
//   player/time cover, never the clan index's window.
// - captureByPlayer's profile intervals: one key range of the snapshot
//   cover per member (0261), index-only, and each interval's battles
//   counted once.
// - the timeline's last profile at or before an instant, per followed
//   player: one probe of player_snapshot_daily_profile_time (0262), never
//   every day row of the player from the heap and a sort.
//
// Session-local tables over the admin connection, as participation-plan
// does: the data is fixed, so the buffer counts are too.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  MEMBERS_SQL,
  FORMER_MEMBERS_SQL,
  participationQueries,
} from "../../record/src/participation-sql.mjs";
import { memberActivityWeeks } from "../../record/src/member-activity.mjs";
import { captureByPlayer } from "../src/coverage.mjs";
import { prefetchStatements } from "../src/activity/entries.mjs";

const connect = async () => {
  const db = new pg.Client({
    connectionString:
      process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres",
  });
  await db.connect();
  return db;
};

const planOf = async (db, sql, values) => {
  const r = await db.query(
    `explain (analyze, buffers, format json) ${sql}`,
    values,
  );
  const top = r.rows[0]["QUERY PLAN"][0].Plan;
  const nodes = [];
  const walk = (n) => {
    nodes.push(n);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(top);
  const buffers =
    top["Shared Hit Blocks"] +
    top["Shared Read Blocks"] +
    top["Local Hit Blocks"] +
    top["Local Read Blocks"];
  return { nodes, buffers };
};

// The statements as they stood before 2026-11-13: the reference rows and
// the plan control.
const LEGACY_IN_CLAN = (sql) =>
  sql.replace(
    /bp\.clan_tag is not distinct from cm\.clan_tag/g,
    "bp.clan_tag = cm.clan_tag",
  );

test("a member's last battle in the clan reads their own range, never the clan's history", async () => {
  const db = await connect();
  try {
    // A clan's year: 50 members, 600 battles each, against opponents who
    // each come from a clan of their own (as live: opponents are from all
    // over the game). That spread of clan tags is what makes the clan
    // index look as cheap as the player's. Two members have no battle in
    // the clan yet (they just joined from #OLD), two left inside the window.
    await db.query(`create temporary table player (player_tag text primary key, name text);
      create temporary table clan_membership (
        clan_tag text, player_tag text, joined_observed_at timestamptz,
        left_observed_at timestamptz, role text,
        primary key (clan_tag, player_tag, joined_observed_at));
      create temporary table battle_participant (
        battle_id text, player_tag text, battle_time timestamptz,
        clan_tag text, side int, padding text,
        primary key (battle_id, player_tag));
      create index participation_player_time_cover
        on battle_participant (player_tag, battle_time desc) include (battle_id, clan_tag);
      create index participation_clan_time
        on battle_participant (clan_tag, battle_time desc) include (battle_id, player_tag);
      insert into player select 'm-' || m, 'Member ' || m from generate_series(1, 52) m;
      insert into clan_membership
        select '#CLAN', 'm-' || m, '2025-11-01'::timestamptz,
               case when m > 50 then '2026-11-10'::timestamptz end, 'member'
          from generate_series(1, 52) m;
      insert into battle_participant
        select 'b' || m || '-' || n, 'm-' || m,
               '2026-11-13'::timestamptz - (n * 14 + m) * interval '10 minutes',
               case when m <= 2 then '#OLD' else '#CLAN' end, 0, repeat('x', 100)
          from generate_series(1, 52) m, generate_series(1, 600) n;
      insert into battle_participant
        select 'b' || m || '-' || n, 'o-' || m || '-' || n,
               '2026-11-13'::timestamptz - (n * 14 + m) * interval '10 minutes',
               'c-' || m || '-' || n, 1, repeat('x', 100)
          from generate_series(1, 52) m, generate_series(1, 600) n;`);
    for (const t of ["player", "clan_membership", "battle_participant"])
      await db.query(`vacuum analyze ${t}`);

    const cases = [
      { name: "members", sql: MEMBERS_SQL, values: ["#CLAN"], rows: 50 },
      {
        name: "former_members",
        sql: FORMER_MEMBERS_SQL,
        values: ["#CLAN", "2026-11-01T00:00:00Z"],
        rows: 2,
      },
    ];
    for (const c of cases) {
      assert.match(c.sql, /is not distinct from/, c.name);
      const legacy = LEGACY_IN_CLAN(c.sql);
      const now = (await db.query(c.sql, c.values)).rows;
      assert.equal(now.length, c.rows, c.name);
      assert.deepEqual(now, (await db.query(legacy, c.values)).rows, c.name);
      // The new members never battled here: null, not their last battle.
      if (c.name === "members") {
        const quiet = now.filter((r) => r.last_battle_in_clan === null);
        assert.deepEqual(
          quiet.map((r) => r.player_tag),
          ["m-1", "m-2"],
        );
      }

      const after = await planOf(db, c.sql, c.values);
      const touches = (index) =>
        after.nodes.filter((n) => n["Index Name"] === index);
      assert.deepEqual(touches("participation_clan_time"), [], c.name);
      assert.ok(
        !after.nodes.some(
          (n) =>
            n["Relation Name"] === "battle_participant" &&
            n["Node Type"] !== "Index Only Scan",
        ),
        `${c.name}: every battle_participant read is index-only`,
      );
      for (const n of touches("participation_player_time_cover")) {
        assert.equal(n["Actual Loops"], c.rows, c.name);
        assert.match(n["Index Cond"], /player_tag = cm\.player_tag/, c.name);
      }

      if (c.name === "members") {
        // The control: the statement before reads the clan's history
        // once per member.
        const before = await planOf(db, legacy, c.values);
        assert.ok(
          before.nodes.some(
            (n) => n["Index Name"] === "participation_clan_time",
          ),
          "fixture reproduces the clan-index plan",
        );
        // Each member's own range, at most 600 index entries, against the
        // clan's 30,000: at least ten times fewer pages.
        assert.ok(
          after.buffers * 10 <= before.buffers,
          `members: ${after.buffers} buffers against ${before.buffers} before`,
        );
        assert.ok(after.buffers <= 1000, `members: ${after.buffers} buffers`);
      }
    }
  } finally {
    await db.end();
  }
});

// The in-clan test as it stood before: `=` on the parameter; and Clan's
// drill-down took the boat predicate's side from the participant row.
const LEGACY_PARAM_IN_CLAN = (sql, param) =>
  sql.replaceAll(
    `bp.clan_tag is not distinct from ${param}::text and ${param}::text is not null`,
    `bp.clan_tag = ${param}`,
  );
const LEGACY_SIDE = (sql) =>
  sql.replace(
    /\(select own\.side from battle_participant own\s+where own\.battle_id = bp\.battle_id and own\.player_tag = bp\.player_tag\)/g,
    "bp.side",
  );

test("a member's weeks in the clan read their own range, never the clan's window", async () => {
  const db = await connect();
  try {
    // A clan's two months: 50 members, 600 battles each, opponents from
    // clans of their own, written in battle order (a member's battles one
    // to a heap page, as live); m-1 and m-2 played for #OLD, every tenth
    // of m-3's battles was played clanless, and a few are boat battles.
    await db.query(`create temporary table battle (
        battle_id text primary key, boat_battle_side text, padding text);
      create temporary table battle_participant (
        battle_id text, player_tag text, battle_time timestamptz,
        clan_tag text, type text, side int, padding text,
        primary key (battle_id, player_tag));
      create index battle_participant_player_time_cover
        on battle_participant (player_tag, battle_time desc)
        include (battle_id, clan_tag, type);
      create index battle_participant_clan_time
        on battle_participant (clan_tag, battle_time desc)
        include (battle_id, player_tag);
      create temporary table player_snapshot_daily (
        player_tag text, snapshot_date date, snapshot_kind text,
        clan_tag text, donations int, observed_at timestamptz,
        primary key (player_tag, snapshot_date, snapshot_kind));
      insert into battle
        select 'b' || m || '-' || n,
               case when n % 50 = 0 then 'defender' when n % 50 = 25 then 'attacker' end,
               repeat('x', 100)
          from generate_series(1, 52) m, generate_series(1, 600) n;
      insert into battle_participant
        select * from (
          select 'b' || m || '-' || n, 'm-' || m,
                 '2026-11-13'::timestamptz - (n * 14 + m) * interval '10 minutes',
                 case when m <= 2 then '#OLD' when m = 3 and n % 10 = 0 then null
                      else '#CLAN' end,
                 case when n % 50 in (0, 25) then 'boatBattle'
                      when n % 3 = 0 then 'pathOfLegend' else 'ladder' end,
                 0, repeat('x', 100)
            from generate_series(1, 52) m, generate_series(1, 600) n
          union all
          select 'b' || m || '-' || n, 'o-' || m || '-' || n,
                 '2026-11-13'::timestamptz - (n * 14 + m) * interval '10 minutes',
                 'c-' || m || '-' || n, 'ladder', 1, repeat('x', 100)
            from generate_series(1, 52) m, generate_series(1, 600) n) r
         order by 3, 1, 2;
      insert into player_snapshot_daily
        select 'm-' || m, '2026-11-13'::date - d, 'daily',
               case when m <= 2 then '#OLD' else '#CLAN' end, 100 - d, 
               ('2026-11-13'::date - d) + interval '12 hours'
          from generate_series(1, 52) m, generate_series(0, 60) d;`);
    for (const t of ["battle", "battle_participant", "player_snapshot_daily"])
      await db.query(`vacuum analyze ${t}`);

    const weeks = [
      ["2026-W42", "2026-10-12"],
      ["2026-W43", "2026-10-19"],
      ["2026-W44", "2026-10-26"],
      ["2026-W45", "2026-11-02"],
    ].map(([iso_week, monday]) => ({
      iso_week,
      from: `${monday}T00:00:00Z`,
      to: new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * 864e5).toISOString(),
    }));
    const sent = [];
    const recording = {
      query: (text, values) => {
        sent.push({ text, values });
        return db.query(text, values);
      },
    };
    const read = (clan, player) =>
      memberActivityWeeks(
        recording,
        clan,
        player,
        weeks,
        "2026-10-12T00:00:00Z",
        "2026-11-09T00:00:00Z",
      );
    const cases = [];
    for (const [clan, player] of [
      ["#CLAN", "m-10"],
      ["#CLAN", "m-3"],
      ["#CLAN", "m-1"],
      [null, "m-3"],
    ]) {
      const rows = await read(clan, player);
      const { text, values } = sent.at(-1);
      cases.push({ clan, player, rows, text, values });
    }
    const former = participationQueries({
      clanTag: "#CLAN",
      tags: [],
      formerTags: ["m-1", "m-3", "m-10", "m-11"],
      from: "2026-10-12T00:00:00Z",
      rankedTypes: ["pathOfLegend"],
    }).find((q) => q.name === "former_battles_by_week");

    // Every answer is the `=` statement's, the null clan included: no
    // battles (not m-3's clanless ones) and no donations.
    for (const c of cases) {
      assert.match(
        c.text,
        /is not distinct from \$2::text and \$2::text is not null/,
      );
      const legacy = LEGACY_SIDE(LEGACY_PARAM_IN_CLAN(c.text, "$2"));
      assert.doesNotMatch(legacy, /is not distinct from/);
      assert.deepEqual(c.rows, (await db.query(legacy, c.values)).rows);
    }
    const [m10, m3, m1, clanless] = cases.map((c) => c.rows);
    assert.ok(m10.every((w) => w.battles > 0 && w.ranked_battles > 0));
    assert.ok(m3.every((w) => w.battles > 0));
    assert.ok(m1.every((w) => w.battles === 0));
    assert.ok(clanless.every((w) => w.battles === 0 && w.donations === null));
    const formerRows = (await db.query(former.text, former.values)).rows;
    const sort = (rows) =>
      rows.sort((a, b) =>
        `${a.player_tag}${a.week_start.toISOString()}`.localeCompare(
          `${b.player_tag}${b.week_start.toISOString()}`,
        ),
      );
    assert.ok(formerRows.length > 0);
    assert.deepEqual(
      sort(formerRows),
      sort(
        (await db.query(LEGACY_PARAM_IN_CLAN(former.text, "$3"), former.values))
          .rows,
      ),
    );

    const plans = [
      ...cases.map((c) => ({ name: `${c.player} in ${c.clan}`, ...c })),
      { name: "former_battles_by_week", ...former },
    ];
    for (const p of plans) {
      const after = await planOf(db, p.text, p.values);
      const reads = after.nodes.filter(
        (n) => n["Relation Name"] === "battle_participant",
      );
      if (p.clan === null) {
        // `$2 is not null` folds to false: nothing is read at all.
        assert.deepEqual(reads, [], p.name);
        continue;
      }
      assert.ok(
        !reads.some((n) => n["Index Name"] === "battle_participant_clan_time"),
        `${p.name}: never the clan index`,
      );
      const ranges = reads.filter(
        (n) => n["Index Name"] === "battle_participant_player_time_cover",
      );
      assert.ok(ranges.length > 0, `${p.name}: enters the player cover`);
      for (const n of ranges) {
        assert.equal(n["Node Type"], "Index Only Scan", p.name);
        assert.equal(n["Heap Fetches"], 0, p.name);
        assert.match(n["Index Cond"], /player_tag = /, p.name);
        assert.doesNotMatch(n["Index Cond"], /clan_tag/, p.name);
      }
      // Any other participant read is a boat row's side, by primary key.
      for (const n of reads.filter((r) => !ranges.includes(r)))
        assert.equal(n["Index Name"], "battle_participant_pkey", p.name);
      if (p.name === "former_battles_by_week") {
        // Four members' four weeks, a few hundred index entries, against
        // the clan's 30,000 in the window.
        assert.ok(after.buffers <= 400, `${p.name}: ${after.buffers} buffers`);
        continue;
      }
      // One member's four weeks. Before, the count read each battle's
      // heap page for its side (about 300 more buffers here).
      const before = await planOf(
        db,
        LEGACY_SIDE(LEGACY_PARAM_IN_CLAN(p.text, "$2")),
        p.values,
      );
      assert.ok(
        after.buffers * 2 <= before.buffers,
        `${p.name}: ${after.buffers} buffers against ${before.buffers} before`,
      );
      assert.ok(after.buffers <= 200, `${p.name}: ${after.buffers} buffers`);
    }
  } finally {
    await db.end();
  }
});

// captureByPlayer as it stood before 2026-11-13.
const LEGACY_CAPTURE = `with snapshots as (
       select player_tag, profile_observed_at as observed_to,
              lag(profile_observed_at) over w as observed_from,
              battle_count - lag(battle_count) over w as expected_battles
         from player_snapshot_daily
        where player_tag = any($1::text[]) and snapshot_kind = 'daily'
          and profile_observed_at is not null
          and snapshot_date > ($2::timestamptz - interval '2 days')::date
          and snapshot_date <= ($3::timestamptz + interval '1 day')::date
       window w as (partition by player_tag order by snapshot_date)
     ), intervals as (
       select s.player_tag, s.expected_battles,
              (select count(*)::int from battle_participant bp
                where bp.player_tag = s.player_tag
                  and bp.battle_time > s.observed_from
                  and bp.battle_time <= s.observed_to) as captured_battles
         from snapshots s
        where s.observed_from is not null and s.observed_to > s.observed_from
          and s.observed_to > $2::timestamptz and s.observed_to <= $3::timestamptz
          and s.expected_battles is not null and s.expected_battles >= 0
     )
     select player_tag, sum(expected_battles)::int as expected,
            sum(captured_battles)::int as captured
       from intervals
      where captured_battles <= expected_battles
      group by player_tag`;

test("the capture estimate reads each member's snapshot range index-only and counts each interval once", async () => {
  const db = await connect();
  try {
    // A year of day rows for 900 players written day by day, so a
    // member's days are scattered over the heap; battles beside them.
    await db.query(`create temporary table player_snapshot_daily (
        player_tag text not null, snapshot_date date not null,
        snapshot_kind text not null, donations int, clan_tag text,
        profile_observed_at timestamptz, battle_count int, padding text,
        primary key (player_tag, snapshot_date, snapshot_kind));
      create index player_snapshot_daily_week_cover
        on player_snapshot_daily (player_tag, snapshot_date)
        include (snapshot_kind, donations, clan_tag, profile_observed_at, battle_count);
      insert into player_snapshot_daily
        select 'p-' || p, '2026-11-13'::date - d, 'daily', 0, '#CLAN',
               case when (p + d) % 13 = 0 then null
                    else ('2026-11-13'::date - d) + interval '12 hours' + p * interval '1 second' end,
               -- The counter climbs, and a reset once (a negative step).
               -- About 36 recorded battles a day at most; some members'
               -- counters climb by fewer (a capture surplus: not comparable).
               case when p % 97 = 0 and d = 3 then 5 else 40000 - d * (p % 11 * 6) end,
               repeat('x', 300)
          from generate_series(0, 364) d, generate_series(1, 900) p
         order by d desc, p;
      create temporary table battle_participant (
        battle_id text, player_tag text, battle_time timestamptz,
        clan_tag text, padding text, primary key (battle_id, player_tag));
      create index participation_player_time_cover
        on battle_participant (player_tag, battle_time desc) include (battle_id, clan_tag);
      insert into battle_participant
        select 'b' || p || '-' || n, 'p-' || p,
               '2026-11-13 12:00'::timestamptz - n * (p % 7 + 1) * interval '41 minutes',
               '#CLAN', repeat('x', 100)
          from generate_series(1, 900) p, generate_series(1, 300) n
         order by 3;`);
    await db.query("vacuum analyze player_snapshot_daily");
    await db.query("vacuum analyze battle_participant");

    const tags = Array.from({ length: 50 }, (_, i) => `p-${i * 17 + 1}`);
    tags.push("p-1", "p-none");
    const fromMs = Date.parse("2026-11-02T00:00:00Z");
    const toMs = Date.parse("2026-11-13T20:00:00Z");
    const sent = [];
    const recording = {
      query: (text, values) => {
        sent.push({ text, values });
        return db.query(text, values);
      },
    };
    const got = await captureByPlayer(recording, tags, { fromMs, toMs });
    assert.equal(sent.length, 1, "one statement");
    const { text, values } = sent[0];
    const legacy = (await db.query(LEGACY_CAPTURE, values)).rows;
    assert.ok(legacy.length >= 40, `${legacy.length} members comparable`);
    assert.deepEqual(
      [...got.keys()].sort(),
      legacy.map((r) => r.player_tag).sort(),
    );
    for (const r of legacy) {
      const g = got.get(r.player_tag);
      assert.equal(g.expected, r.expected, r.player_tag);
      assert.equal(g.captured, r.captured, r.player_tag);
    }

    const { nodes } = await planOf(db, text, values);
    const snapshotReads = nodes.filter(
      (n) => n["Relation Name"] === "player_snapshot_daily",
    );
    assert.equal(snapshotReads.length, 1);
    assert.equal(snapshotReads[0]["Node Type"], "Index Only Scan");
    assert.equal(
      snapshotReads[0]["Index Name"],
      "player_snapshot_daily_week_cover",
    );
    assert.equal(snapshotReads[0]["Heap Fetches"], 0);
    // One key range per distinct tag, never the clan's tags as one bitmap.
    assert.equal(snapshotReads[0]["Actual Loops"], new Set(tags).size);
    // Each interval's battles counted once: one battle read, entered once
    // per interval (the flat statement counted twice).
    const battleReads = nodes.filter(
      (n) => n["Relation Name"] === "battle_participant",
    );
    assert.equal(battleReads.length, 1);
    assert.equal(battleReads[0]["Node Type"], "Index Only Scan");
    // The join that yields the intervals (tags x their profile rows, run
    // once): its row count is exact, where a looped node's is averaged.
    const intervals = nodes.find(
      (n) =>
        n["Actual Loops"] === 1 &&
        n.Plans?.some(
          (c) =>
            c["Node Type"] === "Subquery Scan" &&
            c.Plans?.[0]?.["Node Type"] === "WindowAgg",
        ),
    );
    assert.ok(intervals);
    assert.ok(intervals["Actual Rows"] > 100);
    assert.equal(battleReads[0]["Actual Loops"], intervals["Actual Rows"]);
  } finally {
    await db.end();
  }
});

test("the timeline's last profile before an instant is one probe per player", async () => {
  const db = await connect();
  try {
    // A year of day rows for 400 players written day by day (a player's
    // days one to a heap page apart), a pre_reset row on Mondays and a
    // day now and then with no profile read.
    await db.query(`create temporary table player_snapshot_daily (
        player_tag text not null, snapshot_date date not null,
        snapshot_kind text not null, profile_observed_at timestamptz,
        trophies int, best_trophies int, arena_id int, collection_level int,
        wins int, battle_count int, donations int, pol_league int,
        pol_trophies int, pol_rank int, padding text,
        primary key (player_tag, snapshot_date, snapshot_kind));
      insert into player_snapshot_daily
        select 'p-' || p, '2026-11-13'::date - d, k,
               case when (p + d) % 11 = 0 then null
                    else ('2026-11-13'::date - d) + interval '9 hours'
                         + p * interval '7 seconds'
                         + case when k = 'pre_reset' then interval '1 hour' else interval '0' end end,
               5000 + d, 6000, 20, 40, 900 - d, 20000 - d, d % 300, null, null, null,
               repeat('x', 300)
          from generate_series(0, 364) d, generate_series(1, 400) p,
               unnest(case when d % 7 = 4
                           then array['daily', 'pre_reset'] else array['daily'] end) k
         order by d desc, p;`);
    await db.query("vacuum analyze player_snapshot_daily");

    const tags = Array.from({ length: 55 }, (_, i) => `p-${i * 7 + 3}`);
    tags.push("p-none");
    const fromMs = Date.parse("2026-11-12T20:00:00Z");
    const toMs = Date.parse("2026-11-13T20:00:00Z");
    const { snapshot } = prefetchStatements({ fromMs, toMs });
    const before = [];
    for (const at of [fromMs, toMs]) {
      const before_ = await planOf(db, snapshot(at), [tags]);
      before.push({
        rows: (await db.query(snapshot(at), [tags])).rows,
        ...before_,
      });
    }

    await db.query(`create index player_snapshot_daily_profile_time
        on player_snapshot_daily (player_tag, profile_observed_at desc)
        where profile_observed_at is not null`);
    await db.query("analyze player_snapshot_daily");
    for (const [i, at] of [fromMs, toMs].entries()) {
      const rows = (await db.query(snapshot(at), [tags])).rows;
      assert.equal(rows.length, 55, "a player with no profile has no row");
      assert.deepEqual(rows, before[i].rows);

      const { nodes, buffers } = await planOf(db, snapshot(at), [tags]);
      const reads = nodes.filter(
        (n) => n["Relation Name"] === "player_snapshot_daily",
      );
      assert.equal(reads.length, 1);
      assert.equal(reads[0]["Node Type"], "Index Scan");
      assert.equal(
        reads[0]["Index Name"],
        "player_snapshot_daily_profile_time",
      );
      assert.equal(reads[0]["Actual Loops"], tags.length);
      assert.ok(!nodes.some((n) => /Sort/.test(n["Node Type"])), "no sort");
      // A probe and a heap page per player, against every day row of each.
      assert.ok(
        buffers * 10 <= before[i].buffers,
        `${buffers} buffers against ${before[i].buffers} before`,
      );
      assert.ok(buffers <= 5 * tags.length, `${buffers} buffers`);
    }
  } finally {
    await db.end();
  }
});
