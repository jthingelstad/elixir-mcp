/**
 * Clan's Feed (slice 8, #766) over a scratch database (golden rule 9): the
 * clan's timeline for one member, newest first, carrying the posts about
 * battles (highlights until 0292) of the clan's current members (a member
 * who has left is not in it), each post once, as the post it is, each
 * item as the Timeline draws it (2026-11-17) without Home's own fields;
 * none of the reader's own account items. Synthetic tags only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readClanFeed, FEED_DAYS, isClanNews } from "../src/clan-feed.mjs";

const T = Date.parse("2026-11-12T12:00:00Z");
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
const CLAN = "#0QC8RCGY";
const READER = "#0LCLRCPQ";
const STAYED = "#0QU8VGV";
const LEFT = "#0PPPQVL";

let ctx;
let db;
let reader;

async function playerWithPost(tag, name, battleId, words, leftAt) {
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    tag,
    name,
  ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values ($1, $2, $3, $4, 'member')`,
    [CLAN, tag, at(T - 40 * 24 * H), leftAt],
  );
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $2)`,
    [battleId, at(T - 5 * H)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side,
       type, type_class, crowns, trophy_change, outcome)
     values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [battleId, tag, at(T - 5 * H)],
  );
  const owner = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ($1, 'approved', 'UTC') returning account_id`,
      [`feed-${name}`],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [owner, tag],
  );
  await db.query(
    `insert into account_post (item_id, player_tag, battle_id, account_id, body, created_at)
     values ('tl_' || substr(md5(random()::text), 1, 20), $1, $2, $3, $4, $5)`,
    [tag, battleId, owner, words, at(T - 4 * H)],
  );
}

before(async () => {
  ctx = await scratchDb("clan_feed");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
    [CLAN],
  );
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Reader')`,
    [READER],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, $3, 'member')`,
    [CLAN, READER, at(T - 40 * 24 * H)],
  );
  reader = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ('feed-reader', 'approved', 'UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [reader, READER],
  );
  await playerWithPost(STAYED, "Stays", "feed-1", "Three crowns", null);
  await playerWithPost(LEFT, "Gone", "feed-2", "Old words", at(T - 2 * H));
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, occurred_at, window_start, window_end, player_tag, role_after)
     values ($1, 'member_joined', 'exact', $2, $2, $2, $3, 'member')`,
    [CLAN, at(T - 3 * H), STAYED],
  );
});

after(async () => {
  await ctx?.drop();
});

test("feed: current members' posts about battles, drawn as the Timeline draws them, never a member who has left", async () => {
  const feed = await readClanFeed(
    db,
    { accountId: reader, timezone: "UTC", kind: "person" },
    CLAN,
    T,
  );
  assert.equal(feed.clan_tag, CLAN);
  assert.equal(feed.window_days, FEED_DAYS);
  assert.equal(typeof feed.more, "number");
  // One item for each post: the post, never the record's line beside it.
  assert.equal(
    feed.items.filter((it) => it.kind === "battle_highlight").length,
    0,
  );
  const posts = feed.items.filter((it) => it.kind === "post");
  assert.deepEqual(
    posts.map((it) => it.post.text),
    ["Three crowns"],
  );
  const [h] = posts;
  assert.equal(h.subject_tag, STAYED);
  assert.equal(h.post.battle.battle_id, "feed-1");
  assert.equal(
    h.clan_news,
    false,
    "member writing remains All activity, not clan news",
  );
  assert.equal(
    feed.items.find((it) => it.kind === "member_joined").clan_news,
    true,
  );
  assert.match(h.id, /^tl_[0-9a-f]{20}$/);
  assert.ok(Date.parse(h.at));
  for (const it of feed.items) {
    // Private Home choices stay there. Canonical source classification
    // and social identity stay attached on Clan's normal Timeline too.
    const own = ["groups", "offer_follow"];
    for (const k of own) assert.ok(!(k in it), `no ${k} on Clan's Feed`);
    if (it.kind !== "post") assert.equal(typeof it.section, "string");
    assert.deepEqual(it.cheers, {});
    assert.equal(it.my_cheer, null);
    assert.equal(it.item_ref.item_id, it.id);
  }
  // Newest first.
  const times = feed.items.map((it) => Date.parse(it.at)).filter(Boolean);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
});

test("Clan news is roster/race news or a clan fact, without changing visibility or the item", () => {
  for (const kind of [
    "member_joined",
    "member_left",
    "member_role_changed",
    "bracket_observed",
    "race_finished",
    "week_resolved",
    "departure_classified",
    "clan_message",
    "award_granted",
    "member_away",
  ])
    assert.equal(isClanNews({ kind }), true, kind);
  for (const kind of [
    "post",
    "battle_session",
    "badge_earned",
    "returned",
    "personal_record",
    "account_mail_sent",
    "unknown",
  ])
    assert.equal(isClanNews({ kind }), false, kind);
  const leadersOnly = {
    kind: "member_away",
    visibility: "leaders",
    id: "same-story",
  };
  assert.equal(isClanNews(leadersOnly), true);
  assert.deepEqual(leadersOnly, {
    kind: "member_away",
    visibility: "leaders",
    id: "same-story",
  });
});

test("Clan news filters before the cap, so member moments cannot hide a roster change", async () => {
  const who = { accountId: reader, timezone: "UTC", kind: "person" };
  const before = await readClanFeed(db, who, CLAN, T);
  const arrival = before.items.find((it) => it.kind === "member_joined");
  await db.query(
    `insert into player_event (player_tag, event_type, timing, window_start, window_end, badge_name, level)
     select $1, 'badge_earned', 'estimated', $2::timestamptz + g * interval '1 second',
            $2::timestamptz + g * interval '1 second', 'Fixture badge ' || g, 5
       from generate_series(1, 101) g`,
    [STAYED, at(T - 2 * H)],
  );
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, player_tag, role_before, role_after)
     select $1, 'role_changed', 'estimated', $2::timestamptz + g * interval '1 second',
            $2::timestamptz + g * interval '1 second', $3,
            case when g % 2 = 1 then 'member' else 'elder' end,
            case when g % 2 = 1 then 'elder' else 'member' end
       from generate_series(1, 50) g`,
    [CLAN, at(T - H), STAYED],
  );
  const all = await readClanFeed(db, who, CLAN, T);
  assert.ok(all.more > 0);
  assert.equal(
    all.items.some((it) => it.kind === "member_joined"),
    false,
  );
  const news = await readClanFeed(db, who, CLAN, T, { view: "news" });
  assert.equal(news.view, "news");
  assert.equal(news.more, 0);
  assert.equal(news.items.length, 51);
  assert.ok(news.items.every((it) => it.clan_news));
  // The focused read serves the very same story, not a new event.
  assert.equal(
    news.items.find((it) => it.kind === "member_joined").id,
    arrival.id,
  );
});
