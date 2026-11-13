/**
 * The bell (2026-11-12). Pinned here: reactions are other people's cheers on
 * your own verified players' items, as counts, never who; followers are named
 * only by their account's verified player and otherwise counted, with no
 * follow time; answers are your own feedback's; opening the bell moves the
 * account's seen marker, and what came before it is no longer new (an
 * unread answer stays new until it is read); a person's only, the contract
 * header required to move the marker, and no agent console reaches it.
 * Synthetic names; the fixture's tag.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { AGENT_SCOPED_ROUTES, makeHandler } from "../src/handler.mjs";
import { BELL_READS_PER_HOUR } from "../src/bell.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_bell_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog), and an invented one
// the fan verified.
const PLAYER = "#0QRVVG22J";
const FAN_PLAYER = "#0VQRR8U0";
const FAN_NAME = "Invented Fan";
const OWNER = "bell-owner@example.com";
const FRIEND = "bell-friend@example.com";
const FAN = "bell-fan@example.com";
const STRANGER = "bell-stranger@example.com";
const QUESTION = "Could the season page show the war week first?";

let db, handler;
const sent = [];
const cookies = {};
const ids = {};

const request = (method, p, { body, who, contract = true } = {}) =>
  handler({
    path: p,
    method,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = async (method, p, opts) => {
  const res = await request(method, p, opts);
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

async function signIn(email) {
  await request("POST", "/api/auth", { body: { age_13: true, email } });
  const { code } = sent.at(-1);
  const res = await request("POST", "/api/auth/code", {
    body: { email, code },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

async function account(email) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'UTC') returning account_id`,
    [emailHash(email)],
  );
  return a.account_id;
}

const claim = (accountId, tag, kind) =>
  db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        notify, status, verified_at)
     values ($1, $2, $3, $4, true, $5, $6)`,
    [
      accountId,
      tag,
      kind === "own",
      kind === "own" ? "primary" : "friend",
      kind === "own" ? "verified" : "unverified",
      kind === "own" ? new Date() : null,
    ],
  );

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const {
    rows: [operator],
  } = await db.query(
    `insert into account (email_hash, status) values ('bell-op', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    FAN_PLAYER,
    FAN_NAME,
  ]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, operator.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'bell-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator.account_id],
  );
  for (const [endpoint, entityKey, rel, fetchedAt] of [
    ["cards", "GLOBAL", "cards/catalog.json", "2026-09-03T13:00:00Z"],
    [
      "player_battlelog",
      PLAYER,
      "player_battlelog/with_colosseum_duel.json",
      "2026-09-03T14:30:34Z",
    ],
  ]) {
    const payload = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
    );
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  }
  await db.query(
    `update player set name = 'Invented Owner' where player_tag = $1`,
    [PLAYER],
  );
  const {
    rows: [battle],
  } = await db.query(
    `select bp.battle_id from battle_participant bp join battle b using (battle_id)
      where bp.player_tag = $1 and b.type = 'PvP'
      order by b.battle_time desc limit 1`,
    [PLAYER],
  );

  handler = makeHandler({
    databaseUrl,
    secret: "bell-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  ids.owner = await account(OWNER);
  await claim(ids.owner, PLAYER, "own");
  // A follower with no verified player: counted, never named.
  ids.friend = await account(FRIEND);
  await claim(ids.friend, PLAYER, "friend");
  // A follower who verified a player of their own: named by it.
  ids.fan = await account(FAN);
  await claim(ids.fan, FAN_PLAYER, "own");
  await claim(ids.fan, PLAYER, "friend");
  ids.stranger = await account(STRANGER);
  for (const who of ["owner", "friend", "fan", "stranger"])
    cookies[who] = await signIn(
      { owner: OWNER, friend: FRIEND, fan: FAN, stranger: STRANGER }[who],
    );
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battle.battle_id, words: "A close one" },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  // An answered piece of the owner's feedback, not yet read.
  await db.query(
    `insert into feedback (account_id, surface, message, status, response, responded_at)
     values ($1, 'web', $2, 'planned', 'Yes, next week.', now())`,
    [ids.owner, QUESTION],
  );
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

const highlightOf = async (who) => {
  const read = await call("GET", "/api/me/timeline", { who });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  return read.body.timeline.find((it) => it.kind === "battle_highlight");
};
const cheer = (who, item, value) =>
  call("PUT", "/api/me/cheers", {
    who,
    body: {
      item_id: item.id,
      cheer: value,
      subjects: (item.subjects ?? []).map((s) => s.tag),
    },
  });

test("the bell: reactions as counts, followers named only by a verified player, answers", async () => {
  const item = await highlightOf("friend");
  assert.ok(item);
  assert.equal((await cheer("friend", item, "royal")).status, 200);
  assert.equal((await cheer("fan", item, "wow")).status, 200);
  // The owner's own cheer on their own item is not a reaction to it.
  assert.equal((await cheer("owner", item, "royal")).status, 200);

  const bell = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(bell.status, 200, JSON.stringify(bell.body));
  assert.equal(bell.body.seen_at, null);
  assert.equal(bell.body.reactions.items.length, 1);
  const r = bell.body.reactions.items[0];
  assert.equal(r.item_id, item.id);
  assert.deepEqual(r.cheers, { royal: 1, wow: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.new, true);
  // The row opens the highlight's battle, as the feed does.
  assert.ok(item.facts?.battle?.url);
  assert.equal(r.battle_url, item.facts.battle.url);
  assert.match(r.battle_url, /\/battle\/[0-9a-f]{12}$/);
  // Followers: the fan by their own verified player, the friend counted.
  assert.equal(bell.body.followers.count, 2);
  assert.equal(bell.body.followers.unnamed, 1);
  assert.deepEqual(bell.body.followers.players, [
    {
      tag: FAN_PLAYER,
      name: FAN_NAME,
      followed_tag: PLAYER,
      followed_name: "Invented Owner",
      new: true,
      can_follow_back: true,
    },
  ]);
  // Follow back (2026-11-13) is not offered on a player you already
  // follow, own or watch.
  await db.query(
    `insert into claim (account_id, player_tag, relationship) values ($1, $2, 'friend')`,
    [ids.owner, FAN_PLAYER],
  );
  const back = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(back.body.followers.players[0].can_follow_back, false);
  await db.query(
    `delete from claim where account_id = $1 and player_tag = $2`,
    [ids.owner, FAN_PLAYER],
  );
  assert.equal(bell.body.answers.items.length, 1);
  assert.equal(bell.body.answers.items[0].about, QUESTION);
  assert.equal(bell.body.answers.items[0].new, true);
  assert.equal(bell.body.new, 1 + 2 + 1);
  // Never who cheered or followed, beyond the verified player's name: no
  // email, account id or the friend at all.
  const raw = JSON.stringify(bell.body);
  for (const leak of [FRIEND, FAN, ids.friend, ids.fan, "bell-friend"])
    assert.equal(raw.includes(leak), false, leak);
});

test("opening the bell: what came before is seen; an unread answer stays new", async () => {
  const opened = await call("PUT", "/api/me/bell/seen", { who: "owner" });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.ok(opened.body.seen_at);
  const bell = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(bell.body.reactions.items[0].new, false);
  assert.equal(bell.body.reactions.new, 0);
  assert.equal(bell.body.followers.new, 0);
  assert.equal(bell.body.followers.players[0].new, false);
  assert.equal(bell.body.answers.new, 1);
  assert.equal(bell.body.new, 1);
  // A cheer changed after the marker is new again.
  const item = await highlightOf("friend");
  assert.equal((await cheer("friend", item, "on_fire")).status, 200);
  const again = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(again.body.reactions.new, 1);
  assert.deepEqual(again.body.reactions.items[0].cheers, {
    on_fire: 1,
    wow: 1,
  });
  // Reading the answer, where it always was, is what marks it read.
  await db.query(
    `update feedback set response_seen_at = now() where account_id = $1`,
    [ids.owner],
  );
  const read = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(read.body.answers.new, 0);
  assert.equal(read.body.answers.items.length, 1);
});

test("an account with no verified player: no reactions or followers, its own answers only", async () => {
  const bell = await call("GET", "/api/me/bell", { who: "stranger" });
  assert.equal(bell.status, 200);
  assert.equal(bell.body.players, 0);
  assert.deepEqual(bell.body.reactions, { items: [], new: 0 });
  assert.equal(bell.body.followers.count, 0);
  assert.deepEqual(bell.body.answers, { items: [], new: 0 });
  assert.equal(bell.body.new, 0);
  // The friend follows the owner's player, but it is not theirs.
  const friend = await call("GET", "/api/me/bell", { who: "friend" });
  assert.deepEqual(friend.body.reactions, { items: [], new: 0 });
});

test("an unread answer is never pushed past the cap by newer read ones", async () => {
  // One unread answer from five days ago, then more read answers since
  // than the bell shows.
  await db.query(
    `insert into feedback (account_id, surface, message, status, response, responded_at)
     values ($1, 'web', 'The old unread one', 'planned', 'Answered.', now() - interval '5 days')`,
    [ids.stranger],
  );
  await db.query(
    `insert into feedback (account_id, surface, message, status, response,
                           responded_at, response_seen_at)
     select $1, 'web', 'Read answer ' || n, 'done', 'Answered.',
            now() - make_interval(hours => n), now()
       from generate_series(1, 25) n`,
    [ids.stranger],
  );
  const bell = await call("GET", "/api/me/bell", { who: "stranger" });
  assert.equal(bell.status, 200, JSON.stringify(bell.body));
  assert.equal(bell.body.answers.new, 1);
  assert.equal(bell.body.answers.items[0].about, "The old unread one");
  assert.equal(bell.body.answers.items[0].new, true);
  assert.equal(bell.body.answers.items.length, 20);
  assert.equal(bell.body.new, 1);
});

test("the bell's refusals: signed out, no contract header, agents, the hour's cap", async () => {
  assert.equal((await call("GET", "/api/me/bell")).status, 401);
  assert.equal((await call("PUT", "/api/me/bell/seen")).status, 401);
  assert.notEqual(
    (await call("PUT", "/api/me/bell/seen", { who: "fan", contract: false }))
      .status,
    200,
  );
  assert.equal(
    (await db.query(`select 1 from bell_seen where account_id = $1`, [ids.fan]))
      .rowCount,
    0,
  );
  for (const key of AGENT_SCOPED_ROUTES)
    assert.equal(/bell/.test(key), false, key);
  await db.query(
    `insert into rate_limit (bucket, window_start, count)
     values ($1, date_trunc('hour', now()), $2)
     on conflict (bucket, window_start) do update set count = excluded.count`,
    [`bell#${ids.fan}`, BELL_READS_PER_HOUR],
  );
  assert.equal((await call("GET", "/api/me/bell", { who: "fan" })).status, 429);
});

test("your account's lines leave Home's feed for the bell, a burst folded into one line per kind", async () => {
  // A run of follows, as the live burst of 2026-11-12 logged it: each adds
  // the claim and then starts its recording, so the two kinds interleave.
  const BUSY = "bell-busy@example.com";
  ids.busy = await account(BUSY);
  cookies.busy = await signIn(BUSY);
  const tags = Array.from(
    { length: 24 },
    (_, i) => `#0C0Q2${"0289PYLQGRJCUV"[i % 14]}${"PYLQ"[Math.floor(i / 14)]}`,
  );
  assert.equal(new Set(tags).size, 24);
  let n = 0;
  for (const tag of tags)
    for (const kind of ["claim_added", "recording_started"])
      await db.query(
        `insert into account_event (account_id, kind, detail, created_at)
         values ($1, $2, $3, now() - make_interval(secs => $4))`,
        [ids.busy, kind, JSON.stringify({ player_tag: tag }), 600 - n++],
      );
  // An hour before: one player another account verified.
  await db.query(
    `insert into account_event (account_id, kind, detail, created_at)
     values ($1, 'claim_ended', $2, now() - interval '1 hour')`,
    [ids.busy, JSON.stringify({ player_tag: PLAYER, was_primary: false })],
  );

  // Home's feed has none of it; Settings › Timeline still does.
  const feed = await call("GET", "/api/me/home/feed", { who: "busy" });
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  assert.equal(
    feed.body.timeline.filter((it) => it.section === "account").length,
    0,
  );
  assert.ok(feed.body.window?.to);
  assert.ok("seen_to" in feed.body);
  const timeline = await call("GET", "/api/me/timeline", { who: "busy" });
  assert.ok(
    timeline.body.timeline.some((it) => it.kind === "account_claim_added"),
  );

  const bell = await call("GET", "/api/me/bell", { who: "busy" });
  assert.equal(bell.status, 200, JSON.stringify(bell.body));
  const lines = bell.body.account.items;
  assert.deepEqual(
    lines.map((l) => [l.kind, l.players, l.events]),
    [
      ["recording_started", 24, 24],
      ["claim_added", 24, 24],
      ["claim_ended", 1, 1],
    ],
  );
  // One line about one player names it; a burst names a few, not all.
  assert.deepEqual(lines[2].subjects, [
    { tag: PLAYER, name: "Invented Owner", kind: "player" },
  ]);
  assert.equal(lines[0].subjects.length, 3);
  // Sign-ins stay in Settings, never the bell.
  assert.equal(
    lines.some((l) => l.kind === "signed_in"),
    false,
  );
  assert.equal(bell.body.account.new, 3);
  assert.equal(bell.body.new, 3);
  await call("PUT", "/api/me/bell/seen", { who: "busy" });
  const seen = await call("GET", "/api/me/bell", { who: "busy" });
  assert.equal(seen.body.account.new, 0);
  assert.equal(seen.body.new, 0);
});

test("the bell reads its stored week (bell_week, #649): built once, served, rebuilt when your players change or it is stale", async () => {
  // The reads above built the owner's week.
  const row = async () =>
    (
      await db.query(
        `select built_at, own_key, items from bell_week where account_id = $1`,
        [ids.owner],
      )
    ).rows[0];
  const first = await row();
  assert.ok(first, "the first read stored the week");
  // Highlights are read live over the row: one the row holds but the
  // record no longer does never reaches the bell.
  const GONE = "tl_00000000000000000a1c";
  const was = new Date(Date.now() - 7_200_000).toISOString();
  await db.query(
    `update bell_week set items = items || $2::jsonb where account_id = $1`,
    [
      ids.owner,
      JSON.stringify([
        {
          id: GONE,
          kind: "battle_highlight",
          section: "battles",
          subject_tag: PLAYER,
          at: was,
          sort_at: was,
          observed_at: was,
          text: "A highlight since removed",
          facts: {},
        },
      ]),
    ],
  );
  await db.query(
    `insert into timeline_cheer (account_id, item_id, cheer) values ($1, $2, 'grind')`,
    [ids.fan, GONE],
  );
  // A served read leaves the row as it was: an item only the stored week
  // holds, cheered by someone else, reaches the bell from it.
  const STORED = "tl_00000000000000000a1b";
  const at = new Date(Date.now() - 3_600_000).toISOString();
  await db.query(
    `update bell_week set items = items || $2::jsonb where account_id = $1`,
    [
      ids.owner,
      JSON.stringify([
        {
          id: STORED,
          kind: "battle_session",
          section: "battles",
          subject_tag: PLAYER,
          at,
          sort_at: at,
          observed_at: at,
          text: "Invented Owner played a stored sitting",
          facts: {},
        },
      ]),
    ],
  );
  await db.query(
    `insert into timeline_cheer (account_id, item_id, cheer) values ($1, $2, 'grind')`,
    [ids.fan, STORED],
  );
  const served = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(served.status, 200);
  const stored = served.body.reactions.items.find((i) => i.item_id === STORED);
  assert.ok(stored, JSON.stringify(served.body.reactions));
  assert.deepEqual(stored.cheers, { grind: 1 });
  assert.equal(stored.text, "Invented Owner played a stored sitting");
  assert.equal(
    served.body.reactions.items.some((i) => i.item_id === GONE),
    false,
  );
  assert.deepEqual((await row()).built_at, first.built_at);
  // Another verified player of your own: the week is built again.
  await db.query(
    `insert into player (player_tag, name) values ('#082V28G9U', 'Invented Alt')
     on conflict do nothing`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        notify, status, verified_at)
     values ($1, '#082V28G9U', false, 'alt', true, 'verified', now())`,
    [ids.owner],
  );
  const rebuilt = await call("GET", "/api/me/bell", { who: "owner" });
  assert.equal(rebuilt.status, 200);
  assert.equal(
    rebuilt.body.reactions.items.some((i) => i.item_id === STORED),
    false,
    "the rebuilt week no longer holds the stored-only item",
  );
  const after = await row();
  assert.notEqual(after.own_key, first.own_key);
  // The background wake rebuilds a stale row (refreshHomeWeek).
  await db.query(
    `update bell_week set built_at = now() - interval '1 hour' where account_id = $1`,
    [ids.owner],
  );
  const { refreshHomeWeek } =
    await import("../../../packages/tools/src/activity/home-feed.mjs");
  const out = await refreshHomeWeek(db, ids.owner);
  assert.ok(
    out.bell && typeof out.bell.items === "number",
    JSON.stringify(out),
  );
  assert.ok(Date.now() - (await row()).built_at.getTime() < 60_000);
  await db.query(
    `delete from claim where account_id = $1 and player_tag = '#082V28G9U'`,
    [ids.owner],
  );
});
