/**
 * The digest (tracking_report, #767) over a scratch database: a followed
 * friend's highlight with their words and the battle's page, a nothing
 * window with no mail, and attested facts never entering it. A clan's attested facts are for the
 * people who read the clan's timeline, and an away is for a leader
 * reading it themselves, never a mail (DECISIONS, "Attested facts"). The
 * mail's moments are filtered BEFORE the timeline's 150-item cap, so a
 * busy clan's facts can neither reach the mail nor crowd its moments out.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ATTESTED_FACT_KINDS } from "@elixir-mcp/contracts";
import { migrate } from "../../migrate/src/migrate.mjs";
import { buildTimeline } from "../../../packages/tools/src/activity/entries.mjs";
import { buildDigest, digestWindow } from "../src/email/build-digest.mjs";
import { renderMail } from "../../../packages/mail/src/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_digest_mail_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const CLAN = "#2PQRJ8LV";
const LEADER = "#20QQL8CC";
const MEMBER = "#8QQ8QQ8Q";
const OPP = "#9RRYR9RR";
// A friend the leader follows, with a name a person typed to break mail.
const FRIEND = "#Q2L8P0YV";
const FRIEND_NAME = `<img src=x onerror=alert(1)>Stoat`;
const WORDS = `Three crowns <b>at last</b> & "finally"`;
const FROM = new Date("2026-09-14T10:00:00Z");
const TO = new Date("2026-09-21T10:00:00Z");
const window = { fromMs: FROM.getTime(), toMs: TO.getTime() };
// More clan facts than the timeline's cap, all newer than the moment.
const MESSAGES = 160;

let db, accountId;

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
  accountId = (
    await db.query(
      `insert into account (email_hash, status) values ('tracking-test', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Example')`, [
    CLAN,
  ]);
  for (const tag of [LEADER, MEMBER, OPP])
    await db.query(`insert into player (player_tag, name) values ($1, $1)`, [
      tag,
    ]);
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    FRIEND,
    FRIEND_NAME,
  ]);
  // The recipient: a verified leader of the clan, tracking it too.
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [accountId, LEADER],
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'unverified', false, 'friend', true)`,
    [accountId, FRIEND],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, '2026-08-01T00:00:00Z', 'leader'),
            ($1, $3, '2026-08-01T00:00:00Z', 'member')`,
    [CLAN, LEADER, MEMBER],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, notify) values ($1, $2, true)`,
    [accountId, CLAN],
  );
  // The leader's week: a battle and a career-wins moment early on.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b1', '2026-09-15T11:00:00Z', 'PvP', 'pvp', '2026-09-15T11:30:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class)
     values ('b1', $1, 0, '2026-09-15T11:00:00Z', 'win', 'PvP', 'pvp'),
            ('b1', $2, 1, '2026-09-15T11:00:00Z', 'loss', 'PvP', 'pvp')`,
    [LEADER, OPP],
  );
  // The friend's win, and their highlight of it with their own words,
  // posted by the friend's own account.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b2', '2026-09-16T20:00:00Z', 'PvP', 'pvp', '2026-09-16T20:30:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ('b2', $1, 0, '2026-09-16T20:00:00Z', 'win', 3, 'PvP', 'pvp'),
            ('b2', $2, 1, '2026-09-16T20:00:00Z', 'loss', 0, 'PvP', 'pvp')`,
    [FRIEND, OPP],
  );
  const poster = (
    await db.query(
      `insert into account (email_hash, status) values ('digest-friend', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into battle_highlight (player_tag, battle_id, account_id, words, created_at, updated_at)
     values ($1, 'b2', $2, $3, '2026-09-16T21:00:00Z', '2026-09-16T21:00:00Z')`,
    [FRIEND, poster, WORDS],
  );
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, value_after, step)
     values ($1, 'career_wins_step', 'estimated', '2026-09-15T10:00:00Z',
             '2026-09-15T12:00:00Z', 5000, 5000)`,
    [LEADER],
  );
  // Later in the week: a member's away (leaders only), clan chat lines
  // past the cap (clan), and a personal record for the leader (player).
  const fact = (kind, subject, player, detail, ref, at) =>
    db.query(
      `insert into attested_fact
         (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
          source, source_ref, attester_tag, attester_role, occurred_at, recorded_at)
       values ($1, $2, $3, $4, $5, 'clan', 'clan.poapkings.com', $6, $7,
               'leader', $8, $8)`,
      [
        subject,
        subject === "clan" ? CLAN : null,
        player,
        kind,
        detail,
        ref,
        LEADER,
        at,
      ],
    );
  await fact(
    "member_away",
    "clan",
    MEMBER,
    {},
    "away-1",
    "2026-09-17T09:00:00Z",
  );
  for (let i = 0; i < MESSAGES; i++)
    await fact(
      "clan_message",
      "clan",
      null,
      { channel: "clan_chat", body: `private line ${i}` },
      `chat-${i}`,
      new Date(Date.parse("2026-09-18T00:00:00Z") + i * 60_000).toISOString(),
    );
  await fact(
    "personal_record",
    "player",
    LEADER,
    { game: "Elixir Drop", score: 1234 },
    "record-1",
    "2026-09-19T09:00:00Z",
  );
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("control: unfiltered, the recipient's timeline carries the facts and the cap cuts the moment", async () => {
  const { timeline } = await buildTimeline(
    db,
    [
      { kind: "player", tag: LEADER, relationship: "primary" },
      { kind: "clan", tag: CLAN },
    ],
    {
      fromMs: FROM.getTime(),
      toMs: TO.getTime(),
      accountId,
      interactive: true,
    },
  );
  const kinds = new Set(timeline.map((it) => it.kind));
  for (const k of ["clan_message", "personal_record"])
    assert.ok(kinds.has(k), `${k} is on the timeline`);
  // The mail used to read this timeline and filter after the cap.
  assert.ok(!kinds.has("career_wins_step"), "the cap spent on facts");
});

test("a leader's digest holds no attested kind, and the facts do not crowd out their moments", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId, timezone: "UTC" },
    cadence: "weekly",
    window,
  });
  assert.ok(mail?.you, "the leader has their own week");
  assert.ok(
    mail.you.items.some((m) => /career wins/.test(m.text)),
    `the career-wins moment survives the cap: ${JSON.stringify(mail.you.items)}`,
  );
  const body = JSON.stringify(mail);
  for (const kind of ATTESTED_FACT_KINDS)
    assert.ok(!body.includes(kind), `${kind} is not in the mail`);
  assert.ok(!/private line|away from|personal best/.test(body), body);
});

test("a followed friend's highlight comes with their words and the battle's page, never their share link", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId, timezone: "UTC" },
    cadence: "weekly",
    window,
  });
  const friend = mail.people.find((p) => p.tag === FRIEND);
  assert.ok(friend, JSON.stringify(mail.people));
  assert.equal(friend.relationship, "friend");
  assert.equal(friend.battles, 1);
  const [h] = friend.items;
  assert.equal(h.kind, "battle_highlight");
  // The words as typed: escaping is the render's, at its output.
  assert.equal(h.words, WORDS);
  assert.match(h.text, /highlighted a 3-0 win/);
  assert.ok(
    !h.text.includes("at last"),
    "the words are not in the sentence too",
  );
  assert.match(String(h.battle_url), /\/battle\/b2$/);
  assert.ok(!("share_url" in h));
  assert.equal(mail.following, 1);
  // Rendered, the name and the words are text, never markup.
  const out = renderMail("tracking_report", mail, {
    unsubscribe: "https://elixir.example/u",
    manage: "/settings/emails",
    period: "2026-09-21",
    pixel: false,
  });
  assert.doesNotMatch(out.html, /<img src=x|<b>at last/);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;Stoat/);
  assert.match(
    out.html,
    /Three crowns &lt;b&gt;at last&lt;\/b&gt; &amp; &quot;finally&quot;/,
  );
});

test("a window where nothing happened is no mail", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId, timezone: "UTC" },
    cadence: "daily",
    window: digestWindow(new Date("2026-07-01T00:00:00Z"), "daily"),
  });
  assert.equal(mail, null);
});

test("the window: a week or a day back, starting no earlier than the last digest", () => {
  const now = new Date("2026-11-18T14:30:00Z");
  const day = 86400_000;
  assert.deepEqual(digestWindow(now, "weekly"), {
    fromMs: now.getTime() - 7 * day,
    toMs: now.getTime(),
  });
  assert.equal(digestWindow(now, "daily").fromMs, now.getTime() - day);
  // Yesterday's daily digest bounds today's weekly one: nothing twice.
  const last = new Date(now.getTime() - day + 60_000);
  assert.equal(digestWindow(now, "weekly", last).fromMs, last.getTime());
  // A digest older than the span leaves the span.
  assert.equal(
    digestWindow(now, "daily", new Date(now.getTime() - 3 * day)).fromMs,
    now.getTime() - day,
  );
});

// Readers of their own, so the leader's counts above stay as they are.
const W2 = {
  fromMs: Date.parse("2026-10-01T00:00:00Z"),
  toMs: Date.parse("2026-10-08T00:00:00Z"),
};
async function reader(label, claims) {
  const id = (
    await db.query(
      `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
      [`digest-${label}`],
    )
  ).rows[0].account_id;
  for (const [tag, relationship] of claims) {
    await db.query(
      `insert into player (player_tag, name) values ($1, $1) on conflict do nothing`,
      [tag],
    );
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
       values ($1, $2, $3, $4, $5, true)`,
      [
        id,
        tag,
        relationship === "friend" ? "unverified" : "verified",
        relationship === "primary",
        relationship,
      ],
    );
  }
  return id;
}

test("a followed player who only posted is told: a highlight of an older battle, with no battles in the window", async () => {
  const QUIET = "#2Y8Q0LPV";
  const POSTER = "#9PQJ2CUV";
  const id = await reader("post-only", [
    [QUIET, "primary"],
    [POSTER, "friend"],
  ]);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b3', '2026-08-20T20:00:00Z', 'PvP', 'pvp', '2026-08-20T20:30:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ('b3', $1, 0, '2026-08-20T20:00:00Z', 'win', 2, 'PvP', 'pvp')`,
    [POSTER],
  );
  await db.query(
    `insert into battle_highlight (player_tag, battle_id, account_id, words, created_at, updated_at)
     values ($1, 'b3', $2, 'Still my best game', '2026-10-03T12:00:00Z', '2026-10-03T12:00:00Z')`,
    [POSTER, id],
  );
  const mail = await buildDigest({
    db,
    account: { accountId: id, timezone: "UTC" },
    cadence: "weekly",
    window: W2,
  });
  assert.ok(mail, "a post alone is a digest");
  const [p] = mail.people;
  assert.equal(p.tag, POSTER);
  assert.equal(p.name, POSTER);
  assert.equal(p.battles, 0);
  assert.equal(p.items[0].kind, "battle_highlight");
  assert.equal(p.items[0].words, "Still my best game");
  assert.equal(mail.you, null, "a quiet reader with no alt has no line");
  const out = renderMail("tracking_report", mail, {
    unsubscribe: "https://elixir.example/u",
    manage: "/settings/emails",
    period: "2026-10-08",
    pixel: false,
  });
  assert.match(out.html, /No battles recorded/);
  assert.match(out.html, /Still my best game/);
});

test("an alt that played makes the reader's own stretch when the primary was quiet", async () => {
  const MAIN = "#LQ0G8YRV";
  const ALT = "#UV2C9JPQ";
  const id = await reader("alt-only", [
    [MAIN, "primary"],
    [ALT, "alt"],
  ]);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b4', '2026-10-04T18:00:00Z', 'PvP', 'pvp', '2026-10-04T18:20:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ('b4', $1, 0, '2026-10-04T18:00:00Z', 'win', 1, 'PvP', 'pvp')`,
    [ALT],
  );
  const mail = await buildDigest({
    db,
    account: { accountId: id, timezone: "UTC" },
    cadence: "weekly",
    window: W2,
  });
  assert.ok(mail, "an alt's battles are a digest");
  assert.deepEqual(mail.people, []);
  assert.equal(mail.you.tag, MAIN);
  assert.equal(mail.you.battles, 0);
  assert.deepEqual(
    mail.you.alts.map((a) => [a.tag, a.battles]),
    [[ALT, 1]],
  );
});
