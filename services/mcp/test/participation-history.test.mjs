/**
 * clans_participation's place at every war finish (issue #46): the role
 * and presence each member held at each finish, rebuilt from the roster
 * reads, membership intervals and role_changed events that ingest itself
 * writes, and the members who left inside the window.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { ensureSeasonsAround } from "../../ingest/src/season.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { atWarFinishes } from "../src/role-history.mjs";
import { participationObjects } from "../src/participation-table.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_parthistory_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#QJ2UV8PP";
const OTHER = "#QJ2UV8LL";
const [A, B, C, D, E] = ["#P0L2G8", "#P0L2G9", "#P0L2GC", "#P0L2GJ", "#P0L2GQ"];

const DAY = 86400_000;
const now = Date.now();
const at = (days, hours = 0) =>
  new Date(now - days * DAY + hours * 3600_000).toISOString();

// The story, oldest first. Days before now; the war finishes sit at
// 09:35-ish between reads the way races do.
const BACKFILL_READ = at(40); // the imported history: tenure, no events
const F0 = at(35); // a finish only the imported history covers
const R0 = at(30); // the record's first live read
const F1 = at(27);
const R1 = at(27, 1);
const R2 = at(22); // A: member -> elder
const F2 = at(20);
const R3 = at(20, 1);
const R4 = at(15); // B: elder -> member
const F3 = at(13);
const R5 = at(13, 2);
const R6 = at(10); // C leaves
const F4 = at(6);
const R7 = at(6, 1); // D: member -> elder, straddling F4 (R6 .. R7)
const R8 = at(3); // E shows as elder in the newer read...
const R8_OLDER = at(3, -0.5); // ...and an older read (member) lands after it
const R9 = at(2); // then a newer read, elder again
const F5 = at(1, 12);
const R10 = at(1, 13);

let db;
let invoke;
let liveGateway;
let backfillGateway;
let seq = 0;

function roster(members) {
  return {
    tag: CLAN,
    name: "History",
    memberList: members.map(([tag, role]) => ({
      tag,
      name: `n${tag.slice(3)}`,
      role,
    })),
  };
}

/** One admitted roster read, as the pipeline writes it: the receipt, then
 *  the projection with the previous admitted read as the window start. */
async function read(fetchedAt, members, { windowStart, gateway } = {}) {
  seq += 1;
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('clan', $1, $2, $3, $4, 'admitted')`,
    [CLAN, fetchedAt, `h${seq}`, gateway ?? liveGateway],
  );
  await ingestClanRoster(db, {
    payload: roster(members),
    observedAt: fetchedAt,
    windowStart,
  });
}

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
    `insert into account (email_hash, status, is_owner) values ('ph-owner', 'approved', true) returning account_id`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, scope) values ('clan', $1, $2, 'comprehensive')`,
    [CLAN, owner.account_id],
  );
  const gw = async (name) =>
    (
      await db.query(
        `insert into gateway (owner_account_id, name, static_ip) values ($1, $2, '192.0.2.1') returning gateway_id`,
        [owner.account_id, name],
      )
    ).rows[0].gateway_id;
  liveGateway = await gw("collector-a");
  backfillGateway = await gw("backfill-elixir-bot");

  // The imported history: a receipt the tenure import walked, and A's
  // interval backdated to it. No events.
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('clan', $1, $2, 'backfill', $3, 'admitted')`,
    [CLAN, BACKFILL_READ, backfillGateway],
  );

  const start = [
    [A, "member"],
    [B, "elder"],
    [C, "member"],
    [D, "member"],
    [E, "member"],
  ];
  await read(R0, start);
  await db.query(
    `update clan_membership set joined_observed_at = $3
      where clan_tag = $1 and player_tag = $2`,
    [CLAN, A, BACKFILL_READ],
  );
  await read(R1, start, { windowStart: R0 });
  const s2 = [
    [A, "elder"],
    [B, "elder"],
    [C, "member"],
    [D, "member"],
    [E, "member"],
  ];
  await read(R2, s2, { windowStart: R1 });
  await read(R3, s2, { windowStart: R2 });
  const s4 = [
    [A, "elder"],
    [B, "member"],
    [C, "member"],
    [D, "member"],
    [E, "member"],
  ];
  await read(R4, s4, { windowStart: R3 });
  await read(R5, s4, { windowStart: R4 });
  const s6 = s4.filter(([t]) => t !== C);
  await read(R6, s6, { windowStart: R5 });
  const s7 = [
    [A, "elder"],
    [B, "member"],
    [D, "elder"],
    [E, "member"],
  ];
  await read(R7, s7, { windowStart: R6 });
  const s8 = [
    [A, "elder"],
    [B, "member"],
    [D, "elder"],
    [E, "elder"],
  ];
  await read(R8, s8, { windowStart: R7 });
  // The older payload admitted after the newer one: its window runs
  // backwards (the previous admitted read is the newer one).
  await read(R8_OLDER, s7, { windowStart: R8 });
  await read(R9, s8, { windowStart: R8 });
  await read(R10, s8, { windowStart: R9 });

  const weeks = [
    [900, 0, F0],
    [900, 1, F1],
    [900, 2, F2],
    [900, 3, F3],
    [901, 0, F4],
    [901, 1, F5],
    [901, 2, null],
  ];
  for (const [season, section, finish] of weeks)
    await db.query(
      `insert into war_week (clan_tag, season_id, section_index, started_observed_at, finished_observed_at)
       values ($1, $2, $3, $4, $5)`,
      [
        CLAN,
        season,
        section,
        new Date(Date.parse(finish ?? at(0, -1)) - 6 * DAY).toISOString(),
        finish,
      ],
    );
  // C's war week before leaving, in this clan.
  await db.query(
    `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
     values ($1, 900, 3, $2, 1200, 12)`,
    [CLAN, C],
  );
  // C's battles: one here before leaving, one for another clan after.
  for (const [id, when, clan] of [
    ["ph-c-here", at(12), CLAN],
    ["ph-c-there", at(5), OTHER],
  ]) {
    await db.query(
      "insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, 'PvP', 'pvp')",
      [id, when],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, battle_time, side, clan_tag, type, type_class)
       values ($1, $2, $3, 0, $4, 'PvP', 'pvp')`,
      [id, C, when, clan],
    );
  }

  invoke = makeInvoker({
    db,
    account: {
      accountId: owner.account_id,
      isOwner: true,
      timezone: null,
    },
    registry: makeRegistry(),
  });
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

async function participation(args = {}) {
  const { body, isError } = await invoke("clans_participation", {
    clan_tag: CLAN,
    weeks: 8,
    ...args,
  });
  assert.equal(isError, false, JSON.stringify(body).slice(0, 400));
  // The agent's table (#124), read as the objects /api/v1 serves.
  return participationObjects(body);
}

const row = (body, tag) =>
  body.members.find((m) => m.player_tag === tag) ??
  body.former_members.find((m) => m.player_tag === tag);

test("the finishes, in order, and the clan's role history horizon", async () => {
  const body = await participation();
  assert.deepEqual(
    body.war_weeks.map((w) => w.finished_observed_at),
    [F0, F1, F2, F3, F4, F5, null],
  );
  assert.equal(
    body.role_history_since,
    R0,
    "the first live read, never the backfill's",
  );
  for (const m of [...body.members, ...body.former_members]) {
    assert.equal(m.role_at_war_finish.length, body.war_weeks.length);
    assert.equal(m.in_clan_at_war_finish.length, body.war_weeks.length);
    assert.equal(m.role_at_war_finish.at(-1), null, "unfinished week");
    assert.equal(m.in_clan_at_war_finish.at(-1), null, "unfinished week");
  }
});

test("a change after a closed finish leaves the earlier finishes' roles as they were", async () => {
  const body = await participation();
  const a = row(body, A);
  assert.equal(a.role, "elder", "today's role");
  // F0: in the clan (the imported tenure) but before the role history.
  assert.equal(a.in_clan_at_war_finish[0], true);
  assert.equal(a.role_at_war_finish[0], null);
  assert.deepEqual(a.role_at_war_finish.slice(1, 6), [
    "member",
    "elder",
    "elder",
    "elder",
    "elder",
  ]);
  assert.deepEqual(a.role_changes, [
    {
      role_before: "member",
      role_after: "elder",
      window_start: R1,
      observed_at: R2,
    },
  ]);
  // The other direction.
  const b = row(body, B);
  assert.equal(b.role, "member");
  assert.deepEqual(b.role_at_war_finish.slice(1, 6), [
    "elder",
    "elder",
    "member",
    "member",
    "member",
  ]);
  // F0 predates B's first read here: not observed, so unknown.
  assert.equal(b.in_clan_at_war_finish[0], null);
});

test("a member who left after a closed finish is in that finish's population and not today's", async () => {
  const body = await participation();
  assert.ok(!body.members.some((m) => m.player_tag === C));
  assert.equal(body.former_member_count, 1);
  const c = body.former_members[0];
  assert.equal(c.player_tag, C);
  assert.equal(c.left_observed_at, R6);
  assert.equal(c.role_at_departure, "member");
  assert.deepEqual(c.in_clan_at_war_finish.slice(1, 6), [
    true,
    true,
    true,
    false,
    false,
  ]);
  assert.deepEqual(c.role_at_war_finish.slice(1, 6), [
    "member",
    "member",
    "member",
    null,
    null,
  ]);
  // The race week before leaving, in this clan.
  assert.equal(c.war_decks[3], 12);
  assert.equal(c.war_points[3], 1200);
  // Battles here only: the one played for another clan after leaving is not counted.
  assert.equal(
    c.battles.reduce((s, n) => s + n, 0),
    1,
  );
  assert.ok(
    !body.notes.some((n) =>
      /Members who left since the window began are not listed/.test(n),
    ),
  );
  assert.ok(body.notes.some((n) => /former_members lists who left/.test(n)));
});

test("a change between the reads around a finish is unknown at that finish, never guessed", async () => {
  const body = await participation();
  const d = row(body, D);
  assert.equal(d.in_clan_at_war_finish[4], true);
  assert.equal(d.role_at_war_finish[3], "member");
  assert.equal(d.role_at_war_finish[4], null, "changed between R6 and R7");
  assert.equal(d.role_at_war_finish[5], "elder");
});

test("an older roster admitted after a newer one leaves the role unknown rather than wrong", async () => {
  const { rows } = await db.query(
    `select count(*)::int as n from clan_event
      where clan_tag = $1 and player_tag = $2 and window_start > window_end`,
    [CLAN, E],
  );
  assert.equal(rows[0].n, 1, "the fixture has its inverted window");
  const body = await participation();
  const e = row(body, E);
  assert.equal(e.role, "elder");
  assert.equal(e.in_clan_at_war_finish[5], true);
  assert.equal(e.role_at_war_finish[5], null);
  assert.equal(e.role_changes.length, 3, "all three observations are served");
});

test("compact keeps the finish columns and drops role_changes", async () => {
  const body = await participation({ verbosity: "compact" });
  for (const m of [...body.members, ...body.former_members]) {
    assert.ok(!("role_changes" in m));
    assert.ok(!("war_points" in m));
    assert.equal(m.role_at_war_finish.length, body.war_weeks.length);
  }
});

test("a membership moved to another clan between reads leaves the finish between them unknown", () => {
  // Left here by another clan's read at T+1h; this clan's reads are T-2h
  // and T+3h, and the finish is T.
  const T = Date.parse("2026-09-14T09:35:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  const out = atWarFinishes({
    memberships: [
      {
        joined_observed_at: "2026-09-01T00:00:00Z",
        left_observed_at: iso(T + 3600_000),
        role: "member",
      },
    ],
    roleEvents: [],
    finishes: [
      {
        finish: iso(T),
        prev: iso(T - 2 * 3600_000),
        next: iso(T + 3 * 3600_000),
      },
      { finish: iso(T), prev: iso(T - 2 * 3600_000), next: null },
    ],
    roleSince: "2026-09-01T00:00:00Z",
  });
  assert.deepEqual(out.in_clan, [null, null]);
  assert.deepEqual(out.role, [null, null]);
});
