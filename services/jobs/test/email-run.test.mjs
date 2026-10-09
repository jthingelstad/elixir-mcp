/**
 * The mail run over a scratch database: the
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

test("card unlocks and badge levels never mail on their own; a new form does, as its art (Jamie, 2026-10-08)", async () => {
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
       (player_tag, event_type, timing, window_start, window_end, card_id, badge_name, level)
     values ($1, 'card_unlocked', 'estimated', $2, $3, 26000047, null, null),
            ($1, 'card_unlocked', 'estimated', $2, $3, 26000006, null, null),
            ($1, 'badge_earned', 'estimated', $2, $3, null, 'MasteryArrows', 10)`,
    [TAG, ...at],
  );
  const run = async (now) => {
    const { enqueue, out } = sink();
    const r = await runEmail({
      db,
      kind: "milestone",
      now: new Date(now),
      enqueue,
      secret: "s",
      accountId: id,
    });
    return { r, out };
  };
  const quiet = await run("2026-09-23T18:20:00Z");
  assert.equal(quiet.r.sent, 0, JSON.stringify(quiet.r));
  assert.equal(quiet.out.length, 0);
  // A form is a big first: it mails, as its own art, and the unlocks
  // beside it stay out of the mail (the Arena week counts them).
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, card_id, step)
     values ($1, 'card_form_unlocked', 'estimated', $2, $3, 26000021, 1)`,
    [TAG, "2026-09-23T19:00:00Z", "2026-09-23T19:10:00Z"],
  );
  const { r, out } = await run("2026-09-23T19:20:00Z");
  assert.equal(r.sent, 1, JSON.stringify(r));
  const { html } = out[0];
  assert.ok(html.includes("/assets/cards/26000021_evo.png"));
  assert.match(html, new RegExp(`href="[^"]*/cards/26000021\\?`));
  for (const file of ["26000047", "26000006"])
    assert.ok(!html.includes(`/assets/cards/${file}.png`), file);
  assert.doesNotMatch(html, /Arrows Mastery/);
  const { rows } = await db.query(
    `select kind from email_milestone where account_id = $1`,
    [id],
  );
  assert.deepEqual(
    rows.map((x) => x.kind),
    ["card_form_unlocked"],
  );
});

test("an unlock-only week sends no milestone mail and Tuesday's Arena week counts it; an arena first mails", async () => {
  const TAG = "#8YQQ2PLL";
  const id = await person("digest", TAG, "2026-09-01T00:00:00Z", null);
  await db.query(
    `insert into card (card_id, name, kind, rarity) values
       (26000030, 'Ice Spirit', 'card', 'common'),
       (26000047, 'Royal Recruits', 'card', 'common'),
       (26000006, 'Balloon', 'card', 'epic')
     on conflict (card_id) do nothing`,
  );
  const BATTLE = `d16e${"0".repeat(60)}`;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ($1, '2026-10-08T12:00:00Z', 'PvP', 'pvp')`,
    [BATTLE],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class, crowns, trophy_change, starting_trophies)
     values ($1, $2, 0, '2026-10-08T12:00:00Z', 'win', 'PvP', 'pvp', 1, 29, 2000)`,
    [BATTLE, TAG],
  );
  const at = ["2026-10-08T12:00:00Z", "2026-10-08T12:30:00Z"];
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, card_id, badge_name, level)
     values ($1, 'card_unlocked', 'estimated', $2, $3, 26000030, null, null),
            ($1, 'card_unlocked', 'estimated', $2, $3, 26000047, null, null),
            ($1, 'card_unlocked', 'estimated', $2, $3, 26000006, null, null),
            ($1, 'badge_earned', 'estimated', $2, $3, null, 'MasteryArrows', 4),
            ($1, 'badge_earned', 'estimated', $2, $3, null, 'MasteryArrows', 5)`,
    [TAG, ...at],
  );
  const send = async (kind, now) => {
    const { enqueue, out } = sink();
    const r = await runEmail({
      db,
      kind,
      now: new Date(now),
      enqueue,
      secret: "s",
      accountId: id,
    });
    return { r, out };
  };
  const hourly = await send("milestone", "2026-10-08T13:20:00Z");
  assert.equal(hourly.r.sent, 0, JSON.stringify(hourly.r));
  // An arena first, the same day: it mails, and only it.
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end,
        arena_from, arena_to, arena_to_name)
     values ($1, 'arena_changed', 'exact', '2026-10-08T14:00:00Z', '2026-10-08T14:00:00Z', 11, 12, 'Spell Valley')`,
    [TAG],
  );
  const arenaFirst = await send("milestone", "2026-10-08T14:20:00Z");
  assert.equal(arenaFirst.r.sent, 1, JSON.stringify(arenaFirst.r));
  assert.match(arenaFirst.out[0].subject, /Spell Valley/);
  assert.doesNotMatch(arenaFirst.out[0].html, /Ice Spirit|Mastery/);
  // Tuesday: the week's unlocks and badge levels, as counts.
  const tuesday = await send("arena_week", "2026-10-13T14:00:00Z");
  assert.equal(tuesday.r.sent, 1, JSON.stringify(tuesday.r));
  assert.match(tuesday.out[0].html, /3 cards unlocked, 2 badge levels/);
  assert.match(tuesday.out[0].html, /\/console\/account\/timeline\?/);
});

test("a legendary badge mails when it happens and is not counted on Tuesday; a badge level only counts (Jamie, 2026-10-08)", async () => {
  const TAG = "#2LQQ9PYV";
  const id = await person("legendary", TAG, "2026-09-01T00:00:00Z", null);
  const BATTLE = `1e9e${"0".repeat(60)}`;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ($1, '2026-10-08T12:00:00Z', 'PvP', 'pvp')`,
    [BATTLE],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class, crowns, trophy_change, starting_trophies)
     values ($1, $2, 0, '2026-10-08T12:00:00Z', 'win', 'PvP', 'pvp', 1, 29, 2000)`,
    [BATTLE, TAG],
  );
  const send = async (kind, now) => {
    const { enqueue, out } = sink();
    const r = await runEmail({
      db,
      kind,
      now: new Date(now),
      enqueue,
      secret: "s",
      accountId: id,
    });
    return { r, out };
  };
  // A badge level alone: no mail.
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, badge_name, level)
     values ($1, 'badge_earned', 'estimated', '2026-10-08T12:00:00Z', '2026-10-08T12:30:00Z', 'MasteryArrows', 5)`,
    [TAG],
  );
  const level = await send("milestone", "2026-10-08T13:20:00Z");
  assert.equal(level.r.sent, 0, JSON.stringify(level.r));
  // A legendary badge: it mails, by the badge's name, and only it.
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, badge_name)
     values ($1, 'legendary_badge_earned', 'estimated', '2026-10-08T14:00:00Z', '2026-10-08T14:10:00Z', 'BeatingDeathBadge')`,
    [TAG],
  );
  const legendary = await send("milestone", "2026-10-08T14:20:00Z");
  assert.equal(legendary.r.sent, 1, JSON.stringify(legendary.r));
  const { html } = legendary.out[0];
  assert.match(html, /You earned Beating Death/);
  assert.match(html, /A legendary badge\./);
  assert.doesNotMatch(html, /Arrows Mastery/);
  const { rows } = await db.query(
    `select kind, moment_key from email_milestone where account_id = $1`,
    [id],
  );
  assert.deepEqual(rows, [
    { kind: "legendary_badge_earned", moment_key: "badge:BeatingDeathBadge" },
  ]);
  // Once ever: the next look sends nothing.
  const again = await send("milestone", "2026-10-08T15:20:00Z");
  assert.equal(again.r.sent, 0, JSON.stringify(again.r));
  // Tuesday counts the badge level, never the legendary badge it mailed.
  const tuesday = await send("arena_week", "2026-10-13T14:00:00Z");
  assert.equal(tuesday.r.sent, 1, JSON.stringify(tuesday.r));
  assert.match(tuesday.out[0].html, /1 badge level\b/);
  assert.doesNotMatch(tuesday.out[0].html, /legendary badge/i);
});

test("a form the art mirror lacks reaches the mail as the base card's art", async () => {
  // 2026-10-08: Supercell lists a new form about two weeks before its
  // image answers, and a mail client cannot fall back as a page does.
  const TAG = "#9QQ2GG8R";
  const id = await person("form-art", TAG, "2026-09-01T00:00:00Z", null);
  await db.query(
    `insert into card (card_id, name, kind, rarity) values
       (26000021, 'Hog Rider', 'card', 'rare')
     on conflict (card_id) do nothing`,
  );
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, card_id, step)
     values ($1, 'card_form_unlocked', 'estimated', $2, $3, 26000021, 1)`,
    [TAG, "2026-09-23T17:00:00Z", "2026-09-23T18:00:00Z"],
  );
  const { enqueue, out } = sink();
  const asked = [];
  const r = await runEmail({
    db,
    kind: "milestone",
    now: new Date("2026-09-23T18:20:00Z"),
    enqueue,
    secret: "s",
    accountId: id,
    cardArt: async (p) => {
      asked.push(p);
      return false;
    },
  });
  assert.equal(r.sent, 1, JSON.stringify(r));
  const { html } = out[0];
  assert.deepEqual(asked, ["/assets/cards/26000021_evo.png"]);
  assert.ok(html.includes("/assets/cards/26000021.png"));
  assert.ok(!html.includes("/assets/cards/26000021_evo.png"));
  assert.match(html, /alt="Evo Hog Rider"/);
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
  // The Ladder link names the season the milestone happened in, from
  // game_clock at its instant (2026-10-08).
  assert.match(html, /\/ladder\?player=2RQQ9LG8&amp;season=1\d\d&amp;/);
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
