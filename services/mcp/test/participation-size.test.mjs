/**
 * clans_participation's eight-week read fits the MCP result cap with room
 * (#124). Since 9.13.0 (#46) each row carries its place and role at every
 * war finish and the members who left are listed too; the eight-week full
 * read of the recorded clan (44 members, 17 who left) was 51,875
 * characters and refused, and compact answered at 47,044, a few
 * departures from refusing as well. Jamie, 2026-09-28: slim the agent's
 * read rather than accept the refusal.
 *
 * The fixture is a full clan as big as the game allows (50 members) with
 * 20 who left inside the window, eight ISO weeks of battles, donations
 * and war, roles known at every finish, and nine joiners mid-window, so
 * the object rows /api/v1 serves are over the cap here as they are live.
 * The agent's table must stay under BUDGET at both verbosities, and must
 * decode to exactly the rows /api/v1 serves.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import {
  MCP_RESULT_MAX_CHARS,
  renderToolResultText,
} from "../src/protocol.mjs";
import { isoWeekStart } from "../src/time.mjs";
import { participationObjects } from "../src/participation-table.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_partsize_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#QJ2UV8PY";
const OTHER = "#QJ2UV8PQ";

/** The agent read's ceiling: under the 48,000 cap with room for more
 *  departures inside the window than the live clan has had. */
const BUDGET = 40_000;

const DAY = 86400_000;
const now = Date.now();
const CHARS = "0289PYLQGRJCUV";
const tagOf = (i) => {
  let s = "";
  let n = i + 14 ** 7;
  while (n > 0) {
    s = CHARS[n % 14] + s;
    n = Math.floor(n / 14);
  }
  return `#${s}`;
};
const NAMES = [
  "pigsareus",
  "Waltadr",
  "shimmeringhost",
  "Mega Goblin",
  "L-Drxgo⚡",
  "Kurd Paraw",
  "Aaqib Javed",
  "Ｓｈａｆｉｔｈ Ｎｉｈａｌ♥️",
  "sikander sidhu",
  "x.x.hari.x.x",
];
const CURRENT = 50;
const FORMER = 20;
const players = Array.from({ length: CURRENT + FORMER }, (_, i) => ({
  tag: tagOf(i),
  name: `${NAMES[i % NAMES.length]}${i}`,
  // Roles as a full clan holds them: one leader, three co-leaders, a
  // third elders.
  role:
    i === 0 ? "leader" : i < 4 ? "coLeader" : i % 3 === 0 ? "elder" : "member",
  // Former members leave one every two days or so across the window;
  // nine current members join inside it.
  leftDay: i >= CURRENT ? 1 + ((i - CURRENT) * 45) / FORMER : null,
  joinDay: i >= 40 && i < CURRENT ? 5 + (i - 40) * 5 : 70,
}));

let db;
let mcp;
let rest;
let svcDoor;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await ensureSeasonsAround(db);
  await db.query(`insert into clan (clan_tag) values ($1), ($2)`, [
    CLAN,
    OTHER,
  ]);
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('ps-owner', 'approved', true) returning account_id`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'comprehensive')`,
    [CLAN, owner.account_id],
  );
  const {
    rows: [{ gateway_id: gateway }],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip) values ($1, 'collector-a', '192.0.2.1') returning gateway_id`,
    [owner.account_id],
  );

  // A roster read every day at 12:00Z for 70 days: each war finish
  // (Monday 09:35Z) sits between two reads, so every place is known.
  let previous = null;
  for (let day = 70; day >= 0; day -= 1) {
    const at = new Date(now - day * DAY);
    at.setUTCHours(12, 0, 0, 0);
    if (at.getTime() > now) continue;
    const members = players.filter(
      (p) => p.joinDay >= day && (p.leftDay === null || p.leftDay < day),
    );
    await db.query(
      `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
       values ('clan', $1, $2, $3, $4, 'admitted')`,
      [CLAN, at.toISOString(), `ps${day}`, gateway],
    );
    await ingestClanRoster(db, {
      payload: {
        tag: CLAN,
        name: "Size",
        memberList: members.map((p) => ({
          tag: p.tag,
          name: p.name,
          // Elders were promoted from member 30 days ago: a role change
          // inside the window, and a role at every finish either side.
          role: p.role === "elder" && day > 30 ? "member" : p.role,
        })),
      },
      observedAt: at.toISOString(),
      windowStart: previous,
    });
    previous = at.toISOString();
  }

  // Battles: 20 to 300 a week each, a fifth of them ranked; a mid-window
  // joiner's first ones for another clan.
  await db.query(
    `with p as (
       select t.tag, t.i, t.join_day
         from unnest($1::text[], $2::int[]) with ordinality as t(tag, join_day, i)),
     g as (
       select p.tag, p.i, p.join_day, n
         from p, generate_series(1, (20 + (p.i * 37) % 280) * 8) as n)
     insert into battle (battle_id, battle_time, type, type_class)
     select 'ps-' || g.i || '-' || g.n,
            now() - (g.n::double precision / ((20 + (g.i * 37) % 280) * 8)) * interval '55 days',
            case when g.n % 5 = 0 then 'pathOfLegend' else 'PvP' end, 'pvp'
       from g`,
    [players.map((p) => p.tag), players.map((p) => Math.round(p.joinDay))],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag, type, type_class)
     select b.battle_id, t.tag, b.battle_time, 0,
            case when b.battle_time < now() - t.join_day * interval '1 day' then $3 else $4 end,
            b.type, b.type_class
       from battle b
       join unnest($1::text[], $2::int[]) with ordinality as t(tag, join_day, i)
         on split_part(b.battle_id, '-', 2)::bigint = t.i`,
    [
      players.map((p) => p.tag),
      players.map((p) => Math.round(p.joinDay)),
      OTHER,
      CLAN,
    ],
  );
  // The donation counter at every game day, climbing through each week.
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, donations, observed_at, clan_tag, roster_observed_at)
     select t.tag, current_date - d, 'daily',
            (extract(isodow from current_date - d)::int * (15 + t.i::int * 13 % 190)),
            now() - d * interval '1 day', $2, now() - d * interval '1 day'
       from unnest($1::text[]) with ordinality as t(tag, i), generate_series(0, 56) as d`,
    [players.map((p) => p.tag), CLAN],
  );
  // Nine war weeks: eight finished on the Mondays in the window, the
  // current one running. Decks and points for everyone in each.
  const monday = isoWeekStart(new Date(now)).getTime();
  const weeks = [];
  for (let k = 7; k >= -1; k -= 1) {
    const finish = monday - k * 7 * DAY + (9 * 60 + 35) * 60_000;
    weeks.push({
      section: 7 - k,
      started: new Date(finish - 7 * DAY + 5 * 60_000).toISOString(),
      finished: finish < now && k >= 0 ? new Date(finish).toISOString() : null,
    });
  }
  for (const w of weeks) {
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, started_observed_at, finished_observed_at)
       values ($1, 900 + $2::int / 4, $2::int % 4, $3, $4)`,
      [CLAN, w.section, w.started, w.finished],
    );
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
       select $1, 900 + $2::int / 4, $2::int % 4, t.tag,
              (t.i::int * 211 + $2::int * 97) % 3600, (t.i::int + $2::int) % 17
         from unnest($3::text[]) with ordinality as t(tag, i)`,
      [CLAN, w.section, players.map((p) => p.tag)],
    );
  }

  const account = {
    accountId: owner.account_id,
    isOwner: true,
    timezone: null,
  };
  const registry = makeRegistry();
  mcp = makeInvoker({ db, account, registry, surface: "mcp" });
  rest = makeInvoker({ db, account, registry, surface: "rest" });
  svcDoor = makeInvoker({
    db,
    account,
    registry,
    surface: "svc:acceptance",
  });
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

const read = async (invoke, verbosity) => {
  const { body, isError } = await invoke("clans_participation", {
    clan_tag: CLAN,
    weeks: 8,
    verbosity,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 400));
  return body;
};

for (const verbosity of ["full", "compact"]) {
  test(`the eight-week ${verbosity} read of a full clan fits the agent's budget, losslessly`, async (t) => {
    const table = await read(mcp, verbosity);
    const objects = await read(rest, verbosity);
    // The fixture is the case that refused: its object rows are over.
    assert.equal(table.member_count, CURRENT);
    assert.equal(table.former_member_count, FORMER);
    assert.equal(table.war_weeks.length, 9);
    const objectSize = JSON.stringify(objects).length;
    assert.ok(
      objectSize > MCP_RESULT_MAX_CHARS * (verbosity === "full" ? 1 : 0.95),
      `the fixture's object rows are ${objectSize} characters: no longer the size that refused`,
    );
    // What the agent is sent: the text MCP renders, uncut.
    const { text, truncated } = renderToolResultText(
      makeRegistry(),
      "clans_participation",
      table,
    );
    t.diagnostic(
      `${verbosity}: agent table ${text.length} characters, object rows ${objectSize}`,
    );
    assert.equal(truncated, false, "not refused");
    assert.ok(
      text.length <= BUDGET,
      `the agent's ${verbosity} read is ${text.length} characters, over the ${BUDGET} budget`,
    );
    // Nothing lost: every row decodes to the object /api/v1 serves.
    // days_since_battle is measured from the moment of each read, to two
    // decimals (about 14 minutes), and the two reads are seconds apart,
    // so it may step once between them (a CI flake on 2026-09-28, 0.05
    // against 0.04): compared within that step, everything else exactly.
    const decoded = participationObjects(table);
    for (const key of ["members", "former_members"]) {
      const steady = (rows) =>
        rows.map(({ days_since_battle: _moving, ...rest }) => rest);
      assert.deepEqual(steady(decoded[key]), steady(objects[key]));
      decoded[key].forEach((row, i) => {
        const other = objects[key][i].days_since_battle;
        if (row.days_since_battle == null || other == null)
          assert.equal(row.days_since_battle, other);
        else assert.ok(Math.abs(row.days_since_battle - other) <= 0.011);
      });
    }
    for (const row of [...table.members, ...table.former_members])
      assert.ok(Array.isArray(row));
    assert.deepEqual(
      table.members[0].length,
      table.columns.members.length,
      "a row has one entry per column",
    );
    // A service token's MCP door (audited svc:<name>) reads the table
    // too: 9.16.0 first shipped keyed to "mcp" alone, and the acceptance
    // agent, a service token, still read objects.
    const svc = await read(svcDoor, verbosity);
    assert.deepEqual(svc.columns, table.columns);
    assert.ok(Array.isArray(svc.members[0]));
    // /api/v1 is unchanged: object rows, no columns.
    assert.equal(objects.columns, undefined);
    assert.ok(!Array.isArray(objects.members[0]));
  });
}
