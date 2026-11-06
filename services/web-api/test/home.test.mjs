/**
 * Home's one read route (redesign step 3a) and Friends' Follow, against a
 * real PostgreSQL database. A failed panel says so and the rest render; a
 * Follow never makes anyone the person's primary.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { createClanRequest } from "../src/clan.mjs";
import {
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
  const r = await call(clanFails, id, "GET", "/api/me/home");
  assert.equal(r.statusCode, 200, r.body);
  const body = data(r);
  assert.equal(body.first.ok, true);
  assert.equal(body.clan.ok, false);
  assert.equal(body.week.ok, true);
  assert.equal(body.latest.ok, true);
  assert.equal(body.week.record.battles, 0);

  // The same person through Clan's real door: a leader's card.
  const whole = await call(handler, id, "GET", "/api/me/home");
  const clan = data(whole).clan;
  assert.equal(clan.ok, true, whole.body);
  assert.equal(clan.state, "member");
  assert.equal(clan.role, "leader");
  assert.equal(clan.standing, null, "a leader has no standing row");
  assert.deepEqual(clan.needs, []);
});

test("panel: a throw is one panel's failure, never the page's", async (t) => {
  t.mock.method(console, "error", () => {});
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
    if (tool === "players_summary") return { trophies: 9000 };
    return {};
  };
  const week = await readWeek(read, OWN, null);
  assert.equal(week.mode, "ladder");
  assert.deepEqual(Object.keys(week.modes).sort(), ["event", "ladder"]);
  assert.equal(week.record.battles, 3);
  assert.equal(week.net_trophies, 12);
  assert.equal(week.trophies, 9000);
  assert.equal(week.deck, null);
  assert.ok(!calls.some(([tool]) => tool === "battles_decks"));
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
