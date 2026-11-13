/**
 * Home's reads and Friends' Follow, against a real PostgreSQL database. The
 * head paints the page, each panel reads alone, a failed panel says so and the
 * rest render; a Follow never makes anyone the person's primary.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { emitEvent } from "../../../packages/ingest/src/events.mjs";
import {
  seedDeck,
  seedPlayedDeck,
} from "../../../packages/tools/test/deck-rows.mjs";
import { gameWeekStartMs } from "@elixir-mcp/record/form";
import { lastGameWeek } from "@elixir-mcp/record/game-week";
import { makeRegistry } from "@elixir-mcp/tools";
import { buildFriendsWeek, featuredDeck } from "@elixir-mcp/tools/friends-week";
import {
  buildTimeline,
  shownAt,
  subjectsFor,
} from "@elixir-mcp/tools/activity/entries";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest } from "../src/clan.mjs";
import {
  inOwnWords,
  openingMode,
  panel,
  readWeek,
  shapeClan,
} from "../src/routes/home.mjs";

const CLAN = "#9GQLV20";
const OWN = "#9GQLV22";
const FRIEND = "#2YG98VVQ";
const WATCHED = "#PYLQGRJC";
const NEWCOMER_FRIEND = "#9VUP08YL";

let scratch, handler, clanFails;
const sessions = new Map();
const data = (r) => JSON.parse(r.body);

async function person(hash) {
  const id = (
    await scratch.db.query(
      "insert into account(email_hash,status) values ($1,'approved') returning account_id",
      [hash],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  return id;
}
const call = (door, id, method, path, body) =>
  door({
    path,
    method,
    headers: {
      ...(id ? { cookie: `__Host-elixir_session=${sessions.get(id)}` } : {}),
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

before(async () => {
  scratch = await scratchDb("home");
  const { db } = scratch;
  for (const [tag, name] of [
    [OWN, "Player"],
    [FRIEND, "Friend"],
    [WATCHED, "Watched"],
    [NEWCOMER_FRIEND, "Other"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  await db.query("insert into clan(clan_tag,name) values ($1,'Clan')", [CLAN]);
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    clan: createClanRequest({ origin: "https://elixir.poapkings.com" }),
  });
  clanFails = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    clan: async () => {
      throw new Error("clan down");
    },
  });
});
after(async () => scratch.drop());

test("every Home route wants a signed-in person", async () => {
  for (const path of [
    "/api/me/home",
    "/api/me/home/needs",
    "/api/me/home/clan",
    "/api/me/home/week",
    "/api/me/home/friends",
  ])
    assert.equal((await call(handler, null, "GET", path)).statusCode, 401);
});

test("no player: Home answers the first answer alone, Friends says to add yours", async () => {
  const id = await person("home-empty");
  const home = await call(handler, id, "GET", "/api/me/home");
  assert.equal(home.statusCode, 200, home.body);
  assert.deepEqual(Object.keys(data(home)), ["first"]);
  assert.equal(data(home).first.ok, true);
  assert.equal(data(home).first.player, null);
  const friends = await call(handler, id, "GET", "/api/me/home/friends");
  assert.deepEqual(data(friends), { no_player: true });
  assert.equal(
    (await call(handler, id, "GET", "/api/me/home/week")).statusCode,
    404,
  );
});

test("Follow with no player of your own asks for yours first and writes nothing", async () => {
  const id = await person("home-follow-first");
  const r = await call(handler, id, "POST", "/api/claims", {
    player_tag: FRIEND,
    relationship: "friend",
  });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(data(r).error, "no_own_player");
  const { rows } = await scratch.db.query(
    "select 1 from claim where account_id = $1",
    [id],
  );
  assert.equal(rows.length, 0);
});

test("Follow adds a Friend and never touches the primary", async () => {
  const id = await person("home-follow");
  const own = await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  assert.equal(own.statusCode, 200, own.body);
  const add = await call(handler, id, "POST", "/api/claims", {
    player_tag: FRIEND,
    relationship: "friend",
  });
  assert.equal(add.statusCode, 200, add.body);
  assert.equal(data(add).relationship, "friend");
  const again = await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    relationship: "friend",
  });
  assert.equal(data(again).relationship, "primary", "yours stays yours");
  const asPrimary = await call(handler, id, "POST", "/api/claims", {
    player_tag: NEWCOMER_FRIEND,
    relationship: "friend",
    make_primary: true,
  });
  assert.equal(asPrimary.statusCode, 400, "a friend is never the primary");
  const { rows } = await scratch.db.query(
    "select player_tag, relationship, is_primary from claim where account_id = $1 order by player_tag",
    [id],
  );
  assert.deepEqual(
    rows.map((r) => [r.player_tag, r.relationship, r.is_primary]).sort(),
    [
      [FRIEND, "friend", false],
      [OWN, "primary", true],
    ].sort(),
  );
});

test("Follow of someone watched makes them a Friend", async () => {
  const id = await person("home-follow-watched");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  await scratch.db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'watching',false)`,
    [id, WATCHED],
  );
  const r = await call(handler, id, "POST", "/api/claims", {
    player_tag: WATCHED,
    relationship: "friend",
  });
  assert.equal(data(r).relationship, "friend");
});

test("Friends: nobody played, the same week as the mail's, both lists honest", async () => {
  const id = await person("home-friends");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  await call(handler, id, "POST", "/api/claims", {
    player_tag: FRIEND,
    relationship: "friend",
  });
  const r = await call(handler, id, "GET", "/api/me/home/friends");
  assert.equal(r.statusCode, 200, r.body);
  const body = data(r);
  assert.match(body.week.label, /\d/);
  assert.deepEqual(body.friends, []);
  assert.deepEqual(body.watching, []);
  assert.deepEqual(
    body.quiet.map((q) => [q.tag, q.relationship]),
    [[FRIEND, "friend"]],
  );
});

// A friend who played last game week: one Trophy Road win, one war loss.
const DECK = [
  [26000007, "Witch"],
  [26000021, "Hog Rider"],
  [26000000, "Knight"],
  [26000010, "Skeletons"],
  [28000011, "The Log"],
  [26000014, "Musketeer"],
  [27000000, "Cannon"],
  [28000001, "Arrows"],
].map(([id, name]) => ({ id, name, level: 14 }));
const TOWER = [{ id: 159000000, name: "Tower Princess" }];
let seeded = 0;
async function played(tag, id) {
  const { db } = scratch;
  const at = new Date(lastGameWeek(new Date()).from.getTime() + 3600_000);
  const stamp = at.toISOString();
  await db.query(
    "insert into player(player_tag,name) values ($1,'Friend') on conflict do nothing",
    [tag],
  );
  for (const [type, outcome] of [
    ["PvP", "win"],
    ["riverRacePvP", "loss"],
  ]) {
    const battle = `home-${++seeded}`;
    const hash = await seedDeck(db, {
      battle_time: stamp,
      cards: DECK,
      supportCards: TOWER,
    });
    await db.query(
      "insert into battle (battle_id,battle_time,created_at,type,type_class,game_mode_name,event_tag) values ($1,$2,$2,$3,'pvp',$4,null)",
      [battle, stamp, type, "Ladder"],
    );
    await db.query(
      `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time,crowns,deck_hash,type,type_class,deck_avg_level,opp_deck_avg_level)
       values ($1,$2,0,$3,$4,0,$5,$6,'pvp',14,13)`,
      [battle, tag, outcome, stamp, hash, type],
    );
    await seedPlayedDeck(db, {
      battle_id: battle,
      player_tag: tag,
      battle_time: stamp,
      cards: DECK,
      supportCards: TOWER,
    });
  }
  await call(handler, id, "POST", "/api/claims", {
    player_tag: tag,
    relationship: "friend",
  });
}
const RECORD = [
  { mode: "ladder", battles: 1, wins: 1, losses: 0 },
  { mode: "war", battles: 1, wins: 0, losses: 1 },
];
const byMode = (rows) => [...rows].sort((a, b) => a.mode.localeCompare(b.mode));

test("Friends: past the request's deadline a friend keeps their record and loses only the deck", async () => {
  const id = await person("home-deadline");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  await played("#2YG98VV0", id);
  const r = await handler({
    path: "/api/me/home/friends",
    method: "GET",
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    softDeadlineAt: 1,
  });
  assert.equal(r.statusCode, 200, r.body);
  const [friend] = data(r).friends;
  assert.equal(friend.deck, null);
  assert.deepEqual(byMode(friend.by_family), RECORD);
});

test("Friends: past the ten-card cap a friend keeps their record and loses only the deck", async () => {
  const id = await person("home-cap");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  const tags = Array.from(
    { length: 11 },
    (_, n) => `#PYLQGR${"029CGJLPQRU"[n]}Y`,
  );
  for (const tag of tags) await played(tag, id);
  const r = await call(handler, id, "GET", "/api/me/home/friends");
  assert.equal(r.statusCode, 200, r.body);
  const { friends } = data(r);
  assert.equal(friends.length, 11);
  for (const f of friends) assert.deepEqual(byMode(f.by_family), RECORD);
  assert.equal(friends.filter((f) => f.deck).length, 10);
});

test("the mail's mark of a card stays the builder's: past the deadline no by_family, so it draws a line", async () => {
  const id = await person("home-mail");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  await played("#2YG98VV2", id);
  const week = lastGameWeek(new Date());
  const facts = await buildFriendsWeek({
    db: scratch.db,
    account: { accountId: id, timezone: "UTC", kind: "person" },
    week,
    season: week.season,
    callTool: async () => null,
    within: () => false,
  });
  assert.equal(facts.friends[0].by_family, undefined);
  assert.deepEqual(byMode(facts.friends[0].mode_records), RECORD);
});

test("a friend's deck is the one battles_decks reads for its hash, in two tool calls, not three", async () => {
  const id = await person("home-deck-identity");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: OWN,
    make_primary: true,
  });
  await played("#2YG98VV8", id);
  const week = lastGameWeek(new Date());
  const registry = makeRegistry();
  const calls = [];
  const facts = await buildFriendsWeek({
    db: scratch.db,
    account: { accountId: id, timezone: "UTC", kind: "person" },
    week,
    season: week.season,
    callTool: (ctx, name, args) => {
      calls.push({ name, args });
      return registry.invoke(name, ctx, args);
    },
    within: () => true,
  });
  const [friend] = facts.friends;
  const perFriend = calls.filter((c) => c.args?.player_tag === "#2YG98VV8");
  assert.deepEqual(
    perFriend.map((c) => c.name),
    ["battles_performance", "battles_decks"],
  );
  // The deck as the third call drew it before 2026-11-09: the tool asked
  // for the one deck, by its hash, over the same window.
  const ctx = {
    db: scratch.db,
    account: { accountId: id, timezone: "UTC", kind: "person" },
    live: null,
    notifyOwner: async () => {},
  };
  const list = perFriend[1];
  const top = (await registry.invoke("battles_decks", ctx, list.args)).decks[0];
  const window = { ...list.args };
  delete window.limit;
  const full = await registry.invoke("battles_decks", ctx, {
    ...window,
    deck_hash: top.deck_hash,
  });
  const before = featuredDeck(top, full.decks[0]);
  assert.ok(before?.cards.length === 8 && before.tower_troop);
  assert.deepEqual(friend.deck, before);
});

test("a failed clan panel says so and the rest of Home still renders", async () => {
  const id = await person("home-partial");
  await scratch.db.query(
    `insert into claim(account_id,player_tag,status,relationship,is_primary)
     values ($1,$2,'verified','primary',true)`,
    [id, OWN],
  );
  await scratch.db.query(
    `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at)
     values ($1,$2,'leader',now()) on conflict do nothing`,
    [CLAN, OWN],
  );
  await scratch.db.query(
    `insert into account_clan(account_id,clan_tag,scope) values ($1,$2,'activity')
     on conflict do nothing`,
    [id, CLAN],
  );
  const head = await call(clanFails, id, "GET", "/api/me/home");
  assert.equal(head.statusCode, 200, head.body);
  assert.deepEqual(Object.keys(data(head)), ["first"]);
  assert.equal(data(head).first.ok, true);
  const failed = await call(clanFails, id, "GET", "/api/me/home/clan");
  assert.equal(failed.statusCode, 200, failed.body);
  assert.equal(data(failed).clan.ok, false);
  const noNeeds = await call(clanFails, id, "GET", "/api/me/home/needs");
  assert.equal(noNeeds.statusCode, 200, noNeeds.body);
  assert.equal(data(noNeeds).needs.ok, false);
  const week = data(await call(clanFails, id, "GET", "/api/me/home/week")).week;
  assert.equal(week.ok, true);
  assert.equal(week.record.battles, 0);

  // The same person through Clan's real door: a leader's card.
  const whole = await call(handler, id, "GET", "/api/me/home/clan");
  const clan = data(whole).clan;
  assert.equal(clan.ok, true, whole.body);
  assert.equal(clan.state, "member");
  assert.equal(clan.role, "leader");
  assert.equal(clan.standing, null, "a leader has no standing row");
  assert.deepEqual(clan.needs, []);

  // Needs you through the same door and no record read: the same answer.
  const needs = data(
    await call(handler, id, "GET", "/api/me/home/needs"),
  ).needs;
  assert.equal(needs.ok, true);
  assert.equal(needs.state, "member");
  assert.equal(needs.clan_tag, CLAN);
  assert.equal(needs.unlock, clan.unlock);
  assert.deepEqual(needs.needs, clan.needs);
  assert.equal(needs.needs_total, clan.needs_total);
});

test("the clan card is kept per account; Clan's gate, Actions and role are read live", async () => {
  const { db } = scratch;
  const tag = "#9GQLV2Y";
  await db.query(
    "insert into player(player_tag,name) values ($1,'Kept') on conflict do nothing",
    [tag],
  );
  const id = await person("home-clan-kept");
  await db.query(
    `insert into claim(account_id,player_tag,status,relationship,is_primary)
     values ($1,$2,'verified','primary',true)`,
    [id, tag],
  );
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at)
     values ($1,$2,'elder',now())`,
    [CLAN, tag],
  );
  await db.query(
    `insert into account_clan(account_id,clan_tag,scope) values ($1,$2,'activity')
     on conflict do nothing`,
    [id, CLAN],
  );
  const read = async (query = undefined) => {
    const r = await handler({
      path: "/api/me/home/clan",
      method: "GET",
      ...(query ? { queryStringParameters: query } : {}),
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(id)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
    });
    assert.equal(r.statusCode, 200, r.body);
    return data(r).clan;
  };
  const row = async () =>
    (await db.query("select * from home_clan_card where account_id = $1", [id]))
      .rows[0];

  // The first read builds and keeps the record half, never the live half.
  const first = await read();
  assert.equal(first.ok, true);
  assert.equal(first.state, "member");
  assert.equal(first.role, "elder");
  assert.equal(first.refresh, false);
  const kept = await row();
  assert.equal(kept.clan_tag, CLAN);
  assert.match(kept.basis, /^member:[0-9a-f]{64}$/);
  for (const live of ["needs", "needs_total", "unlock", "role", "verified"])
    assert.equal(live in kept.card, false, `${live} is never stored`);

  // The next read serves the kept card (a marker only the row carries).
  await db.query(
    `update home_clan_card set card = card || '{"members": 999}'
      where account_id = $1`,
    [id],
  );
  const served = await read();
  assert.equal(served.members, 999);
  assert.equal(served.role, "elder", "the role is the gate's");
  assert.deepEqual(served.needs, [], "Actions are the gate's");
  assert.equal(served.refresh, false);

  // Past fresh it is still served, and says so; the page's rebuild builds.
  await db.query(
    `update home_clan_card set built_at = now() - interval '20 minutes'
      where account_id = $1`,
    [id],
  );
  const stale = await read();
  assert.equal(stale.members, 999);
  assert.equal(stale.refresh, true);
  const rebuilt = await read({ rebuild: "1" });
  assert.notEqual(rebuilt.members, 999);
  assert.equal(rebuilt.refresh, false);
  assert.ok(Date.now() - Date.parse((await row()).built_at) < 60_000);

  // A role change is a new basis: built again at once.
  await db.query(
    `update home_clan_card set card = card || '{"members": 999}'
      where account_id = $1`,
    [id],
  );
  await db.query(
    "update clan_membership set role = 'coLeader' where clan_tag = $1 and player_tag = $2",
    [CLAN, tag],
  );
  const promoted = await read();
  assert.equal(promoted.role, "coLeader");
  assert.notEqual(promoted.members, 999);
  assert.equal(promoted.standing, null, "a co-leader has no standing row");

  // Hours or days old on the same basis it is still served, and asks for
  // the rebuild (an expiry or a deploy never makes the reader wait).
  await db.query(
    `update home_clan_card set card = card || '{"members": 999}',
            built_at = now() - interval '4 days' where account_id = $1`,
    [id],
  );
  const old = await read();
  assert.equal(old.members, 999);
  assert.equal(old.refresh, true);
  assert.equal(old.role, "coLeader", "the role is still the gate's");

  // Asking for the rebuild builds it (above). That two asks at once
  // share one build is buildOnce's, pinned without a race in
  // packages/tools home-feed.test.mjs: two HTTP reads cannot be made to
  // overlap here, and when the first finished before the second asked,
  // a check here failed (CI, 2026-11-13).

  // Past a week the read builds it itself.
  await db.query(
    `update home_clan_card set card = card || '{"members": 999}'
      where account_id = $1`,
    [id],
  );
  await db.query(
    `update home_clan_card set built_at = now() - interval '8 days'
      where account_id = $1`,
    [id],
  );
  assert.notEqual((await read()).members, 999);

  // A departure: Clan's gate refuses, and the kept member card is not shown.
  await db.query(
    `update home_clan_card set card = card || '{"members": 999}'
      where account_id = $1`,
    [id],
  );
  await db.query(
    `update clan_membership set left_observed_at = now()
      where clan_tag = $1 and player_tag = $2`,
    [CLAN, tag],
  );
  const left = await read();
  assert.notEqual(left.state, "member");
  assert.notEqual(left.members, 999);
  assert.equal(left.needs?.length ?? 0, 0);
});

test("Needs you reaches a leader whose clan Elixir does not track, and nobody without a clan", async () => {
  const none = await person("home-needs-none");
  assert.equal(
    data(await call(handler, none, "GET", "/api/me/home/needs")).needs.state,
    "none",
  );
  const id = await person("home-needs-untracked");
  await scratch.db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'primary',true)`,
    [id, OWN],
  );
  await scratch.db.query(
    `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at)
     values ($1,$2,'leader',now()) on conflict do nothing`,
    [CLAN, OWN],
  );
  // Clan's gate admits them untracked: their Actions waiting reach the bell
  // (2026-11-12), read live through Clan's door.
  const needs = data(
    await call(handler, id, "GET", "/api/me/home/needs"),
  ).needs;
  assert.equal(needs.ok, true);
  assert.equal(needs.state, "member");
  assert.equal(needs.clan_tag, CLAN);
  assert.deepEqual(needs.needs, []);
  assert.equal(needs.needs_total, 0);
  const clan = data(await call(handler, id, "GET", "/api/me/home/clan")).clan;
  assert.equal(clan.state, "untracked");
  assert.equal(clan.slots.limit > 0, true, "the Track button's slots stay");
});

test("the account's week as the timeline builds it: every kind, a repeat kept at its first instant", async () => {
  const id = await person("home-latest-same");
  const { db } = scratch;
  const H = 3_600_000;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const tags = ["#2Y2Y2Y2", "#2Y2Y2YC", "#2Y2Y2YG", "#2Y2Y2YJ"];
  // The third has nothing in the window.
  const [movesUp, active, , facts] = tags;
  for (const tag of tags) {
    await db.query(
      `insert into player(player_tag,name) values ($1,$2) on conflict do nothing`,
      [tag, `Player ${tag.slice(-1)}`],
    );
    await db.query(
      `insert into claim(account_id,player_tag,relationship,is_primary)
       values ($1,$2,'friend',false)`,
      [id, tag],
    );
  }
  // The same moment twice in the week: the timeline keeps it at its first
  // instant, five days back, which a shorter window would not know.
  for (const hoursAgo of [120, 1])
    await emitEvent(db, "arena_changed", {
      tag: movesUp,
      windowStart: iso(now - hoursAgo * H - 60_000),
      windowEnd: iso(now - hoursAgo * H),
      payload: { from: 54000010, to: 54000011 },
    });
  // A sitting, a moment, an account item and a player's fact, each newer than
  // the last, and a player with nothing in the window.
  for (const [p, tag] of [movesUp, active].entries())
    for (const [i, minutes] of [30, 26, 22].entries()) {
      const battleId = `home-latest-${p}-${i}`;
      await db.query(
        `insert into battle(battle_id,battle_time,type,type_class,created_at)
         values ($1,$2,'PvP','pvp',$3)`,
        [battleId, iso(now - minutes * 60_000), iso(now - 20 * 60_000)],
      );
      await db.query(
        `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,trophy_change,outcome)
         values ($1,$2,$3,0,'PvP','pvp',3,30,'win')`,
        [battleId, tag, iso(now - minutes * 60_000)],
      );
    }
  await emitEvent(db, "card_unlocked", {
    tag: active,
    windowStart: iso(now - 16 * 60_000),
    windowEnd: iso(now - 15 * 60_000),
    payload: { card_id: 26000000, name: "Knight" },
  });
  await db.query(
    `insert into account_event(account_id,kind,detail,created_at)
     values ($1,'feedback_responded','{}',$2)`,
    [id, iso(now - 10 * 60_000)],
  );
  await db.query(
    `insert into attested_fact
       (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
     values ('player',$1,'personal_record','{"game":"drop","score":10}','player',
             'drop.poapkings.com','home-latest',$2,$2)`,
    [facts, iso(now - 5 * 60_000)],
  );

  const subjects = await subjectsFor(db, id);
  assert.equal(subjects.length, 4);
  const read = (fromMs, toMs) =>
    buildTimeline(db, subjects, {
      fromMs,
      toMs,
      timezone: "UTC",
      accountId: id,
      interactive: true,
    });
  const full = await read(now - 7 * 86_400_000, now);
  const kinds = full.timeline.map((it) => it.kind);
  assert.ok(kinds.some((k) => k.startsWith("account_")));
  assert.ok(kinds.includes("personal_record"));
  assert.ok(kinds.includes("battle_session"));
  assert.equal(
    full.timeline.filter((it) => it.kind === "arena_changed").length,
    1,
    "the repeat collapsed",
  );

  // Why a week is never read from a shorter window first: there the repeat is new,
  // and it would lead on a moment the full timeline tells five days back.
  const shorter = await read(now - 86_400_000, now);
  const moved = (items) => items.find((it) => it.kind === "arena_changed");
  assert.notEqual(
    shownAt(moved(shorter.timeline)),
    shownAt(moved(full.timeline)),
  );
});

test("a visit spends one charge on the shared bucket, however many panels it reads", async () => {
  const id = await person("home-charge");
  await scratch.db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'primary',true)`,
    [id, OWN],
  );
  const charged = async (bucket) =>
    (
      await scratch.db.query(
        "select coalesce(sum(count), 0)::int as n from rate_limit where bucket = $1",
        [bucket],
      )
    ).rows[0].n;
  for (const path of [
    "/api/me/home",
    "/api/me/home/needs",
    "/api/me/home/clan",
    "/api/me/home/week",
  ])
    assert.equal((await call(handler, id, "GET", path)).statusCode, 200, path);
  assert.equal(await charged(`mcp#${id}`), 1);
  assert.equal(await charged(`home#${id}`), 3);
});

test("the head names this account's nickname and no one else's", async () => {
  const id = await person("home-head-nick");
  const other = await person("home-head-nick-other");
  await scratch.db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$3,'primary',true), ($2,$3,'primary',true)`,
    [id, other, OWN],
  );
  await scratch.db.query(
    "insert into player_nickname(account_id,player_tag,nickname) values ($1,$2,'Sam')",
    [id, OWN],
  );
  const head = (who) => call(handler, who, "GET", "/api/me/home");
  assert.equal(data(await head(id)).first.player.nickname, "Sam");
  assert.equal(data(await head(other)).first.player.nickname, null);
});

test("panel: each read logs its name and time, and nothing about whose it was", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  const error = t.mock.method(console, "error", () => {});
  await panel("week", async () => ({ tag: OWN }));
  await panel("clan", async () => {
    throw Object.assign(new Error(OWN), { code: "x" });
  });
  const ok = JSON.parse(info.mock.calls[0].arguments[0]);
  assert.deepEqual(Object.keys(ok).sort(), ["at", "ms", "panel"]);
  assert.equal(ok.at, "home_panel");
  assert.equal(ok.panel, "week");
  const failed = JSON.parse(error.mock.calls[0].arguments[0]);
  assert.deepEqual(Object.keys(failed).sort(), ["at", "code", "ms", "panel"]);
  assert.equal(failed.at, "home_panel_failed");
  assert.equal(failed.panel, "clan");
});

test("panel: a throw is one panel's failure, never the page's", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "info", () => {});
  assert.deepEqual(await panel("x", async () => ({ a: 1 })), {
    ok: true,
    a: 1,
  });
  assert.deepEqual(
    await panel("x", async () => {
      throw new Error("no");
    }),
    { ok: false },
  );
});

test("a moment reads in this reader's word for the person, and only its opening name", () => {
  assert.equal(
    inOwnWords("Lark played 12 games.", "Lark", "Sam"),
    "Sam played 12 games.",
  );
  assert.equal(
    inOwnWords("Lark's best deck.", "Lark", "Sam"),
    "Sam's best deck.",
  );
  // No nickname: the sentence stands. Another word that merely starts with
  // the name, or a name later in the sentence, is not touched.
  assert.equal(inOwnWords("Lark won.", "Lark", null), "Lark won.");
  assert.equal(inOwnWords("Larkspur won.", "Lark", "Sam"), "Larkspur won.");
  assert.equal(inOwnWords("Beat Lark.", "Lark", "Sam"), "Beat Lark.");
});

test("a Watching row spells its modes as everything else does", async () => {
  const TAG = "#PYLQGRUY";
  const id = await person("home-modes");
  await call(handler, id, "POST", "/api/claims", {
    player_tag: "#PYLQGRVY",
    make_primary: true,
  });
  await played(TAG, id);
  await call(handler, id, "POST", "/api/claims", {
    player_tag: TAG,
    relationship: "watching",
  });
  await scratch.db.query(
    "update claim set relationship = 'watching' where account_id = $1 and player_tag = $2",
    [id, TAG],
  );
  const body = data(await call(handler, id, "GET", "/api/me/home/friends"));
  const { line } = body.watching.find((w) => w.tag === TAG);
  assert.match(line, /\d+ Trophy Road/);
  assert.doesNotMatch(line, /\d (trophy|path|casual|war|event)/);
});

test("a nickname stays in its own account: another follower of the same friend reads the in-game name", async () => {
  const TAG = "#PYLQGRLY";
  const mine = await person("home-nick-mine");
  const theirs = await person("home-nick-theirs");
  for (const [id, own] of [
    [mine, "#PYLQGRQY"],
    [theirs, "#PYLQGRRY"],
  ]) {
    const r = await call(handler, id, "POST", "/api/claims", {
      player_tag: own,
      make_primary: true,
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  await played(TAG, mine);
  const from = lastGameWeek(new Date()).from.getTime();
  await emitEvent(scratch.db, "arena_changed", {
    tag: TAG,
    payload: { from: 54000100, to: 54000101, to_name: "Example Arena" },
    windowStart: new Date(from + 3_600_000).toISOString(),
    windowEnd: new Date(from + 7_200_000).toISOString(),
    occurredAt: new Date(from + 7_200_000).toISOString(),
  });
  await call(handler, theirs, "POST", "/api/claims", {
    player_tag: TAG,
    relationship: "friend",
  });
  await scratch.db.query(
    "insert into player_nickname (account_id, player_tag, nickname) values ($1, $2, 'Private word')",
    [mine, TAG],
  );
  const cardOf = async (id) => {
    const r = await call(handler, id, "GET", "/api/me/home/friends");
    assert.equal(r.statusCode, 200, r.body);
    return data(r).friends.find((f) => f.tag === TAG);
  };
  const a = await cardOf(mine);
  const b = await cardOf(theirs);
  assert.equal(a.nickname, "Private word");
  assert.ok(a.moments.length > 0, "the fixture's sitting is a moment");
  assert.ok(a.moments.every((m) => !m.text.startsWith(a.name)));
  assert.equal(b.nickname ?? null, null);
  assert.doesNotMatch(JSON.stringify(b), /Private word/);
  assert.ok(b.moments.some((m) => m.text.startsWith(b.name)));
});

test("the week opens on the most played mode, Trophy Road with none", () => {
  assert.equal(openingMode({}), "ladder");
  assert.equal(
    openingMode({ war: { battles: 4 }, ranked: { battles: 9 } }),
    "ranked",
  );
  assert.equal(
    openingMode({ boat: { battles: 40 } }),
    "ladder",
    "a mode with no chip is never opened on",
  );
});

const WEEK_PLAYER = "#2YG98VV8";
let weekBattle = 0;
/** Battles this game week, each [type, outcome, trophy change], on one deck. */
async function seedWeek(tag, rows) {
  const { db } = scratch;
  const stamp = new Date(gameWeekStartMs(Date.now()) + 60_000).toISOString();
  await db.query(
    "insert into player(player_tag,name) values ($1,'Week') on conflict do nothing",
    [tag],
  );
  const hash = await seedDeck(db, {
    battle_time: stamp,
    cards: DECK,
    supportCards: TOWER,
  });
  for (const [type, outcome, change] of rows) {
    const battle = `week-${++weekBattle}`;
    await db.query(
      "insert into battle (battle_id,battle_time,created_at,type,type_class,game_mode_name,event_tag) values ($1,$2,$2,$3,'pvp','Ladder',null)",
      [battle, stamp, type],
    );
    await db.query(
      `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time,crowns,deck_hash,type,type_class,deck_avg_level,opp_deck_avg_level,trophy_change)
       values ($1,$2,0,$3,$4,0,$5,$6,'pvp',14,13,$7)`,
      [battle, tag, outcome, stamp, hash, type, change],
    );
    await seedPlayedDeck(db, {
      battle_id: battle,
      player_tag: tag,
      battle_time: stamp,
      cards: DECK,
      supportCards: TOWER,
    });
  }
  return hash;
}

test("your week names one mode at a time, keeps a chip for each, and hides a deck under five battles", async () => {
  const calls = [];
  const read = async (tool, args) => {
    calls.push([tool, args.mode ?? null]);
    if (tool === "battles_performance")
      return {
        window: args.mode
          ? { net_trophies: 12 }
          : {
              modes: {
                ladder: { battles: 3, wins: 2, losses: 1 },
                event: { battles: 1, wins: 1, losses: 0 },
              },
            },
      };
    return {};
  };
  await scratch.db.query(
    `insert into player_snapshot_daily(player_tag,snapshot_date,trophies)
     values ($1, current_date - 1, 8000), ($1, current_date, 9000)`,
    [OWN],
  );
  const week = await readWeek(read, scratch.db, OWN, null);
  assert.equal(week.mode, "ladder");
  assert.deepEqual(Object.keys(week.modes).sort(), ["event", "ladder"]);
  assert.equal(week.record.battles, 3);
  assert.equal(week.net_trophies, 12);
  assert.equal(week.trophies, 9000);
  assert.equal(week.deck, null);
  assert.ok(!calls.some(([tool]) => tool === "battles_decks"));
  assert.ok(
    !calls.some(([tool]) => tool === "players_summary"),
    "the trophies come from the snapshot, not the whole summary",
  );
});

test("your week reads through the real tools: one mode's own net, one deck's cards, in no more calls than it needs", async () => {
  const id = await person("home-week-real");
  await scratch.db.query(
    "insert into player(player_tag,name) values ($1,'Week') on conflict do nothing",
    [WEEK_PLAYER],
  );
  await scratch.db.query(
    `insert into claim(account_id,player_tag,status,relationship,is_primary)
     values ($1,$2,'verified','primary',true)`,
    [id, WEEK_PLAYER],
  );
  const calls = [];
  const invoke = makeRegistry();
  const read = async (tool, args) => {
    calls.push(tool);
    return invoke.invoke(
      tool,
      {
        db: scratch.db,
        account: { accountId: id, timezone: "UTC", kind: "person" },
        live: async () => null,
      },
      args,
    );
  };
  const hash = await seedWeek(WEEK_PLAYER, [
    ...Array(6).fill(["PvP", "win", 30]),
    ["PvP", "loss", -29],
  ]);
  const only = await readWeek(read, scratch.db, WEEK_PLAYER, null);
  assert.equal(only.mode, "ladder");
  assert.deepEqual(only.record, { battles: 7, wins: 6, losses: 1 });
  assert.equal(only.net_trophies, 151);
  assert.equal(only.deck.battles, 7);
  assert.equal(only.deck.cards.length, 8);
  assert.equal(only.deck.tower_troop, "Tower Princess");
  assert.deepEqual(
    calls,
    ["battles_performance", "battles_decks"],
    "one mode all week: its net is in hand, and the cards are one read",
  );
  assert.ok(hash);

  // A second mode this week: the net is Trophy Road's alone.
  calls.length = 0;
  await seedWeek(WEEK_PLAYER, [["riverRacePvP", "win", 500]]);
  const mixed = await readWeek(read, scratch.db, WEEK_PLAYER, "ladder");
  assert.equal(mixed.net_trophies, 151);
  assert.deepEqual(calls, [
    "battles_performance",
    "battles_performance",
    "battles_decks",
  ]);
});

/** Clan's `/home` answer, with what each role's card reads. */
const view = (role, you = {}, clan = {}) => ({
  clan_tag: CLAN,
  role,
  verified: true,
  policy_set: true,
  min_members: 10,
  needs: [],
  needs_total: 0,
  member: {
    members: 40,
    you: {
      this_week: { donations: 120 },
      this_war_week: { decks: 8 },
      ...you,
    },
    clan: { ranks_elder: true, status: "holding", ...clan },
  },
});

test("clan card per role: the band is a member's and an elder's, never a leader's", () => {
  for (const role of ["member", "elder"])
    assert.equal(shapeClan(view(role)).standing, "holding");
  for (const role of ["leader", "coLeader"])
    assert.equal(shapeClan(view(role)).standing, null);
  assert.equal(
    shapeClan(view("member", {}, { ranks_elder: false })).standing,
    null,
    "a clan that does not rank Elder shows no band",
  );
});

test("clan card: war decks carry no 'of N' while the race is open", () => {
  assert.deepEqual(shapeClan(view("member")).war_decks, {
    decks: 8,
    asked: null,
    open: true,
  });
});

test("clan card: your own clock only, and only while you are at risk", () => {
  assert.equal(
    shapeClan(view("member", {}, { inactivity: { state: "ok", days_idle: 2 } }))
      .clock,
    null,
  );
  assert.deepEqual(
    shapeClan(
      view(
        "member",
        {},
        { inactivity: { state: "at_risk", days_idle: 8.4, at_risk_days: 7 } },
      ),
    ).clock,
    { days_idle: 8, at_risk_days: 7 },
  );
});

test("Home's feed comes thirty a page: More reads on in the same week, the first page counts it all (G1)", async () => {
  const id = await person("home-feed-pages");
  const { db } = scratch;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  // Thirty-five invented friends, each with one personal record, a minute
  // apart: thirty-five items, newest first.
  const tags = Array.from(
    { length: 35 },
    (_, i) => `#8${"0289PYLQGRJCUV"[i % 14]}${"PYLQ"[Math.floor(i / 14)]}2Y2`,
  );
  assert.equal(new Set(tags).size, 35);
  for (const [i, tag] of tags.entries()) {
    await db.query(
      `insert into player(player_tag,name) values ($1,$2) on conflict do nothing`,
      [tag, `Paged ${i}`],
    );
    await db.query(
      `insert into claim(account_id,player_tag,relationship,is_primary)
       values ($1,$2,'friend',false)`,
      [id, tag],
    );
    await db.query(
      `insert into attested_fact
         (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
       values ('player',$1,'personal_record','{"game":"drop","score":10}','player',
               'drop.poapkings.com',$2,$3,$3)`,
      [tag, `home-feed-pages-${i}`, iso(now - (i + 5) * 60_000)],
    );
  }
  const feed = (query) =>
    handler({
      path: "/api/me/home/feed",
      method: "GET",
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(id)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      queryStringParameters: query,
    });

  const first = await feed({});
  assert.equal(first.statusCode, 200, first.body);
  const one = data(first);
  assert.equal(one.timeline.length, 30);
  assert.equal(one.total, 35);
  assert.equal(typeof one.next, "string");
  // The chips count the whole week, not the page.
  assert.equal(one.counts.everyone, 35);
  assert.equal(one.counts.friends, 35);
  // New is counted from the place the read found, and says which (Codex on
  // #800): this person has none yet.
  assert.equal(one.counts.new_since, null);

  const more = await feed({ cursor: one.next });
  assert.equal(more.statusCode, 200, more.body);
  const two = data(more);
  assert.equal(two.timeline.length, 5);
  assert.equal(two.next, null);
  assert.equal(two.counts, undefined);
  assert.deepEqual(two.window, one.window);
  const ids = [...one.timeline, ...two.timeline].map((it) => it.id);
  assert.equal(new Set(ids).size, 35, "no item twice, none lost");
  const at = [...one.timeline, ...two.timeline].map((it) => shownAt(it));
  assert.deepEqual(at, [...at].sort().reverse(), "newest first across pages");

  // A cursor the server did not make is refused, and so is a window wider
  // than the week.
  for (const cursor of [
    "not-a-cursor",
    Buffer.from(
      JSON.stringify({ f: now - 30 * 86_400_000, t: now, o: 30 }),
    ).toString("base64url"),
  ]) {
    const bad = await feed({ cursor });
    assert.equal(bad.statusCode, 400);
    assert.equal(data(bad).error, "invalid_cursor");
  }
});

test("Home's feed serves its stored week until it is past serving, then builds it again (#649)", async () => {
  const id = await person("home-feed-stored");
  const { db } = scratch;
  const tag = "#8QLQ2Y2";
  const now = Date.now();
  await db.query(
    `insert into player(player_tag,name) values ($1,'Stored') on conflict do nothing`,
    [tag],
  );
  await db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'friend',false)`,
    [id, tag],
  );
  // Two records with different scores (the same facts twice are one).
  const record = (ref, ms, score) =>
    db.query(
      `insert into attested_fact
         (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
       values ('player',$1,'personal_record',$4,'player',
               'drop.poapkings.com',$2,$3,$3)`,
      [tag, ref, new Date(ms).toISOString(), { game: "drop", score }],
    );
  await record("home-feed-stored-1", now - 10 * 60_000, 10);
  const feed = async () => {
    const r = await call(handler, id, "GET", "/api/me/home/feed");
    assert.equal(r.statusCode, 200, r.body);
    return data(r);
  };
  const storedCount = async () =>
    (
      await db.query(
        `select jsonb_array_length(items) as n from home_feed
          where account_id = $1`,
        [id],
      )
    ).rows[0].n;
  const first = await feed();
  assert.equal(first.total, 1);
  assert.equal(await storedCount(), 1);
  // Learned after the build: the stored week does not have it, and the
  // read serves it anyway, because facts are read live (Codex on #818).
  await record("home-feed-stored-2", Date.now(), 20);
  const second = await feed();
  assert.deepEqual(second.window, first.window, "the same stored week");
  assert.equal(second.total, 2);
  assert.equal(await storedCount(), 1, "the row is not rebuilt");
  // Past serving, the read builds the week again.
  await db.query(
    `update home_feed set built_at = built_at - interval '4 hours'
      where account_id = $1`,
    [id],
  );
  const third = await feed();
  assert.equal(third.total, 2);
  assert.notDeepEqual(third.window, first.window);
  assert.equal(await storedCount(), 2);
});

test("a stored week never outlives who may see a clan's fact: leave the clan and it goes at once (Codex on #818)", async () => {
  const id = await person("home-feed-left");
  const { db } = scratch;
  const clan = "#8QLQ2Y8";
  const tag = "#8QLQ2YJ";
  await db.query(
    `insert into clan(clan_tag,name) values ($1,'Left') on conflict do nothing`,
    [clan],
  );
  await db.query(
    `insert into player(player_tag,name) values ($1,'Leaver') on conflict do nothing`,
    [tag],
  );
  await db.query(
    `insert into claim(account_id,player_tag,status,relationship,is_primary)
     values ($1,$2,'verified','primary',true)`,
    [id, tag],
  );
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at)
     values ($1,$2,'member',now() - interval '30 days')`,
    [clan, tag],
  );
  await db.query(
    `insert into account_clan(account_id,clan_tag,scope) values ($1,$2,'activity')`,
    [id, clan],
  );
  const at = new Date(Date.now() - 20 * 60_000).toISOString();
  await db.query(
    `insert into attested_fact
       (subject_kind,clan_tag,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
     values ('clan',$1,null,'clan_message','{"channel":"clan_chat","body":"War day"}',
             'clan','clan.poapkings.com','home-feed-left-1',$2,$2)`,
    [clan, at],
  );
  const messages = async () => {
    const r = await call(handler, id, "GET", "/api/me/home/feed");
    assert.equal(r.statusCode, 200, r.body);
    return data(r).timeline.filter((it) => it.kind === "clan_message");
  };
  assert.equal((await messages()).length, 1, "a member reads the clan's word");
  const stored = (
    await db.query(`select built_at from home_feed where account_id = $1`, [id])
  ).rows[0].built_at;
  await db.query(
    `update clan_membership set left_observed_at = now()
      where clan_tag = $1 and player_tag = $2`,
    [clan, tag],
  );
  assert.deepEqual(await messages(), [], "gone on the next read");
  const after = (
    await db.query(`select built_at from home_feed where account_id = $1`, [id])
  ).rows[0].built_at;
  assert.deepEqual(after, stored, "from the stored week, not a rebuild");
});

test("Home names a fact written twice by the builder's id, the lower ledger row's (Codex on #824)", async () => {
  const id = await person("home-feed-twice");
  const { db } = scratch;
  const tag = "#8QLQ2YV";
  await db.query(
    `insert into player(player_tag,name) values ($1,'Twice') on conflict do nothing`,
    [tag],
  );
  await db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'friend',false)`,
    [id, tag],
  );
  // The same record twice: the later row (higher id) is backdated, so it
  // comes first by instant.
  const now = Date.now();
  for (const [ref, ms] of [
    ["home-feed-twice-1", now - 5 * 60_000],
    ["home-feed-twice-2", now - 10 * 60_000],
  ])
    await db.query(
      `insert into attested_fact
         (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
       values ('player',$1,'personal_record','{"game":"drop","score":30}','player',
               'drop.poapkings.com',$2,$3,$3)`,
      [tag, ref, new Date(ms).toISOString()],
    );
  const r = await call(handler, id, "GET", "/api/me/home/feed");
  assert.equal(r.statusCode, 200, r.body);
  const served = data(r).timeline.filter((it) => it.kind === "personal_record");
  assert.equal(served.length, 1);
  const built = await buildTimeline(db, await subjectsFor(db, id), {
    fromMs: now - 86_400_000,
    toMs: Date.now(),
    accountId: id,
    interactive: true,
  });
  const theirs = built.timeline.filter((it) => it.kind === "personal_record");
  assert.equal(theirs.length, 1);
  assert.equal(served[0].id, theirs[0].id, "one fact, one id");
});

test("More reads on after the last item served: a fact posted between pages repeats nothing (Codex on #818)", async () => {
  const id = await person("home-feed-keyset");
  const { db } = scratch;
  const now = Date.now();
  const tags = Array.from({ length: 31 }, (_, i) => {
    const a = "0289PYLQGRJCUV";
    return `#9${a[i % 14]}${a[Math.floor(i / 14)]}Q2Y`;
  });
  assert.equal(new Set(tags).size, 31);
  const record = (tag, ref, ms) =>
    db.query(
      `insert into attested_fact
         (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
       values ('player',$1,'personal_record','{"game":"drop","score":10}','player',
               'drop.poapkings.com',$2,$3,$3)`,
      [tag, ref, new Date(ms).toISOString()],
    );
  for (const [i, tag] of tags.entries()) {
    await db.query(
      `insert into player(player_tag,name) values ($1,$2) on conflict do nothing`,
      [tag, `Keyset ${i}`],
    );
    await db.query(
      `insert into claim(account_id,player_tag,relationship,is_primary)
       values ($1,$2,'friend',false)`,
      [id, tag],
    );
    await record(tag, `home-feed-keyset-${i}`, now - (i + 5) * 60_000);
  }
  const feed = (query) =>
    handler({
      path: "/api/me/home/feed",
      method: "GET",
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(id)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      queryStringParameters: query,
    });
  const one = data(await feed({}));
  assert.equal(one.timeline.length, 30);
  assert.equal(one.total, 31);
  // A new record lands at the top between the two pages.
  await record(tags[0], "home-feed-keyset-new", now - 60_000);
  const more = await feed({ cursor: one.next });
  assert.equal(more.statusCode, 200, more.body);
  const two = data(more);
  assert.equal(two.timeline.length, 1);
  const ids = [...one.timeline, ...two.timeline].map((it) => it.id);
  assert.equal(new Set(ids).size, 31, "nothing served twice");
});

test("your week counts the cheers other people gave your player's items this week, in the opening read only (G4)", async () => {
  const id = await person("home-week-cheers");
  const a = await person("home-week-cheers-a");
  const b = await person("home-week-cheers-b");
  const { db } = scratch;
  const tag = "#8Y2PYL2Y";
  const now = Date.now();
  const monday = gameWeekStartMs(now);
  await db.query("insert into player(player_tag,name) values ($1,'Cheered')", [
    tag,
  ]);
  await db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'primary',true)`,
    [id, tag],
  );
  // One record this week, and one last week whose cheers are not this week's.
  for (const [ref, at] of [
    ["home-week-cheers-now", Math.floor((monday + now) / 2)],
    ["home-week-cheers-old", monday - 2 * 86_400_000],
  ])
    await db.query(
      `insert into attested_fact
         (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
       values ('player',$1,'personal_record','{"game":"drop","score":10}','player',
               'drop.poapkings.com',$2,$3,$3)`,
      [tag, ref, new Date(at).toISOString()],
    );
  const items = async (fromMs, toMs) =>
    (
      await buildTimeline(
        db,
        [{ kind: "player", tag, relationship: "primary", nickname: null }],
        { fromMs, toMs, accountId: id, interactive: true, accountLines: false },
      )
    ).timeline.map((it) => it.id);
  const [mine] = await items(monday, now);
  const [old] = await items(monday - 3 * 86_400_000, monday);
  assert.ok(mine && old && mine !== old);
  // Two other people cheer this week's item, one last week's; the person's
  // own row (a cheer of their own is never counted) is left out.
  await db.query(
    `insert into timeline_cheer(account_id,item_id,cheer) values
       ($1,$4,'well_played'),($2,$4,'on_fire'),($1,$5,'wow'),($3,$4,'royal')`,
    [a, b, id, mine, old],
  );
  const opening = data(await call(handler, id, "GET", "/api/me/home/week"));
  assert.equal(opening.week.cheers, 2);
  const chip = data(
    await handler({
      path: "/api/me/home/week",
      method: "GET",
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(id)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      queryStringParameters: { mode: "ladder" },
    }),
  );
  assert.equal(chip.week.cheers, undefined, "a chip's read leaves them out");
});
