import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { betaPulse, isoWeek } from "../src/beta-pulse.mjs";

/**
 * The beta pulse's aggregation on a scratch database (golden rule 9):
 * cohorts by ISO signup week, each step counted once per account, the
 * came-back windows by UTC day after signup, staff and their +tag test
 * mailboxes left out and counted apart, agents and integrations never
 * counted, mail sends per kind per week, and no account named anywhere in
 * the answer.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;
const NAME = `elixir_mcp_test_beta_pulse_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
let db;

// Thursday 2026-10-08 18:00Z: the running week starts Monday 10-05
// (2026-W41); eight weeks back starts Monday 08-17 (2026-W34).
const NOW = new Date("2026-10-08T18:00:00Z");

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
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

let n = 0;
async function person(
  createdAt,
  { email = null, role = "member", status = "approved" } = {},
) {
  n += 1;
  const { rows } = await db.query(
    `insert into account (email_hash, email, status, role, created_at)
     values ($1, $2, $3, $4, $5) returning account_id`,
    [`hash-${n}`, email ?? `person${n}@example.com`, status, role, createdAt],
  );
  return rows[0].account_id;
}
const event = (accountId, kind, at, detail = {}) =>
  db.query(
    `insert into account_event (account_id, kind, detail, created_at) values ($1, $2, $3, $4)`,
    [accountId, kind, JSON.stringify(detail), at],
  );
async function player(tag) {
  await db.query(
    `insert into player (player_tag) values ($1) on conflict do nothing`,
    [tag],
  );
}
async function claim(
  accountId,
  tag,
  { primary = true, verified = false } = {},
) {
  await player(tag);
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, verified_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      accountId,
      tag,
      verified ? "verified" : "unverified",
      primary,
      primary ? "primary" : "friend",
      verified ? NOW : null,
    ],
  );
}

test("isoWeek names the ISO week of a Monday, across a year's edge", () => {
  assert.equal(isoWeek("2026-10-05"), "2026-W41");
  assert.equal(isoWeek("2026-08-17"), "2026-W34");
  assert.equal(isoWeek("2025-12-29"), "2026-W01");
  assert.equal(isoWeek("2027-01-04"), "2027-W01");
  assert.equal(isoWeek("2026-12-28"), "2026-W53");
});

test("the pulse counts each signup week's steps, leaves staff and test mailboxes out, and names nobody", async () => {
  // Staff: the owner and an admin, and the owner's +tag test mailbox.
  const owner = await person("2026-10-06T10:00:00Z", {
    email: "Boss@Example.org",
    role: "owner",
  });
  await person("2026-10-06T11:00:00Z", {
    email: "helper@example.net",
    role: "admin",
  });
  const tester = await person("2026-10-07T09:00:00Z", {
    email: "boss+beta1@example.org",
  });
  await claim(tester, "#9GG");
  // An agent and an integration the owner runs: never counted.
  await db.query(
    `insert into account (status, role, kind, owned_by_account_id, public_id, created_at)
     values ('approved', 'member', 'agent', $1, 'agentpulse', '2026-10-06T12:00:00Z'),
            ('approved', 'member', 'integration', $1, 'integpulse', '2026-10-06T12:00:00Z')`,
    [owner],
  );
  // A denied request, and a signup older than the window: not counted.
  await person("2026-10-06T13:00:00Z", { status: "denied" });
  await person("2026-08-10T13:00:00Z");

  // Week 2026-W40 (Sep 28): three people.
  // A: the whole funnel, back on day 3 (a sign-in) and day 10 (a call).
  const a = await person("2026-09-29T20:00:00Z");
  await claim(a, "#2PQ", { verified: true });
  await event(a, "claim_added", "2026-09-29T20:01:00Z");
  await event(a, "claim_verified", "2026-09-30T08:00:00Z");
  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, snapshot_kind, profile_observed_at, source)
     values ('#2PQ', '2026-09-29', 'daily', '2026-09-29T20:05:00Z', 'api')`,
  );
  await db.query(
    `insert into battlelog_high_water (observer_tag, battle_time) values ('#2PQ', '2026-09-29T19:00:00Z')`,
  );
  await db.query(`insert into clan (clan_tag) values ('#2CC'), ('#2LL')`);
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, auto_followed_at) values ($1, '#2CC', 'activity', now())`,
    [a],
  );
  await event(a, "signed_in", "2026-09-29T20:00:00Z"); // the signup itself
  await event(a, "signed_in", "2026-10-02T07:00:00Z"); // day 3
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, created_at)
     values ($1, 'web', 'players_profile', '2026-10-09T01:00:00Z')`,
    [a],
  ); // day 10, after NOW: the week-2 window is still open
  // B: added a friend (no primary), followed a clan by hand, then
  // stopped tracking it (the event keeps the step); back only on the
  // signup day, which is not a later day.
  const b = await person("2026-10-01T09:00:00Z");
  await claim(b, "#2PY", { primary: false });
  await event(b, "clan_added", "2026-10-01T09:10:00Z", {
    clan_tag: "#2LL",
    auto: false,
  });
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, created_at)
     values ($1, 'mcp', 'players_profile', '2026-10-01T23:59:00Z')`,
    [b],
  );
  // C: nothing after signing up, except a session last seen on day 1.
  const c = await person("2026-10-04T23:30:00Z");
  await db.query(
    `insert into session (session_id, account_id, created_at, last_seen_at, sliding_expires_at, absolute_expires_at)
     values ('s-c', $1, '2026-10-04T23:30:00Z', '2026-10-05T00:10:00Z', now() + interval '1 day', now() + interval '1 day')`,
    [c],
  );

  // Week 2026-W41 (Oct 5): one person, primary set, no capture yet.
  const d = await person("2026-10-07T15:00:00Z");
  await claim(d, "#2RR");
  // An agent's calls on day 1 are not its owner coming back.
  const dAgent = (
    await db.query(
      `insert into account (status, role, kind, owned_by_account_id, public_id, created_at)
       values ('approved', 'member', 'agent', $1, 'agentofd', '2026-09-01T00:00:00Z')
       returning account_id`,
      [d],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into mcp_call_audit (account_id, surface, tool, created_at)
     values ($1, 'mcp', 'players_profile', '2026-10-08T10:00:00Z')`,
    [dAgent],
  );

  // Mail: two clan reports and an arena mail in W40, one in W41; a
  // send to the test mailbox is not counted.
  const issue = async (kind, period) =>
    (
      await db.query(
        `insert into email_issue (kind, period_key, subject_key, status)
         values ($1, $2, $3, 'queued') returning issue_id`,
        [kind, period, `${kind}-${period}`],
      )
    ).rows[0].issue_id;
  const send = (issueId, accountId, at) =>
    db.query(
      `insert into email_send (issue_id, account_id, enqueued_at, send_id)
       values ($1, $2, $3, gen_random_uuid())`,
      [issueId, accountId, at],
    );
  const clanW40 = await issue("clan", "2026-W40");
  await send(clanW40, a, "2026-09-30T14:00:00Z");
  await send(clanW40, b, "2026-09-30T14:00:00Z");
  await send(clanW40, tester, "2026-09-30T14:00:00Z");
  await send(await issue("arena", "2026-W40"), a, "2026-10-01T14:00:00Z");
  await send(await issue("clan", "2026-W41"), a, "2026-10-06T14:00:00Z");

  const pulse = await betaPulse(db, { now: NOW });

  assert.equal(pulse.since, "2026-08-17");
  assert.equal(pulse.weeks.length, 8);
  assert.deepEqual(
    pulse.weeks.map((w) => w.week),
    [
      "2026-W34",
      "2026-W35",
      "2026-W36",
      "2026-W37",
      "2026-W38",
      "2026-W39",
      "2026-W40",
      "2026-W41",
    ],
  );
  const w40 = pulse.weeks.find((w) => w.week === "2026-W40");
  assert.deepEqual(
    { ...w40, week: undefined, starts: undefined },
    {
      week: undefined,
      starts: undefined,
      signed_up: 3,
      added_player: 2,
      primary_set: 1,
      profile: 1,
      battles: 1,
      clan_followed: 2,
      clan_auto: 1,
      verified: 1,
      came_back_week1: 2, // A by a sign-in on day 3, C by a session seen on day 1
      week1_open: 2, // B is on day 7 today, C on day 4
      came_back_week2: 0, // A's day-10 call is after NOW
      week2_open: 3,
    },
  );
  const w41 = pulse.weeks.find((w) => w.week === "2026-W41");
  assert.equal(
    w41.signed_up,
    1,
    "staff, the test mailbox, agents, integrations and denied are out",
  );
  assert.equal(w41.primary_set, 1);
  assert.equal(w41.profile, 0);
  assert.equal(w41.came_back_week1, 0, "an agent's calls are not its owner");
  assert.equal(w41.week1_open, 1);
  assert.equal(pulse.totals.signed_up, 4);
  assert.equal(pulse.weeks[0].signed_up, 0);
  assert.deepEqual(pulse.excluded, { staff: 2, test: 1 });

  // The day-10 call lands once NOW moves past it.
  const later = await betaPulse(db, {
    now: new Date("2026-10-20T00:00:00Z"),
  });
  const w40Later = later.weeks.find((w) => w.week === "2026-W40");
  assert.equal(w40Later.came_back_week2, 1);
  assert.equal(w40Later.week2_open, 0);

  assert.deepEqual(
    pulse.mail.weeks,
    pulse.weeks.map((w) => w.week),
  );
  const clan = pulse.mail.kinds.find((k) => k.kind === "clan");
  assert.deepEqual(
    clan.sends.slice(-2),
    [2, 1],
    "the test mailbox's send is out",
  );
  const arena = pulse.mail.kinds.find((k) => k.kind === "arena");
  assert.deepEqual(arena.sends.slice(-2), [1, 0]);
  assert.equal(pulse.opens.measured_here, false);

  // Aggregate only: no id, address or tag in the answer.
  const text = JSON.stringify(pulse);
  for (const id of [owner, tester, a, b, c, d, dAgent])
    assert.ok(!text.includes(id), "no account id");
  assert.ok(!text.includes("@"), "no address");
  assert.ok(!/#[0289PYLQGRJCUV]{3,}/.test(text), "no tag");
});
