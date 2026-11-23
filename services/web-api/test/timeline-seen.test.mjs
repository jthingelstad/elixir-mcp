/**
 * The Console keeps its own place in the timeline (0228).
 *
 * Jamie, 2026-10-20: "timeline should be independent of what agents have
 * seen via MCP." The rail's Timeline dot counted against the account's
 * read pointer, which only an MCP mark_read moves, so it never cleared
 * for a person who never used MCP. This file pins the independence both
 * ways: an MCP mark_read never clears the Console's dot, and a Console
 * visit never moves what an MCP client sees as read or pending.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_timeline_seen_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const PERSON = "seen-person@example.com";
const PLAYER = "#0VQRR8U0";
const CLAN = "#J2RGCRVG";

let db;
let handler;
let cookie;
let personId;
let mcp;
const sentEmails = [];

function event({ method = "GET", path: p, body, contract = true }) {
  return {
    path: p,
    method,
    headers: {
      cookie,
      "cloudfront-viewer-address": "8.8.4.4:443",
      ...(contract ? { "x-elixir-client": "web" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const call = async (opts) => {
  const res = await handler(event(opts));
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

/** The rail's dot on the Console. */
const consolePending = async () =>
  (await call({ path: "/api/me" })).body.signals.timeline_pending;
/** What the MCP side sees: meta.timeline_pending on any MCP call. */
const mcpPending = async () =>
  (await mcp("game_clock", {})).body.meta.timeline_pending;
const pointers = async (accountId) =>
  (
    await db.query(
      `select activity_seen_at, console_timeline_seen_at
         from account where account_id = $1`,
      [accountId],
    )
  ).rows[0];
/** The recorder admits something for a subject, now: after every place
 *  a read has left. A read's window ends at a millisecond and the stamp
 *  has microseconds, so the clock is let past the admission's
 *  millisecond before anything reads, and the next window covers it. */
async function admit(tag) {
  const { rows } = await db.query(
    `insert into poll_state (subject_tag, endpoint, last_admitted_at)
     values ($1, 'player_battlelog', now())
     on conflict (subject_tag, endpoint)
     do update set last_admitted_at = now()
     returning last_admitted_at`,
    [tag],
  );
  const at = rows[0].last_admitted_at.getTime();
  while (Date.now() <= at + 1) await new Promise((r) => setTimeout(r, 2));
}
/** Open the Timeline page the way the Console does: read it, then move
 *  the Console's place to the window end it showed. */
async function visit() {
  const base = "/api/me";
  const page = await call({ path: `${base}/timeline` });
  assert.equal(page.status, 200, JSON.stringify(page.body));
  const seen = await call({
    method: "POST",
    path: `${base}/timeline/seen`,
    body: { to: page.body.window.to },
  });
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  return { page: page.body, seen: seen.body };
}

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  handler = makeHandler({
    databaseUrl: DB_URL,
    secret: "timeline-seen-secret",
    sendLoginEmail: async (m) => sentEmails.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  await db.query(`insert into player (player_tag, name) values ($1, 'Seen')`, [
    PLAYER,
  ]);
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS')`,
    [CLAN],
  );
  personId = (
    await db.query(
      `insert into account (email_hash, status, role, timezone)
       values ($1, 'approved', 'member', 'America/Chicago') returning account_id`,
      [emailHash(PERSON)],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship, notify)
     values ($1, $2, true, 'primary', true)`,
    [personId, PLAYER],
  );

  await handler(
    event({
      method: "POST",
      path: "/api/auth",
      body: { age_13: true, email: PERSON },
    }),
  );
  const { code } = sentEmails.at(-1);
  const res = await handler(
    event({
      method: "POST",
      path: "/api/auth/code",
      body: { email: PERSON, code },
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  cookie = res.headers["set-cookie"].split(";")[0];

  // The person's own MCP connection: the unnamed pointer's reader.
  const invoke = makeInvoker({
    db,
    account: { accountId: personId, isOwner: true, timezone: "UTC" },
    registry: makeRegistry(),
  });
  mcp = (name, args) => invoke(name, args);
});

after(async () => {
  await db?.end();
  await dropScratch(NAME);
});

test("a person who never used MCP: the dot clears when the Console shows the timeline", async () => {
  await admit(PLAYER);
  assert.equal(await consolePending(), 1, "news, never seen: the dot");
  const first = await visit();
  assert.equal(first.page.seen_to, null, "the first visit has no place yet");
  assert.equal(first.seen.seen_to, first.page.window.to);
  assert.equal(await consolePending(), 0, "the visit cleared it");
  assert.equal(
    (await pointers(personId)).activity_seen_at,
    null,
    "no MCP client ever marked, and the Console did not either",
  );

  // The next visit opens from the place the last one left.
  await admit(PLAYER);
  assert.equal(await consolePending(), 1);
  const second = await visit();
  assert.equal(second.page.seen_to, first.page.window.to);
  assert.equal(await consolePending(), 0);
});

test("an MCP mark_read never clears the Console's dot", async () => {
  await admit(PLAYER);
  assert.equal(await consolePending(), 1);
  assert.ok((await mcpPending()) >= 1, "the MCP side sees it too");
  const consoleBefore = (await pointers(personId)).console_timeline_seen_at;

  // A first poll: no pointer yet, so it asks to mark (an observed read).
  const read = await mcp("elixir_timeline", { mark_read: true });
  assert.equal(read.isError, false, JSON.stringify(read.body));
  assert.equal(read.body.applied.mark_read, true);
  assert.equal(
    (await pointers(personId)).activity_seen_at.toISOString(),
    read.body.read_to,
    "the MCP pointer moved",
  );
  assert.equal(await mcpPending(), 0, "the MCP side has read it");
  assert.equal(await consolePending(), 1, "the Console has not shown it");
  assert.equal(
    String((await pointers(personId)).console_timeline_seen_at),
    String(consoleBefore),
    "mark_read never moves the Console's place",
  );
});

test("a Console visit never moves what an MCP client sees as read or pending", async () => {
  await admit(PLAYER);
  assert.ok((await mcpPending()) >= 1);
  await db.query(
    `insert into timeline_reader (account_id, reader, read_to)
     values ($1, 'poll-lane', now() - interval '1 hour')
     on conflict (account_id, reader) do update set read_to = excluded.read_to`,
    [personId],
  );
  const before = await pointers(personId);
  const readerBefore = (
    await db.query(
      `select read_to from timeline_reader where account_id = $1`,
      [personId],
    )
  ).rows;
  const pendingBefore = await mcpPending();
  assert.ok(pendingBefore >= 1);

  await visit();
  assert.equal(await consolePending(), 0);
  const after = await pointers(personId);
  assert.equal(
    String(after.activity_seen_at),
    String(before.activity_seen_at),
    "the unnamed pointer stands",
  );
  assert.deepEqual(
    (
      await db.query(
        `select read_to from timeline_reader where account_id = $1`,
        [personId],
      )
    ).rows,
    readerBefore,
    "a named reader's pointer stands",
  );
  assert.equal(
    await mcpPending(),
    pendingBefore,
    "meta.timeline_pending is unchanged",
  );
  await db.query(`delete from timeline_reader where account_id = $1`, [
    personId,
  ]);
});

test("Home's tab mark: a poll alone is not news, a learned battle is, and a visit clears it", async () => {
  const unread = async () => {
    const res = await handler({
      ...event({ path: "/api/me/timeline" }),
      queryStringParameters: { news: "1" },
    });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };
  await visit();
  await new Promise((r) => setTimeout(r, 5));
  await admit(PLAYER);
  assert.equal(await consolePending(), 1, "the rail's hint lights on a poll");
  assert.deepEqual(await unread(), { unread: false }, "the tab does not");

  const now = new Date().toISOString();
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('seen-mark-battle', $1, 'PvP', 'pvp', now())`,
    [now],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, outcome)
     values ('seen-mark-battle', $1, $2, 0, 'PvP', 'pvp', 'win')`,
    [PLAYER, now],
  );
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await unread(), { unread: true });
  await visit();
  assert.deepEqual(await unread(), { unread: false }, "the visit cleared it");
});

test("the place only moves forward, never past now, and only from the Console", async () => {
  const { console_timeline_seen_at: at } = await pointers(personId);
  const back = await call({
    method: "POST",
    path: "/api/me/timeline/seen",
    body: { to: "2026-01-01T00:00:00.000Z" },
  });
  assert.equal(back.status, 200);
  assert.equal(back.body.seen_to, at.toISOString(), "an older window is kept");

  for (const to of [undefined, "", "not a time", 42]) {
    const bad = await call({
      method: "POST",
      path: "/api/me/timeline/seen",
      body: { to },
    });
    assert.equal(bad.status, 400, String(to));
    assert.equal(bad.body.error, "invalid_to");
  }
  const future = await call({
    method: "POST",
    path: "/api/me/timeline/seen",
    body: { to: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(future.status, 400, "a window that has not ended yet");

  // A write: without the Console's contract header it is refused.
  const bare = await call({
    method: "POST",
    path: "/api/me/timeline/seen",
    body: { to: new Date().toISOString() },
    contract: false,
  });
  assert.equal(bare.status, 401);
  assert.equal(
    String((await pointers(personId)).console_timeline_seen_at),
    String(at),
  );
});
