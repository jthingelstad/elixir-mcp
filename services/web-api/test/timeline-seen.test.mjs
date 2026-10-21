/**
 * The Console keeps its own place in the timeline (0228).
 *
 * Jamie, 2026-10-20: "timeline should be independent of what agents have
 * seen via MCP." The rail's Timeline dot counted against the account's
 * read pointer, which only an MCP mark_read moves, so it never cleared
 * for a person with no agent. This file pins the independence both
 * ways: an agent's mark_read never clears the Console's dot, and a
 * Console visit never moves what an agent sees as read or pending.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_timeline_seen_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const PERSON = "seen-person@example.com";
const PLAYER = "#2PP0V9PP";
const CLAN = "#J2RGCRVG";
const AGENT_PID = "seenagent1";

let db;
let handler;
let cookie;
let personId;
let agentId;
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

/** The rail's dot on a console: yours, or an agent's by public id. */
const consolePending = async (agent = null) =>
  (await call({ path: agent ? `/api/agent/${agent}` : "/api/me" })).body.signals
    .timeline_pending;
/** What the agents' side sees: meta.timeline_pending on any MCP call. */
const agentsPending = async () =>
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
async function visit(agent = null) {
  const base = agent ? `/api/agent/${agent}` : "/api/me";
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
  agentId = (
    await db.query(
      `insert into account (status, role, kind, owned_by_account_id, public_id)
       values ('approved', 'member', 'agent', $1, $2) returning account_id`,
      [personId, AGENT_PID],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify, is_primary)
     values ($1, $2, 'activity', true, true)`,
    [agentId, CLAN],
  );

  await handler(
    event({ method: "POST", path: "/api/auth", body: { email: PERSON } }),
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
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("a person with no agent: the dot clears when the Console shows the timeline", async () => {
  await admit(PLAYER);
  assert.equal(await consolePending(), 1, "news, never seen: the dot");
  const first = await visit();
  assert.equal(first.page.seen_to, null, "the first visit has no place yet");
  assert.equal(first.seen.seen_to, first.page.window.to);
  assert.equal(await consolePending(), 0, "the visit cleared it");
  assert.equal(
    (await pointers(personId)).activity_seen_at,
    null,
    "no agent ever marked, and the Console did not either",
  );

  // The next visit opens from the place the last one left.
  await admit(PLAYER);
  assert.equal(await consolePending(), 1);
  const second = await visit();
  assert.equal(second.page.seen_to, first.page.window.to);
  assert.equal(await consolePending(), 0);
});

test("an agent's mark_read never clears the Console's dot", async () => {
  await admit(PLAYER);
  assert.equal(await consolePending(), 1);
  assert.ok((await agentsPending()) >= 1, "the agents see it too");
  const consoleBefore = (await pointers(personId)).console_timeline_seen_at;

  // A first poll: no pointer yet, so it asks to mark (an observed read).
  const read = await mcp("elixir_timeline", { mark_read: true });
  assert.equal(read.isError, false, JSON.stringify(read.body));
  assert.equal(read.body.applied.mark_read, true);
  assert.equal(
    (await pointers(personId)).activity_seen_at.toISOString(),
    read.body.read_to,
    "the agents' pointer moved",
  );
  assert.equal(await agentsPending(), 0, "the agents have read it");
  assert.equal(await consolePending(), 1, "the Console has not shown it");
  assert.equal(
    String((await pointers(personId)).console_timeline_seen_at),
    String(consoleBefore),
    "mark_read never moves the Console's place",
  );
});

test("a Console visit never moves what an agent sees as read or pending", async () => {
  await admit(PLAYER);
  assert.ok((await agentsPending()) >= 1);
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
  const pendingBefore = await agentsPending();
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
    await agentsPending(),
    pendingBefore,
    "meta.timeline_pending is unchanged",
  );
  await db.query(`delete from timeline_reader where account_id = $1`, [
    personId,
  ]);
});

test("on an agent's console the place is the agent's, moved by its owner, and still not its read pointer", async () => {
  await admit(CLAN);
  assert.equal(await consolePending(AGENT_PID), 1);
  const personBefore = await pointers(personId);
  const { page, seen } = await visit(AGENT_PID);
  assert.equal(seen.seen_to, page.window.to);
  assert.equal(await consolePending(AGENT_PID), 0);
  const agent = await pointers(agentId);
  assert.equal(agent.console_timeline_seen_at.toISOString(), page.window.to);
  assert.equal(agent.activity_seen_at, null, "the agent's own read pointer");
  assert.equal(
    String((await pointers(personId)).console_timeline_seen_at),
    String(personBefore.console_timeline_seen_at),
    "the owner's place is their own",
  );
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

  // A write: without the Console's contract header it is refused, and a
  // stranger's guess at an agent finds nothing.
  const bare = await call({
    method: "POST",
    path: "/api/me/timeline/seen",
    body: { to: new Date().toISOString() },
    contract: false,
  });
  assert.equal(bare.status, 401);
  const other = await call({
    method: "POST",
    path: "/api/agent/notmyagent1/timeline/seen",
    body: { to: new Date().toISOString() },
  });
  assert.equal(other.status, 404);
  assert.equal(
    String((await pointers(personId)).console_timeline_seen_at),
    String(at),
  );
});
