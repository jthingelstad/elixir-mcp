import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { trackedPurge, PHASES } from "../src/ops-tracked-purge.mjs";
import { trackedCensus } from "../src/ops-tracked-census.mjs";
import { handler } from "../src/lambda.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_tracked_purge_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const FLOOR = { players: 1, clans: 1 };

// The census fixture's shape: #2000 claimed (recorded as 'ops'), #2PPP
// recorded comprehensively with #2008 a member now and #2009 once. #2QQQ
// is #2000's own clan, nobody tracks it; #2022 is in it. #2028, #2029
// are opponents nobody tracks. #2RRC is #2PPP's war rival, #2YYY #2028's
// clan on a kept battle, #2UUL a clan nothing names.
const BATTLES = [
  ["b1", ["#2008", "#2028"], "d2", "#2YYY"],
  ["b2", ["#2009", "#2029"], "d2", null],
  ["b3", ["#2028", "#2029"], "d1", null],
  ["b6", ["#2022", "#2029"], "d1", null],
];

async function q(sql, params) {
  const db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.end();
  }
}

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
     values ('purge-test', 'approved', 'owner', 'person') returning account_id`,
  );
  const {
    rows: [g],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip)
     values ($1, 'purge-test', '192.0.2.1') returning gateway_id`,
    [a.account_id],
  );
  for (const tag of ["#2PPP", "#2QQQ", "#2RRC", "#2YYY", "#2UUL"])
    await db.query("insert into clan (clan_tag) values ($1)", [tag]);
  for (const tag of [
    "#2000",
    "#2002",
    "#2008",
    "#2009",
    "#2022",
    "#2028",
    "#2029",
  ])
    await db.query("insert into player (player_tag) values ($1)", [tag]);
  await db.query(
    "update player set last_known_clan_tag = '#2QQQ' where player_tag = '#2000'",
  );
  await db.query(
    "insert into claim (account_id, player_tag) values ($1, '#2000')",
    [a.account_id],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, status, scope, origin)
     values ('player', '#2000', $1, 'active', 'comprehensive', 'ops'),
            ('player', '#2002', $1, 'active', 'comprehensive', 'claim'),
            ('clan', '#2PPP', $1, 'active', 'comprehensive', 'claim')`,
    [a.account_id],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at)
     values ('#2PPP', '#2008', '2026-08-01', null),
            ('#2PPP', '#2009', '2026-03-01', '2026-09-20'),
            ('#2QQQ', '#2022', '2026-09-01', null),
            ('#2QQQ', '#2000', '2026-09-01', null)`,
  );
  for (const clan of ["#2PPP", "#2QQQ"]) {
    await db.query(
      "insert into war_week (clan_tag, season_id, section_index) values ($1, 130, 1)",
      [clan],
    );
    await db.query(
      `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag)
       values ($1, 130, 1, '#2RRC')`,
      [clan],
    );
  }
  await db.query(
    `insert into war_participation (clan_tag, season_id, section_index, player_tag)
     values ('#2QQQ', 130, 1, '#2022')`,
  );
  for (const hash of ["d1", "d2"])
    await db.query(
      `insert into deck (deck_hash, card_count, first_seen_at, last_seen_at)
       values ($1, 8, now(), now())`,
      [hash],
    );
  for (const [id, tags, deck, clan] of BATTLES) {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, '2026-09-13T00:00:00Z', 'PvP', 'pvp')`,
      [id],
    );
    for (const [side, tag] of tags.entries())
      await db.query(
        `insert into battle_participant
           (battle_id, player_tag, side, battle_time, type_class, type, deck_hash, clan_tag)
         values ($1, $2, $3, '2026-09-13T00:00:00Z', 'pvp', 'PvP', $4, $5)`,
        [id, tag, side, deck, side === 1 ? clan : null],
      );
  }
  for (const tag of ["#2008", "#2028", "#2022"])
    await db.query(
      `insert into player_snapshot_daily (player_tag, snapshot_date)
       values ($1, '2026-09-13')`,
      [tag],
    );
  for (const [endpoint, entity] of [
    ["player_battlelog", "#2000"],
    ["player_battlelog", "#2028"],
    ["clan", "#2PPP"],
    ["clan", "#2QQQ"],
    ["rankings_players", "57000006"],
  ]) {
    await db.query(
      `insert into api_receipt (endpoint, entity_key, gateway_id, payload_hash, admission)
       values ($1, $2, $3, 'h', 'admitted')`,
      [endpoint, entity, g.gateway_id],
    );
    await db.query(
      `insert into api_payload (endpoint, entity_key, payload_hash, payload_json)
       values ($1, $2, 'h', '{}')`,
      [endpoint, entity],
    );
  }
  await db.query(
    `insert into poll_state (subject_tag, endpoint)
     values ('#2000', 'player'), ('#2028', 'player_battlelog'),
            ('#2QQQ', 'clan'), ('#2UUL', 'clan'), ('GLOBAL', 'cards')`,
  );
  await db.end();
});

after(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

test("the purge refuses without a keep floor, above it, and before connecting", async () => {
  const unreachable = "postgres://nobody@127.0.0.1:1/none";
  assert.equal(
    (await trackedPurge(unreachable, { phase: "drop" })).reason,
    "unknown_phase",
  );
  assert.equal(
    (await trackedPurge(unreachable, { phase: "battles", apply: true })).reason,
    "keep_at_least_required",
  );
  assert.equal(
    (await trackedPurge(unreachable, { phase: "battles", limit: 1e6 })).reason,
    "limit_out_of_range",
  );
  assert.equal(
    (await handler({ tracked_purge: { phase: "battles" }, stats: true }))
      .reason,
    "exclusive_op_required",
  );
  const r = await trackedPurge(SCRATCH_URL, {
    phase: "battles",
    apply: true,
    keep_at_least: { players: 99, clans: 1 },
  });
  assert.equal(r.reason, "keep_set_below_floor");
  assert.equal((await q("select count(*)::int n from battle"))[0].n, 4);
});

test("a preview selects the batch and changes nothing", async () => {
  const r = await trackedPurge(SCRATCH_URL, { phase: "battles" });
  assert.equal(r.error, undefined, r.message);
  assert.equal(r.selected, 2); // b3, b6
  assert.deepEqual(r.deleted, {});
  assert.equal((await q("select count(*)::int n from battle"))[0].n, 4);
});

test("every phase to done leaves only what someone tracks", async () => {
  for (const phase of PHASES) {
    let after = null;
    for (let i = 0; i < 20; i += 1) {
      const r = await trackedPurge(SCRATCH_URL, {
        phase,
        after,
        limit: 1,
        apply: true,
        keep_at_least: FLOOR,
      });
      assert.equal(r.error, undefined, `${phase}: ${r.message}`);
      if (r.done) break;
      after = r.next;
    }
  }
  const tags = async (sql) => (await q(sql)).map((r) => Object.values(r)[0]);
  assert.deepEqual(await tags("select battle_id from battle order by 1"), [
    "b1",
    "b2",
  ]);
  // Opponents in kept battles stay as identities, without profile rows.
  assert.deepEqual(await tags("select player_tag from player order by 1"), [
    "#2000",
    "#2002",
    "#2008",
    "#2009",
    "#2028",
    "#2029",
  ]);
  assert.deepEqual(
    await tags("select player_tag from player_snapshot_daily order by 1"),
    ["#2008"],
  );
  // The rival in a tracked clan's race, the clan on a kept battle and the
  // tracked player's own clan keep their names; nothing names #2UUL.
  assert.deepEqual(await tags("select clan_tag from clan order by 1"), [
    "#2PPP",
    "#2QQQ",
    "#2RRC",
    "#2YYY",
  ]);
  assert.deepEqual(await tags("select clan_tag from war_week order by 1"), [
    "#2PPP",
  ]);
  assert.deepEqual(
    await tags("select clan_tag || player_tag from clan_membership order by 1"),
    ["#2PPP#2008", "#2PPP#2009", "#2QQQ#2000"],
  );
  assert.deepEqual(await tags("select deck_hash from deck"), ["d2"]);
  assert.deepEqual(
    await tags(
      `select entity_key from api_receipt
        where replay_retired_at is not null order by 1`,
    ),
    ["#2028", "#2QQQ", "57000006"],
  );
  assert.deepEqual(
    await tags("select entity_key from api_payload order by 1"),
    ["#2000", "#2PPP"],
  );
  assert.deepEqual(
    await tags(
      "select subject_tag || ' ' || endpoint from poll_state order by 1",
    ),
    ["#2000 player", "#2QQQ clan", "GLOBAL cards"],
  );
  assert.deepEqual(
    await tags("select origin from recording where subject_type = 'player'"),
    ["claim", "claim"],
  );
  const census = await trackedCensus(SCRATCH_URL, { part: "battles" });
  assert.equal(census.remove, 0);
  assert.equal(census.orphaned_decks, 0);
});
