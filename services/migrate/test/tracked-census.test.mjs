import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { trackedCensus } from "../src/ops-tracked-census.mjs";
import { handler } from "../src/lambda.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_tracked_census_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

// #2000 is claimed, #2002 recorded directly, #2PPP recorded comprehensively with
// #2008 a member now, #2009 a member once and #2020 seen only in its war rows.
// #2QQQ is #2002's own clan, which nobody tracks; #2022 is in it. #2028, #2029 and
// #2080 are opponents nobody tracks.
const BATTLES = [
  ["b1", ["#2008", "#2028"], "d2", "2026-08-10T00:00:00Z"],
  ["b2", ["#2009", "#2029"], "d2", "2026-09-12T00:00:00Z"],
  ["b3", ["#2028", "#2029"], "d1", "2026-09-13T00:00:00Z"],
  ["b4", ["#2020", "#2080"], "d2", "2026-09-13T00:00:00Z"],
  ["b5", ["#2000", "#2028"], "d2", "2026-10-01T00:00:00Z"],
  ["b6", ["#2022", "#2029"], "d1", "2026-09-14T00:00:00Z"],
];

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, kind)
     values ('census-test', 'approved', 'owner', 'person')
     returning account_id`,
  );
  for (const tag of ["#2PPP", "#2QQQ"])
    await db.query("insert into clan (clan_tag) values ($1)", [tag]);
  for (const tag of [
    "#2000",
    "#2002",
    "#2008",
    "#2009",
    "#2020",
    "#2022",
    "#2028",
    "#2029",
    "#2080",
  ])
    await db.query("insert into player (player_tag) values ($1)", [tag]);
  await db.query(
    "update player set last_known_clan_tag = '#2QQQ' where player_tag = '#2002'",
  );
  await db.query(
    "insert into claim (account_id, player_tag) values ($1, '#2000')",
    [a.account_id],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, status, scope, origin)
     values ('player', '#2002', $1, 'active', 'comprehensive', 'ops'),
            ('clan', '#2PPP', $1, 'active', 'comprehensive', 'claim'),
            ('player', '#2080', $1, 'stopped', 'comprehensive', 'claim')`,
    [a.account_id],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at)
     values ('#2PPP', '#2008', '2026-08-01', null),
            ('#2PPP', '#2009', '2026-03-01', '2026-09-20'),
            ('#2QQQ', '#2022', '2026-09-01', null),
            ('#2QQQ', '#2002', '2026-09-01', null)`,
  );
  await db.query(
    "insert into war_week (clan_tag, season_id, section_index) values ('#2PPP', 130, 1)",
  );
  await db.query(
    `insert into war_participation (clan_tag, season_id, section_index, player_tag)
     values ('#2PPP', 130, 1, '#2020')`,
  );
  for (const hash of ["d1", "d2"])
    await db.query(
      `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at)
       values ($1, 8, now(), now())`,
      [hash],
    );
  for (const [id, tags, deck, at] of BATTLES) {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, $2, 'PvP', 'pvp')`,
      [id, at],
    );
    for (const [side, tag] of tags.entries())
      await db.query(
        `insert into battle_participant
           (battle_id, player_tag, side, battle_time, type_class, type, deck_hash)
         values ($1, $2, $3, $4, 'pvp', 'PvP', $5)`,
        [id, tag, side, at, deck],
      );
  }
  for (const tag of ["#2008", "#2028", "#2022"])
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date)
       values ($1, '2026-09-13')`,
      [tag],
    );
  await db.end();
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("kept players are the recorded now, claims and past members of a comprehensive clan", async () => {
  const r = await trackedCensus(SCRATCH_URL, { part: "subjects" });
  assert.equal(r.error, undefined, r.message);
  assert.equal(r.readonly, true);
  assert.equal(r.keep_players, 5); // A1 D1 M1 F1 W1; a stopped U3 is not kept
  assert.equal(r.former_members_only, 2); // F1 W1
  assert.equal(r.war_only_members, 1); // W1
  assert.equal(r.deep_clans, 1);
  assert.equal(r.roster_clans, 1); // #2QQQ, D1's own clan
  assert.equal(r.roster_only_members, 1); // R1
});

test("a battle stays when a kept player played in it", async () => {
  const r = await trackedCensus(SCRATCH_URL, { part: "battles" });
  assert.equal(r.error, undefined, r.message);
  assert.equal(r.battles, 6);
  assert.equal(r.keep, 4);
  assert.equal(r.remove, 2); // b3, b6
  assert.equal(r.remove_participants, 4);
  assert.deepEqual(
    r.by_month.find((m) => m.month === "2026-09"),
    { month: "2026-09", battles: 4, remove: 2 },
  );
  assert.equal(r.orphaned_decks, 1); // d1
});

test("opponents in kept battles stay as identities; their profile rows go", async () => {
  const r = await trackedCensus(SCRATCH_URL, { part: "players" });
  assert.equal(r.error, undefined, r.message);
  assert.equal(r.players, 9);
  assert.equal(r.keep_full, 5);
  assert.equal(r.keep_identity, 8); // plus U1 U2 U3
  assert.equal(r.remove, 1); // R1
  assert.deepEqual(r.tables.player_snapshot_daily, { rows: 3, remove: 2 });
});

test("an untracked clan's own rows go, a kept player's membership in it stays", async () => {
  const r = await trackedCensus(SCRATCH_URL, { part: "clans" });
  assert.equal(r.error, undefined, r.message);
  assert.equal(r.clans, 2);
  assert.equal(r.tracked, 1);
  assert.equal(r.remove, 0); // #2QQQ still names D1's membership
  assert.deepEqual(r.tables.clan_membership, { rows: 4, remove: 1 }); // R1 in #2QQQ
});

test("keep_tags lists the kept subjects", async () => {
  const r = await trackedCensus(SCRATCH_URL, { part: "keep_tags" });
  assert.deepEqual(r.players, ["#2000", "#2002", "#2008", "#2009", "#2020"]);
  assert.deepEqual(r.clans, ["#2PPP"]);
});

test("the census refuses unknown parts and fields before connecting, and must run alone", async () => {
  const unreachable = "postgres://nobody@127.0.0.1:1/none";
  assert.equal(
    (await trackedCensus(unreachable, { part: "delete" })).reason,
    "unknown_part",
  );
  assert.equal(
    (await trackedCensus(unreachable, { part: "battles", apply: true })).reason,
    "unknown_fields",
  );
  assert.equal(
    (await handler({ tracked_census: { part: "battles" }, stats: true }))
      .reason,
    "exclusive_op_required",
  );
});

test("the census transaction is read-only", async () => {
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  const seen = [];
  const spy = {
    connect: () => db.connect(),
    end: () => db.end(),
    query: (sql, params) => {
      seen.push(String(sql).trim().slice(0, 60));
      return db.query(sql, params);
    },
  };
  const r = await trackedCensus(null, { part: "receipts" }, spy);
  assert.equal(r.error, undefined, r.message);
  assert.equal(seen[0], "begin isolation level repeatable read read only");
  assert.ok(
    seen.every((s) => /^(begin|set local|with|commit)/.test(s)),
    seen.join("\n"),
  );
});

test("recordings lists active player recordings no claim explains", async () => {
  const r = await trackedCensus(SCRATCH_URL, { part: "recordings" });
  assert.equal(r.error, undefined, r.message);
  assert.deepEqual(
    r.rows.map((row) => [row.player_tag, row.clan_tag, row.claims]),
    [["#2002", "#2QQQ", 0]],
  );
  assert.equal(r.rows[0].requested_by_role, "owner");
  assert.equal(r.rows[0].deep_clan_member_ever, false);
});
