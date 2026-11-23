/**
 * The RSS feed reads Home's stored week (readFeedWeek, 2026-11-22), and
 * what it may carry is decided at the read, never by what was stored:
 * Home's week is built interactively and with people lines, the feed's is
 * neither. Pinned here with a leader, the reader for whom the two differ:
 * a leaders-only fact (member_away) and a people line are in Home and
 * never in the feed, whatever the row holds. A poll is a select of the
 * row, wakes a build past FRESH, builds once past SERVE, and is not a
 * read of Home (read_at stays).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  HOME_FRESH_MS,
  HOME_SERVE_MS,
  readFeedWeek,
  readHomeWeek,
} from "../src/activity/home-feed.mjs";

const CLAN = "#0CPP";
const MEMBER = "#08U2";
const LEADER = "#02YQ";
let ctx, leader;

const row = async () =>
  (
    await ctx.db.query(
      `select built_at, read_at, items from home_feed where account_id = $1`,
      [leader],
    )
  ).rows[0];
const kinds = (week) => week.items.map((it) => it.kind);

before(async () => {
  ctx = await scratchDb("feed_week");
  const db = ctx.db;
  leader = (
    await db.query(
      `insert into account(email_hash,status,kind,timezone)
       values ('feed-week-leader','approved','person','UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query("insert into clan(clan_tag,name) values ($1,'Example Clan')", [
    CLAN,
  ]);
  for (const [tag, name, role] of [
    [MEMBER, "Invented Member", "member"],
    [LEADER, "Invented Leader", "leader"],
  ]) {
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at)
       values ($1,$2,$3,'2026-11-01T00:00:00Z')`,
      [CLAN, tag, role],
    );
  }
  await db.query(
    `insert into claim(account_id,player_tag,is_primary,relationship,status)
     values ($1,$2,true,'primary','verified')`,
    [leader, LEADER],
  );
  await db.query(
    `insert into account_clan(account_id,clan_tag) values ($1,$2)`,
    [leader, CLAN],
  );
  // One fact the clan sees and one only its leaders do, an hour ago.
  for (const [type, detail, visibility] of [
    [
      "award_standing",
      {
        award: "Example award",
        award_id: "example-award",
        season_id: 137,
        place: 1,
        value: 4,
        unit: "donations",
        as_of: new Date().toISOString(),
      },
      "clan",
    ],
    ["member_away", { until: null }, "leaders"],
  ])
    await db.query(
      `insert into attested_fact
       (subject_kind,clan_tag,player_tag,fact_type,detail,visibility,
        source,source_ref,attester_account_id,attester_tag,attester_role,
        occurred_at,recorded_at)
       values ('clan',$1,$2,$3,$4,$5,'clan.poapkings.com',$3,$6,$7,'leader',
               now() - interval '1 hour', now() - interval '1 hour')`,
      [CLAN, MEMBER, type, detail, visibility, leader, LEADER],
    );
});
after(async () => ctx?.drop());

test("the feed's week leaves out what Home's adds: a leaders-only fact", async () => {
  const feed = await readFeedWeek(ctx.db, leader, { timezone: "UTC" });
  assert.equal(feed.stored, false, "no row yet: the poll builds it");
  assert.ok(kinds(feed).includes("award_standing"), "the clan's fact");
  assert.equal(kinds(feed).includes("member_away"), false);

  // The poll stored Home's week and is not a read of Home.
  const stored = await row();
  assert.ok(stored, "the build is stored");
  assert.equal(stored.read_at, null);

  // The same reader on Home sees the leaders-only fact: the fixture
  // really distinguishes the two.
  const home = await readHomeWeek(ctx.db, leader, { timezone: "UTC" });
  assert.equal(home.stored, true, "Home serves the row the poll stored");
  assert.ok(kinds(home).includes("member_away"));
});

test("a poll serves the stored row, and the row cannot widen the feed", async () => {
  // Whatever the row holds: a stored story is served, a people line and a
  // stored leaders-only fact are not.
  const at = new Date(Date.now() - 60_000).toISOString();
  const item = (id, extra) => ({
    id,
    revision: 1,
    at,
    observed_at: at,
    sort_at: at,
    subject_tag: LEADER,
    subjects: [{ kind: "player", tag: LEADER, name: "Invented Leader" }],
    text: id,
    ...extra,
  });
  await ctx.db.query(
    `update home_feed set items = items || $2::jsonb where account_id = $1`,
    [
      leader,
      JSON.stringify([
        item("st_stored_story", { kind: "arena_changed", section: "moments" }),
        item("st_people_line", { kind: "account_place", section: "people" }),
        item("st_stale_leaders_fact", {
          kind: "member_away",
          section: "attested",
        }),
      ]),
    ],
  );
  const before = await row();
  const feed = await readFeedWeek(ctx.db, leader, { timezone: "UTC" });
  assert.equal(feed.stored, true);
  const ids = feed.items.map((it) => it.id);
  assert.ok(ids.includes("st_stored_story"));
  assert.equal(ids.includes("st_people_line"), false);
  assert.equal(ids.includes("st_stale_leaders_fact"), false);
  assert.equal(kinds(feed).includes("member_away"), false);
  assert.ok(kinds(feed).includes("award_standing"), "facts are read live");
  assert.deepEqual((await row()).built_at, before.built_at, "no rebuild");
});

test("past FRESH the poll serves the row and wakes a build; past SERVE it builds", async () => {
  const age = (ms) =>
    ctx.db.query(
      `update home_feed set built_at = now() - ($2 || ' milliseconds')::interval
        where account_id = $1`,
      [leader, String(ms)],
    );
  const woken = [];
  const wake = async (accountId) => woken.push(accountId);

  await age(HOME_FRESH_MS - 60_000);
  await readFeedWeek(ctx.db, leader, { timezone: "UTC", wake });
  assert.deepEqual(woken, [], "a fresh row needs no build");

  await age(HOME_FRESH_MS + 60_000);
  const stale = await readFeedWeek(ctx.db, leader, { timezone: "UTC", wake });
  assert.equal(stale.stored, true, "served while the build is asked for");
  assert.deepEqual(woken, [leader]);

  await age(HOME_SERVE_MS + 60_000);
  const old = await readFeedWeek(ctx.db, leader, { timezone: "UTC", wake });
  assert.equal(old.stored, false, "too old to serve: built now");
  assert.equal(
    old.items.some((it) => it.id === "st_stored_story"),
    false,
    "the rebuilt row is the record's",
  );
  assert.ok(Date.now() - (await row()).built_at.getTime() < 60_000);

  // Another time zone is another week: never the row built for this one.
  const other = await readFeedWeek(ctx.db, leader, {
    timezone: "America/Chicago",
  });
  assert.equal(other.stored, false);
});
