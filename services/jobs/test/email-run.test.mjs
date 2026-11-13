/**
 * The mail run over a scratch database: the
 * ledger is asked before anything is composed, a run stops with time to
 * spare and says how far it got, a written issue goes out only for its
 * own period, and the digest keeps its cadence.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runEmail } from "../src/email/index.mjs";
import { readerDoors } from "../src/email/reader.mjs";
import { lastGameWeek } from "../src/email/week.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_email_run_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const CLAN = "#0QC8RCGY";
const OLD_TAG = "#0LCLRCPQ";
const NEW_TAG = "#0J8CVLL8";

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
  await createScratch(NAME);
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
  await dropScratch(NAME);
});

test("a run asks the ledger first: an account already sent is not recomposed, and its issue keeps its facts", async () => {
  // A Monday, after the reset: every weekly reader is due.
  const now = new Date("2026-09-21T11:00:00Z");
  const {
    rows: [{ issue_id }],
  } = await db.query(
    `insert into email_issue (kind, period_key, subject_key, facts, status)
     values ('tracking_report', $1, $2, '{"marker": true}', 'queued') returning issue_id`,
    ["2026-09-21", acct.old],
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
    now: new Date("2026-09-28T11:00:00Z"),
    enqueue,
    secret: "s",
    remainingMs: () => 60_000,
  });
  assert.equal(r.incomplete, true);
  assert.equal(r.remaining, 2);
  assert.equal(r.composed, 0);
  assert.equal(out.length, 0);
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

test("an unverified claim on a member still opens the clan's door", async () => {
  await db.query(
    `update claim set status = 'unverified' where account_id = $1`,
    [acct.new],
  );
  try {
    const claimed = await readerDoors(db, acct.new);
    assert.deepEqual(claimed.memberClans, [CLAN]);
  } finally {
    await db.query(
      `update claim set status = 'verified' where account_id = $1`,
      [acct.new],
    );
  }
});

test("Monday's digest names you on your player page", async () => {
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
  const digest = await send("tracking_report", "2026-10-05T11:00:00Z");
  // Every name opens the player page, the reader's own included (#764);
  // Ladder is reachable from there, so the digest carries no season.
  assert.match(digest.html, /\/home\/player\/0LCLRCPQ\?/);
  assert.doesNotMatch(digest.html, /\/ladder\?player=/);
});

test("the digest goes out weekly on Monday, daily to who chose it, once a day, and never to an opt-out or an empty week", async () => {
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
  // A Thursday: a weekly reader waits for Monday.
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
