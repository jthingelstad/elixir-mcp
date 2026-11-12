/**
 * The mail run over a scratch database: the
 * ledger is asked before anything is composed, a run stops with time to
 * spare and says how far it got, a written issue goes out only for its
 * own period, and the digest keeps its cadence. The clan report, Arena
 * week and milestone mails are retired (2026-11-12); their composers
 * are still pinned here until they are removed.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { runEmail } from "../src/email/index.mjs";
import {
  buildClan,
  lastBattlesOf,
  nothingHappened,
} from "../src/email/build-clan.mjs";
import { readerDoors } from "../src/email/reader.mjs";
import { clanReportPreview } from "../src/email/clan-preview.mjs";
import { lastGameWeek } from "../src/email/week.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_email_run_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const CLAN = "#2PQRJ8LV";
const OLD_TAG = "#20QQL8CC";
const NEW_TAG = "#8QQ8QQ8Q";
// A Thursday: the Top 100's send day.

let db;
const acct = {};

async function person(label, tag, createdAt, timezone) {
  const id = (
    await db.query(
      `insert into account (email_hash, email, status, timezone, created_at)
       values ($1, $2, 'approved', $3, $4) returning account_id`,
      [`h-${label}`, `${label}@example.com`, timezone, createdAt],
    )
  ).rows[0].account_id;
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    tag,
    label,
  ]);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [id, tag],
  );
  return id;
}

function sink() {
  const out = [];
  return { out, enqueue: async (m) => void out.push(m) };
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
  // The oldest account tracks the clan at activity scope, in Chicago;
  // a newer one asked for comprehensive, in UTC.
  acct.old = await person(
    "old",
    OLD_TAG,
    "2026-08-01T00:00:00Z",
    "America/Chicago",
  );
  acct.new = await person("new", NEW_TAG, "2026-09-01T00:00:00Z", null);
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Example')`, [
    CLAN,
  ]);
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope) values ($1, $3, 'activity'), ($2, $3, 'comprehensive')`,
    [acct.old, acct.new, CLAN],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, status, scope, requested_by)
     values ('clan', $1, 'active', 'comprehensive', $2)`,
    [CLAN, acct.new],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, '2026-09-08T03:00:00Z', 'member')`,
    [CLAN, NEW_TAG],
  );
  // Monday night in Chicago, Tuesday in UTC.
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, occurred_at, player_tag, role_after)
     values ($1, 'member_joined', 'estimated', '2026-09-08T03:00:00Z', '2026-09-08T03:00:00Z', '2026-09-08T03:00:00Z', $2, 'member')`,
    [CLAN, NEW_TAG],
  );
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a run asks the ledger first: an account already sent is not recomposed, and its issue keeps its facts", async () => {
  // A Wednesday: every weekly reader is due.
  const now = new Date("2026-09-23T14:30:00Z");
  const {
    rows: [{ issue_id }],
  } = await db.query(
    `insert into email_issue (kind, period_key, subject_key, facts, status)
     values ('tracking_report', $1, $2, '{"marker": true}', 'queued') returning issue_id`,
    ["2026-09-23", acct.old],
  );
  // Sent at its own hour, so a later digest's window starts after it.
  await db.query(
    `insert into email_send (send_id, issue_id, account_id, enqueued_at) values (gen_random_uuid(), $1, $2, $3)`,
    [issue_id, acct.old, now],
  );
  const { enqueue, out } = sink();
  const r = await runEmail({
    db,
    kind: "tracking_report",
    now,
    enqueue,
    secret: "s",
  });
  assert.equal(r.recipients, 2);
  assert.equal(r.already_sent, 1, JSON.stringify(r));
  assert.ok(!out.some((m) => m.to === "old@example.com"));
  const { rows } = await db.query(
    `select facts from email_issue where issue_id = $1`,
    [issue_id],
  );
  assert.deepEqual(rows[0].facts, { marker: true });
  assert.equal(typeof r.ms, "number");
  assert.equal(r.remaining, 0);
  assert.equal(r.incomplete, false);
});

test("a run with under 90 s left stops before composing, and says how many remain", async () => {
  const { enqueue, out } = sink();
  const r = await runEmail({
    db,
    kind: "tracking_report",
    now: new Date("2026-09-30T14:30:00Z"),
    enqueue,
    secret: "s",
    remainingMs: () => 60_000,
  });
  assert.equal(r.incomplete, true);
  assert.equal(r.remaining, 2);
  assert.equal(r.composed, 0);
  assert.equal(out.length, 0);
});

test("a clan report is the clan's, not its first tracker's: the same facts under either account, at the recording's scope", async () => {
  const week = lastGameWeek(new Date("2026-09-15T14:00:00Z"));
  const load = (id, timezone) =>
    buildClan({
      db,
      account: { accountId: id, timezone, kind: "person", role: "member" },
      clanTag: CLAN,
      week,
      season: null,
    });
  const asOld = await load(acct.old, "America/Chicago");
  const asNew = await load(acct.new, "UTC");
  assert.deepEqual(asOld, asNew);
  assert.equal(asOld.clan.scope, "comprehensive");
  assert.equal(asOld.roster_note, null);
  // A day is an instant; each reader's render names it.
  const joined = asOld.membership.joined.find((m) => m.tag === NEW_TAG);
  assert.equal(joined?.at, "2026-09-08T03:00:00.000Z");
  assert.equal(joined.when, undefined);
});

test("a silent clan's week has nothing to tell; a race, a departure or a battle does (D9, A20)", () => {
  const silent = {
    war: { present: false },
    membership: { joined: [], left: [], roles: [], more: 0 },
    headline: { battles: 0, donations: 0 },
    badges: [],
    presence: { quiet: [], returned: [] },
    week_moves: {
      top_battler: null,
      ranked: { items: [] },
      arena: { items: [] },
      bests: { items: [] },
    },
  };
  assert.equal(nothingHappened(silent), true);
  // Roster and war only: battles are unknown, not none, and still nothing.
  assert.equal(
    nothingHappened({ ...silent, headline: { battles: null, donations: 0 } }),
    true,
  );
  for (const news of [
    { war: { present: true, fame: 1 } },
    { membership: { ...silent.membership, left: [{ tag: "#X" }] } },
    { headline: { battles: 3, donations: 0 } },
    { badges: [{ name: "x" }] },
    { presence: { quiet: [{ name: "x" }], returned: [] } },
  ])
    assert.equal(nothingHappened({ ...silent, ...news }), false);
});

test("a reader's doors: their players and the clans they are in today", async () => {
  const doors = await readerDoors(db, acct.old);
  assert.ok(doors.tags.includes(OLD_TAG));
  const { rows } = await db.query(
    `select clan_tag from clan_membership
      where player_tag = $1 and left_observed_at is null`,
    [OLD_TAG],
  );
  assert.deepEqual(
    [...doors.memberClans].sort(),
    rows.map((r) => r.clan_tag).sort(),
  );
  // A name opens the player page for everyone (#764): no clanmate map.
  assert.equal(doors.clanmates, undefined);
});

test("an unverified claim on a member opens the clan's door and admits no clan-visible fact", async () => {
  const verified = await readerDoors(db, acct.new);
  assert.deepEqual(verified.verifiedClans, [CLAN]);
  await db.query(
    `update claim set status = 'unverified' where account_id = $1`,
    [acct.new],
  );
  try {
    const claimed = await readerDoors(db, acct.new);
    assert.deepEqual(claimed.memberClans, [CLAN]);
    assert.deepEqual(claimed.verifiedClans, []);
  } finally {
    await db.query(
      `update claim set status = 'verified' where account_id = $1`,
      [acct.new],
    );
  }
});

test("a last battle is read as of the week's close, its last instant included", async () => {
  const TAG = "#2YY2YY2Y";
  await db.query(`insert into player (player_tag, name) values ($1, 'quiet')`, [
    TAG,
  ]);
  const close = Date.parse("2026-09-14T09:59:59.999Z");
  const played = async (id, at) => {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class) values ($1, $2, 'PvP', 'pvp')`,
      [id, at],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class)
       values ($1, $2, 0, $3, 'win', 'PvP', 'pvp')`,
      [id, TAG, at],
    );
  };
  await played(`lb01${"0".repeat(60)}`, "2026-09-10T12:00:00Z");
  const asOf = async (ms) =>
    (await lastBattlesOf(db, [TAG], ms)).get(TAG) ?? null;
  assert.equal(await asOf(close), "2026-09-10T12:00:00.000Z");
  await played(`lb02${"0".repeat(60)}`, "2026-09-14T10:00:00Z");
  assert.equal(await asOf(close), "2026-09-10T12:00:00.000Z");
  assert.equal(await asOf(close + 1), "2026-09-14T10:00:00.000Z");
  assert.equal(await asOf(Date.parse("2026-09-01T00:00:00Z")), null);
});

test("the clan composer binds closed-race identity and uses the covered season after Monday's boundary", async () => {
  const NO_RACE = "#2GQ0QG0G";
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'No race recorded')`,
    [NO_RACE],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, 'comprehensive')`,
    [acct.old, NO_RACE],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, status, scope, requested_by) values ('clan', $1, 'active', 'comprehensive', $2)`,
    [NO_RACE, acct.old],
  );
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum, started_observed_at, finished_observed_at, closed_at)
    values ($1, 136, 3, true, '2026-09-28T10:00:00Z', '2026-10-05T09:38:05Z', '2026-10-05T09:38:04Z'),
           ($1, 137, 0, false, '2026-10-05T10:00:00Z', null, null)`,
    [CLAN],
  );
  await db.query(
    `insert into war_week_clan (clan_tag, season_id, section_index, participant_clan_tag, participant_name, fame, rank, trophy_change)
    values ($1, 136, 3, $1, 'Example', 12345, 1, 100)`,
    [CLAN],
  );
  await db.query(
    `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
    values ($1, 136, 3, $2, 2345, 16)`,
    [CLAN, NEW_TAG],
  );
  const week = lastGameWeek(new Date("2026-10-05T14:00:00Z"));
  const direct = await buildClan({
    db,
    account: {
      accountId: acct.old,
      timezone: "UTC",
      kind: "person",
      role: "member",
    },
    clanTag: CLAN,
    week,
    season: 137,
  });
  assert.deepEqual([direct.week.season, direct.week.war_week], [136, 4]);
  assert.deepEqual(
    [direct.war.rank, direct.war.fame, direct.war.trophy_change],
    [1, 12345, 100],
  );
  assert.equal(direct.war.raced[0].points, 2345);
});

test("Wednesday's digest names you on your player page", async () => {
  const BATTLE = `deed${"0".repeat(60)}`;
  // Learned when it was played: the digest reads what the record learned.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at) values ($1, '2026-10-01T12:00:00Z', 'PvP', 'pvp', '2026-10-01T12:05:00Z')`,
    [BATTLE],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class, crowns, trophy_change, starting_trophies)
    values ($1, $2, 0, '2026-10-01T12:00:00Z', 'win', 'PvP', 'pvp', 1, 29, 2000)`,
    [BATTLE, OLD_TAG],
  );
  const send = async (kind, at) => {
    const { out, enqueue } = sink();
    const result = await runEmail({
      db,
      kind,
      accountId: acct.old,
      now: new Date(at),
      enqueue,
      secret: "s",
    });
    assert.equal(result.failed, 0, JSON.stringify(result));
    assert.equal(out.length, 1, JSON.stringify(result));
    return out[0];
  };
  const digest = await send("tracking_report", "2026-10-07T14:30:00Z");
  // Every name opens the player page, the reader's own included (#764);
  // Ladder is reachable from there, so the digest carries no season.
  assert.match(digest.html, /\/home\/player\/20QQL8CC\?/);
  assert.doesNotMatch(digest.html, /\/ladder\?player=/);
});

test("the digest goes out weekly on Wednesday, daily to who chose it, once a day, and never to an opt-out or an empty week", async () => {
  const run = async (at, extra = {}) => {
    const { out, enqueue } = sink();
    const result = await runEmail({
      db,
      kind: "tracking_report",
      now: new Date(at),
      enqueue,
      secret: "s",
      ...extra,
    });
    return { result, out };
  };
  // A battle the old account played, learned a minute later.
  const played = async (at) => {
    const id = `dee${at.replace(/\D/g, "").padEnd(61, "0")}`;
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, created_at)
       values ($1, $2, 'PvP', 'pvp', $2::timestamptz + interval '1 minute')`,
      [id, at],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class, crowns)
       values ($1, $2, 0, $3, 'win', 'PvP', 'pvp', 1)`,
      [id, OLD_TAG, at],
    );
  };
  // A Thursday: a weekly reader waits for Wednesday.
  const thu = await run("2026-10-08T14:30:00Z");
  assert.equal(thu.out.length, 0, JSON.stringify(thu.result));
  // Choosing daily: the same Thursday sends, once.
  await db.query(
    `insert into account_email_pref (account_id, kind, enabled, cadence, via)
     values ($1, 'tracking_report', true, 'daily', 'profile')
     on conflict (account_id, kind) do update set cadence = 'daily'`,
    [acct.old],
  );
  await played("2026-10-08T09:00:00Z");
  const daily = await run("2026-10-08T14:30:00Z");
  assert.deepEqual(
    daily.out.map((m) => m.to),
    ["old@example.com"],
    JSON.stringify(daily.result),
  );
  assert.match(daily.out[0].html, /Your day in Elixir/);
  const again = await run("2026-10-08T15:30:00Z");
  assert.equal(again.out.length, 0);
  assert.equal(again.result.already_sent, 1);
  // The next day had nothing: never an empty mail.
  const quiet = await run("2026-10-09T14:30:00Z");
  assert.equal(quiet.out.length, 0, JSON.stringify(quiet.result));
  // Off stays off, whatever the cadence.
  await db.query(
    `update account_email_pref set enabled = false where account_id = $1 and kind = 'tracking_report'`,
    [acct.old],
  );
  await played("2026-10-10T09:00:00Z");
  const off = await run("2026-10-10T14:30:00Z");
  assert.equal(off.out.length, 0, JSON.stringify(off.result));
  await db.query(
    `delete from account_email_pref where account_id = $1 and kind = 'tracking_report'`,
    [acct.old],
  );
});

// Last: the clan it adds is one more report for the runs above.
test("the clan report's trend: decks used of those possible beside the races before, and battles by when they were played, only as far back as the record holds", async () => {
  const TREND = "#8YQ0LG2C";
  const [P1, P2, P3, P4] = ["#2Y2Y2Y2Y", "#2Y2Y2Y2C", "#2Y2Y2Y2G", "#2Y2Y2Y2L"];
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Trend')`, [
    TREND,
  ]);
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, 'comprehensive')`,
    [acct.new, TREND],
  );
  // Recorded from Thursday 09-03: the week of 08-31 is before it.
  await db.query(
    `insert into recording (subject_type, subject_tag, status, scope, requested_by, created_at)
     values ('clan', $1, 'active', 'comprehensive', $2, '2026-09-03T00:00:00Z')`,
    [TREND, acct.new],
  );
  for (const t of [P1, P2, P3, P4])
    await db.query(`insert into player (player_tag, name) values ($1, $1)`, [
      t,
    ]);
  // P3 joined, and P4 left, on 09-30: three on the roster at each close.
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values ($1, $2, '2026-08-25T00:00:00Z', null, 'member'),
            ($1, $3, '2026-08-25T00:00:00Z', null, 'member'),
            ($1, $4, '2026-09-30T00:00:00Z', null, 'member'),
            ($1, $5, '2026-08-25T00:00:00Z', '2026-09-30T00:00:00Z', 'member')`,
    [TREND, P1, P2, P3, P4],
  );
  // Five races: S136 week 4 (Colosseum) is the report's; week 2 was
  // never captured; S135 week 4 closed more than four weeks before.
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum, started_observed_at, finished_observed_at, closed_at)
     values ($1, 136, 3, true,  '2026-09-28T10:00:00Z', '2026-10-05T09:38:04Z', '2026-10-05T09:38:04Z'),
            ($1, 136, 2, false, '2026-09-21T10:00:00Z', '2026-09-28T09:35:00Z', '2026-09-28T09:35:00Z'),
            ($1, 136, 1, false, '2026-09-14T10:00:00Z', '2026-09-21T09:35:00Z', '2026-09-21T09:35:00Z'),
            ($1, 136, 0, false, '2026-09-07T10:00:00Z', '2026-09-14T09:35:00Z', '2026-09-14T09:35:00Z'),
            ($1, 135, 3, false, '2026-08-31T10:00:00Z', '2026-09-07T09:35:00Z', '2026-09-07T09:35:00Z'),
            ($1, 135, 2, false, '2026-08-24T10:00:00Z', '2026-08-31T09:35:00Z', '2026-08-31T09:35:00Z')`,
    [TREND],
  );
  const decks = [
    [136, 3, P1, 16],
    [136, 3, P2, 10],
    [136, 3, P3, 12],
    [136, 3, P4, 4], // played before leaving: used, not possible
    [136, 2, P1, 16],
    [136, 2, P2, 16],
    [136, 2, P4, 8],
    [136, 0, P1, 12],
    [136, 0, P2, 8],
    [136, 0, P4, 4],
    [135, 3, P1, 4],
    [135, 2, P1, 16],
  ];
  for (const [s, i, t, d] of decks)
    await db.query(
      `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
       values ($1, $2, $3, $4, $5, $6)`,
      [TREND, s, i, t, d * 100, d],
    );
  let k = 0;
  const battle = async (at, players, { boat } = {}) => {
    const id = `cafe${String(++k).padStart(60, "0")}`;
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, boat_battle_side)
       values ($1, $2, $3, $4, $5)`,
      [
        id,
        at,
        boat ? "boatBattle" : "PvP",
        boat ? "boat" : "pvp",
        boat ? "defender" : null,
      ],
    );
    for (const t of players)
      await db.query(
        `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class, crowns, clan_tag)
         values ($1, $2, 0, $3, 'win', $4, $5, 1, $6)`,
        [id, t, at, boat ? "boatBattle" : "PvP", boat ? "boat" : "pvp", TREND],
      );
  };
  // The report's week: two battles by two members; a boat defense is
  // not the member's battle.
  await battle("2026-09-30T12:00:00Z", [P1]);
  await battle("2026-10-02T12:00:00Z", [P1, P2]);
  await battle("2026-10-03T12:00:00Z", [P3], { boat: true });
  // Played in the week before, whenever it was learned.
  await battle("2026-09-22T12:00:00Z", [P1]);
  await battle("2026-09-23T12:00:00Z", [P2]);
  await battle("2026-09-24T12:00:00Z", [P2]);
  // Nothing the week of 09-14; one battle the week of 09-07; the week
  // of 08-31 is before the recording began.
  await battle("2026-09-08T12:00:00Z", [P1]);
  await battle("2026-09-01T12:00:00Z", [P1, P2]);

  const facts = await buildClan({
    db,
    account: {
      accountId: acct.new,
      timezone: "UTC",
      kind: "person",
      role: "member",
    },
    clanTag: TREND,
    week: lastGameWeek(new Date("2026-10-05T14:00:00Z")),
    season: 137,
  });
  assert.deepEqual(facts.trend.war, {
    this_week: {
      season: 136,
      week: 4,
      colosseum: true,
      decks_used: 42,
      decks_possible: 48,
      members: 3,
      war_days: 4,
    },
    // Week 2 holds no deck and S135 week 3 closed four weeks before;
    // S135 week 2 is further back.
    prior: [
      {
        season: 136,
        week: 3,
        colosseum: false,
        decks_used: 40,
        decks_possible: 48,
        members: 3,
        war_days: 4,
      },
      {
        season: 136,
        week: 1,
        colosseum: false,
        decks_used: 24,
        decks_possible: 48,
        members: 3,
        war_days: 4,
      },
      {
        season: 135,
        week: 4,
        colosseum: false,
        decks_used: 4,
        decks_possible: 48,
        members: 3,
        war_days: 4,
      },
    ],
  });
  assert.deepEqual(facts.trend.activity, {
    this_week: { battles: 2, active: 2 },
    prior: [
      { from: "2026-09-21T10:00:00.000Z", battles: 3, active: 2 },
      { from: "2026-09-07T10:00:00.000Z", battles: 1, active: 1 },
    ],
  });
  // The headline reads the same count.
  assert.equal(facts.headline.battles, 2);
  assert.equal(facts.headline.active, 2);

  // The read-only preview composes the same report and writes nothing.
  const issues = async () =>
    (await db.query(`select count(*)::int as n from email_issue`)).rows[0].n;
  const had = await issues();
  const preview = await clanReportPreview(
    { databaseUrl: DB_URL },
    { clan_tag: TREND, at: "2026-10-05T14:00:00Z" },
  );
  assert.equal(preview.stored, null);
  assert.deepEqual(preview.composed.trend, facts.trend);
  assert.match(
    preview.composed.text,
    /This race: 42 of 48 possible war decks used \(88%\), 6 not played\. Over the 3 recorded races before: 47%\./,
  );
  assert.match(
    preview.composed.text,
    /The 2 recorded weeks before averaged 2 battles a week, by 2 members\./,
  );
  assert.equal(await issues(), had);
  // The session it was handed is read-only while it runs, and given back.
  await clanReportPreview(
    { db },
    { clan_tag: TREND, at: "2026-10-05T14:00:00Z" },
  );
  await db.query(`select 1`);
  assert.equal(
    (await db.query(`show default_transaction_read_only`)).rows[0]
      .default_transaction_read_only,
    "off",
  );
});

test("an activity-scope clan composer leaves battle counts unknown", async () => {
  await db.query("begin");
  try {
    await db.query(
      "update recording set scope = 'activity' where subject_type = 'clan' and subject_tag = $1",
      [CLAN],
    );
    const facts = await buildClan({
      db,
      account: {
        accountId: acct.old,
        timezone: "UTC",
        kind: "person",
        role: "member",
      },
      clanTag: CLAN,
      week: lastGameWeek(new Date("2026-09-15T14:00:00Z")),
      season: null,
    });
    assert.equal(facts.clan.scope, "activity");
    assert.equal(facts.headline.battles, null);
    assert.equal(facts.headline.active, null);
  } finally {
    await db.query("rollback");
  }
});

test("the reports' week name is the season and which of its weeks", () => {
  // Season 136 opens on the first Monday of September 2026, at the reset.
  const first = lastGameWeek(new Date("2026-09-15T14:00:00Z"));
  assert.equal(first.from.toISOString(), "2026-09-07T10:00:00.000Z");
  assert.equal(first.season, 136);
  assert.equal(first.war_week, 1);
  const fourth = lastGameWeek(new Date("2026-10-05T14:00:00Z"));
  assert.equal(fourth.from.toISOString(), "2026-09-28T10:00:00.000Z");
  assert.equal(fourth.season, 136);
  assert.equal(fourth.war_week, 4);
});
