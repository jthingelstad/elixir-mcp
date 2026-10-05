/**
 * The mail run over a scratch database (review 2026-09-27 §6.7): the
 * ledger is asked before anything is composed, a run stops with time to
 * spare and says how far it got, a second milestone on one UTC day is a
 * second mail, a written issue goes out only for its own period, and a
 * clan report is the same whoever tracked the clan first.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  runEmail,
  milestoneFromMs,
  milestonePeriodKey,
} from "../src/email/index.mjs";
import { buildClan } from "../src/email/build-clan.mjs";
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

test("a weekly run asks the ledger first: an account already sent is not recomposed, and its issue keeps its facts", async () => {
  const now = new Date("2026-09-22T14:00:00Z");
  const week = lastGameWeek(now);
  const {
    rows: [{ issue_id }],
  } = await db.query(
    `insert into email_issue (kind, period_key, subject_key, facts, status)
     values ('arena_week', $1, $2, '{"marker": true}', 'queued') returning issue_id`,
    [week.key, acct.old],
  );
  await db.query(
    `insert into email_send (send_id, issue_id, account_id) values (gen_random_uuid(), $1, $2)`,
    [issue_id, acct.old],
  );
  const { enqueue, out } = sink();
  const r = await runEmail({
    db,
    kind: "arena_week",
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
    now: new Date("2026-09-23T14:00:00Z"),
    enqueue,
    secret: "s",
    remainingMs: () => 60_000,
  });
  assert.equal(r.incomplete, true);
  assert.equal(r.remaining, 2);
  assert.equal(r.composed, 0);
  assert.equal(out.length, 0);
});

test("two milestones on one UTC day are two mails; the same moments again are not", async () => {
  const step = (n, from, to) =>
    db.query(
      `insert into player_event
         (player_tag, event_type, timing, window_start, window_end, value_after, step)
       values ($1, 'career_wins_step', 'estimated', $2, $3, $4, $4)`,
      [NEW_TAG, from, to, n],
    );
  const run = (at) => {
    const { enqueue, out } = sink();
    return runEmail({
      db,
      kind: "milestone",
      now: new Date(at),
      enqueue,
      secret: "s",
      accountId: acct.new,
    }).then((r) => ({ r, out }));
  };
  await step(5000, "2026-09-15T08:00:00Z", "2026-09-15T09:00:00Z");
  const first = await run("2026-09-15T09:20:00Z");
  assert.equal(first.r.sent, 1, JSON.stringify(first.r));
  await step(6000, "2026-09-15T14:00:00Z", "2026-09-15T15:00:00Z");
  const second = await run("2026-09-15T15:20:00Z");
  assert.equal(second.r.sent, 1, JSON.stringify(second.r));
  const third = await run("2026-09-15T16:20:00Z");
  assert.equal(third.r.sent, 0);
  const { rows } = await db.query(
    `select period_key from email_issue where kind = 'milestone' order by composed_at`,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.period_key.startsWith("2026-09-15.")));
  // The campaign period on the pixel and links stays the date.
  assert.match(first.out[0].html, /path=%2Fmail%2Fmilestone%2F2026-09-15"/);
});

test("the milestone key is the moments', not the order they came in", () => {
  const a = { subject_tag: "#A", kind: "badge_earned", key: "badge:x" };
  const b = { subject_tag: "#A", kind: "career_wins_step", key: "wins:5000" };
  const now = new Date("2026-09-15T09:20:00Z");
  assert.equal(
    milestonePeriodKey(now, [a, b]),
    milestonePeriodKey(now, [b, a]),
  );
  assert.notEqual(milestonePeriodKey(now, [a]), milestonePeriodKey(now, [b]));
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

// Last: the account it adds would be one more recipient for the tests above.
test("a moment from a day the milestone job failed is mailed by the next run that works (#130)", async () => {
  const TAG = "#9GGQ9QQ9";
  const id = await person("gap", TAG, "2026-09-01T00:00:00Z", null);
  const step = (n, from, to) =>
    db.query(
      `insert into player_event
         (player_tag, event_type, timing, window_start, window_end, value_after, step)
       values ($1, 'career_wins_step', 'estimated', $2, $3, $4, $4)`,
      [TAG, from, to, n],
    );
  const run = (at, enqueue = sink().enqueue) =>
    runEmail({
      db,
      kind: "milestone",
      now: new Date(at),
      enqueue,
      secret: "s",
      accountId: id,
    });
  const lookedAt = async () =>
    (
      await db.query(
        `select looked_at from email_milestone_look where account_id = $1`,
        [id],
      )
    ).rows[0]?.looked_at?.toISOString() ?? null;

  // A clean look with nothing new: the window's anchor moves.
  const quiet = await run("2026-09-19T09:20:00Z");
  assert.equal(quiet.sent, 0);
  assert.equal(await lookedAt(), "2026-09-19T09:20:00.000Z");

  await step(7000, "2026-09-19T10:00:00Z", "2026-09-19T11:00:00Z");
  // The next run fails at the send: nothing recorded, the anchor stays.
  const broken = await run("2026-09-19T11:20:00Z", async () => {
    throw new Error("queue down");
  });
  assert.equal(broken.failed, 1, JSON.stringify(broken));
  assert.equal(await lookedAt(), "2026-09-19T09:20:00.000Z");

  // Two days of nothing, then a run that works: 52 hours after the
  // moment, past the old fixed 26 hours, and it is mailed.
  const { enqueue, out } = sink();
  const back = await run("2026-09-21T15:20:00Z", enqueue);
  assert.equal(back.sent, 1, JSON.stringify(back));
  assert.match(out[0].subject, /7,000/);
  assert.equal(await lookedAt(), "2026-09-21T15:20:00.000Z");

  // Mailed once: the next look is quiet.
  const again = await run("2026-09-21T16:20:00Z");
  assert.equal(again.sent, 0);
});

test("cards unlocked reach the mail as their art, each a link to its page; a form as its own art", async () => {
  const TAG = "#9QQ2GG8Q";
  const id = await person("cards", TAG, "2026-09-01T00:00:00Z", null);
  await db.query(
    `insert into card (card_id, name, kind, rarity) values
       (26000047, 'Royal Recruits', 'card', 'common'),
       (26000006, 'Balloon', 'card', 'epic'),
       (26000021, 'Hog Rider', 'card', 'rare')
     on conflict (card_id) do nothing`,
  );
  const at = ["2026-09-23T17:00:00Z", "2026-09-23T18:00:00Z"];
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, card_id, step)
     values ($1, 'card_unlocked', 'estimated', $2, $3, 26000047, null),
            ($1, 'card_unlocked', 'estimated', $2, $3, 26000006, null),
            ($1, 'card_form_unlocked', 'estimated', $2, $3, 26000021, 1)`,
    [TAG, ...at],
  );
  const { enqueue, out } = sink();
  const r = await runEmail({
    db,
    kind: "milestone",
    now: new Date("2026-09-23T18:20:00Z"),
    enqueue,
    secret: "s",
    accountId: id,
  });
  assert.equal(r.sent, 1, JSON.stringify(r));
  const { html } = out[0];
  for (const file of ["26000047-285", "26000006-285", "26000021_evo-285"])
    assert.ok(html.includes(`/assets/cards/${file}.png`), file);
  for (const card of [26000047, 26000006, 26000021])
    assert.match(html, new RegExp(`href="[^"]*/cards/${card}\\?`));
  assert.match(html, />Epic</);
  assert.match(html, /You unlocked three cards/);
});

test("the battle that did it links its page, the short id battles_query hands out", async () => {
  const TAG = "#2RQQ9LG8";
  const OPP = "#2PGQ8Y0L";
  const id = await person("arena", TAG, "2026-09-01T00:00:00Z", null);
  await db.query(
    `insert into player (player_tag, name) values ($1, 'SparkSanji')`,
    [OPP],
  );
  const BATTLE = `aad68079b0fa${"0".repeat(52)}`;
  const at = "2026-09-24T17:00:00Z";
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class)
     values ($1, $2, 'PvP', 'pvp')`,
    [BATTLE, at],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, side, battle_time, outcome, type, type_class,
        crowns, trophy_change, starting_trophies)
     values ($1, $2, 0, $4, 'win', 'PvP', 'pvp', 1, 29, 1992),
            ($1, $3, 1, $4, 'loss', 'PvP', 'pvp', 0, -29, 1991)`,
    [BATTLE, TAG, OPP, at],
  );
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end,
        arena_from, arena_to, arena_to_name, battle_id)
     values ($1, 'arena_changed', 'exact', $2, $2, 10, 11, 'Royal Arena', $3)`,
    [TAG, at, BATTLE],
  );
  const { enqueue, out } = sink();
  const r = await runEmail({
    db,
    kind: "milestone",
    now: new Date("2026-09-24T17:20:00Z"),
    enqueue,
    secret: "s",
    accountId: id,
  });
  assert.equal(r.sent, 1, JSON.stringify(r));
  const { html } = out[0];
  assert.match(html, /The battle that did it/);
  assert.match(html, /SparkSanji/);
  assert.match(
    html,
    /href="https:\/\/elixir\.poapkings\.com\/battle\/aad68079b0fa\?[^"]*"[^>]*>See the battle ›/,
  );
  assert.match(html, /\/ladder\?player=2RQQ9LG8/);
});

test("the milestone window reaches back to the last clean look, never more than seven days", () => {
  const now = new Date("2026-09-21T15:20:00Z");
  const h = 3600_000;
  // No look on record: the 26 hours it always read.
  assert.equal(milestoneFromMs(now, null), now.getTime() - 26 * h);
  // An hour since the last look: 26 hours before it.
  assert.equal(
    milestoneFromMs(now, new Date(now.getTime() - h)),
    now.getTime() - 27 * h,
  );
  // Ten days since: capped at seven.
  assert.equal(
    milestoneFromMs(now, new Date(now.getTime() - 240 * h)),
    now.getTime() - 168 * h,
  );
  // A look stamped after now (a clock step) reads as now.
  assert.equal(
    milestoneFromMs(now, new Date(now.getTime() + h)),
    now.getTime() - 26 * h,
  );
});

test("rollover mail binds closed-race identity and uses the covered season before, at and after Monday's boundary", async () => {
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
  const run = async (at) => {
    const { out, enqueue } = sink();
    const result = await runEmail({
      db,
      kind: "clan_report",
      accountId: acct.old,
      now: new Date(at),
      enqueue,
      secret: "s",
    });
    assert.equal(result.failed, 0, JSON.stringify(result));
    return { result, out };
  };
  const before = await run("2026-10-05T09:59:59.999Z");
  assert.equal(before.out.length, 2);
  assert.ok(before.out.every((m) => /Sep 21 – 28 · Season 136/.test(m.html)));
  const boundary = await run("2026-10-05T10:00:00Z");
  assert.equal(boundary.out.length, 2);
  assert.ok(
    boundary.out.every((m) => /Sep 28 – Oct 5 · Season 136/.test(m.html)),
  );
  assert.ok(boundary.out.some((m) => /river race week 4/.test(m.html)));
  const facts = (
    await db.query(
      `select facts from email_issue where kind='clan_report' and period_key=$1 order by subject_key`,
      [week.key],
    )
  ).rows;
  assert.ok(facts.every((r) => r.facts.week.season === 136));
  const again = await run("2026-10-05T14:00:00Z");
  assert.equal(again.result.already_sent, 2);
  assert.equal(again.result.composed, 0);
  assert.equal(again.out.length, 0);
  assert.deepEqual(
    (
      await db.query(
        `select facts from email_issue where kind='clan_report' and period_key=$1 order by subject_key`,
        [week.key],
      )
    ).rows,
    facts,
  );
});

test("Tuesday Arena and Wednesday friends mail keep the same previous covered season after rollover", async () => {
  const BATTLE = `deed${"0".repeat(60)}`;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ($1, '2026-10-01T12:00:00Z', 'PvP', 'pvp')`,
    [BATTLE],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class, crowns, trophy_change, starting_trophies)
    values ($1, $2, 0, '2026-10-01T12:00:00Z', 'win', 'PvP', 'pvp', 1, 29, 2000)`,
    [BATTLE, OLD_TAG],
  );
  for (const [kind, at] of [
    ["arena_week", "2026-10-06T14:00:00Z"],
    ["tracking_report", "2026-10-07T14:00:00Z"],
  ]) {
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
    assert.match(out[0].html, /Sep 28 – Oct 5 · Season 136/);
    assert.doesNotMatch(out[0].html, /Sep 28 – Oct 5 · Season 137/);
  }
});
