/**
 * The weekly tracking mail over a scratch database: attested facts never
 * enter it (review 2026-09-27 §6.8). A clan's attested facts are for the
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
import { buildTimeline } from "../../mcp/src/activity/entries.mjs";
import { buildTracking } from "../src/email/build-tracking.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_tracking_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const CLAN = "#2PQRJ8LV";
const LEADER = "#20QQL8CC";
const MEMBER = "#8QQ8QQ8Q";
const OPP = "#9RRYR9RR";
const FROM = new Date("2026-09-14T10:00:00Z");
const TO = new Date("2026-09-21T10:00:00Z");
const week = { from: FROM, to: TO, label: "Sep 14 to 21", key: "2026-W38" };
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
  // The recipient: a verified leader of the clan, tracking it too.
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [accountId, LEADER],
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
  // Until review 2026-09-27 §6.8 the mail read this timeline and filtered after the cap.
  assert.ok(!kinds.has("career_wins_step"), "the cap spent on facts");
});

test("a leader's tracking mail holds no attested kind, and the facts do not crowd out their moments", async () => {
  const mail = await buildTracking({
    db,
    account: { accountId, timezone: "UTC" },
    week,
    season: null,
  });
  assert.ok(mail?.primary, "the leader has a primary section");
  assert.ok(
    mail.primary.moments.some((m) => /career wins/.test(m.text)),
    `the career-wins moment survives the cap: ${JSON.stringify(mail.primary.moments)}`,
  );
  const body = JSON.stringify(mail);
  for (const kind of ATTESTED_FACT_KINDS)
    assert.ok(!body.includes(kind), `${kind} is not in the mail`);
  assert.ok(!/private line|away from|personal best/.test(body), body);
});
