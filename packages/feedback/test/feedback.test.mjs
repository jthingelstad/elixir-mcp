import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import {
  FeedbackError,
  answerFeedback,
  cleanContext,
  cleanRefs,
  feedbackItem,
  feedbackPending,
  feedbackQueue,
  fileFeedback,
  itemMine,
  listMine,
  markSeen,
  unseenCount,
} from "../src/feedback.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_feedback_test_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let person;
let other;
let agent;
const CALL = "11111111-1111-4111-8111-111111111111";
const AGENT_CALL = "22222222-2222-4222-8222-222222222222";
const OTHER_CALL = "33333333-3333-4333-8333-333333333333";
const SEND = "44444444-4444-4444-8444-444444444444";
const OTHER_SEND = "55555555-5555-4555-8555-555555555555";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const make = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
        [hash],
      )
    ).rows[0].account_id;
  person = { accountId: await make("feedback-person") };
  other = { accountId: await make("feedback-other") };
  agent = {
    accountId: (
      await db.query(
        `insert into account (email_hash, status, kind, owned_by_account_id, public_id)
         values (null, 'approved', 'agent', $1, 'fbagent001') returning account_id`,
        [person.accountId],
      )
    ).rows[0].account_id,
    publicId: "fbagent001",
  };
  for (const [account, id] of [
    [person.accountId, CALL],
    [agent.accountId, AGENT_CALL],
    [other.accountId, OTHER_CALL],
  ])
    await db.query(
      `insert into mcp_call_audit (account_id, tool, request_id) values ($1, 'players_summary', $2)`,
      [account, id],
    );
  const {
    rows: [issue],
  } = await db.query(
    `insert into email_issue (kind, period_key) values ('milestone', '2026-10-08') returning issue_id`,
  );
  for (const [account, id] of [
    [person.accountId, SEND],
    [other.accountId, OTHER_SEND],
  ])
    await db.query(
      `insert into email_send (send_id, issue_id, account_id, subject) values ($1, $2, $3, 'A milestone')`,
      [id, issue.issue_id, account],
    );
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("cleanRefs keeps good pointers, normalizes tags, drops the rest with a reason", () => {
  const { refs, dropped } = cleanRefs([
    { kind: "call", ref: CALL.toUpperCase() },
    { kind: "call", ref: CALL },
    { kind: "player", ref: "20jjj2ccru" },
    { kind: "clan_action", ref: "card#J2RGCRVG:42" },
    { kind: "email", ref: "nope" },
    { kind: "planet", ref: "x" },
  ]);
  assert.deepEqual(refs, [
    { kind: "call", ref: CALL },
    { kind: "player", ref: "#20JJJ2CCRU" },
    { kind: "clan_action", ref: "card#J2RGCRVG:42" },
  ]);
  assert.deepEqual(
    dropped.map((d) => d.reason),
    ["not_an_id", "unknown_kind"],
  );
});

test("cleanContext keeps small labelled facts and cuts the rest", () => {
  assert.deepEqual(cleanContext("battles_query pagination"), {
    context: "battles_query pagination",
  });
  assert.deepEqual(
    cleanContext({
      path: "/ladder/decks",
      mode: "ranked",
      nested: { no: 1 },
      "Bad Key": "x",
      long: "y".repeat(500),
    }),
    { path: "/ladder/decks", mode: "ranked", long: "y".repeat(200) },
  );
  assert.equal(cleanContext(null), null);
});

test("filing keeps the filer's own calls and emails and an owned agent's call; another's are dropped as not_yours", async () => {
  const notified = [];
  const out = await fileFeedback(db, {
    account: person,
    surface: "web",
    area: "ladder",
    category: "data_quality",
    message: "  The Decks page counts a deck I never played.  ",
    context: { path: "/ladder/decks", mode: "ladder" },
    refs: [
      { kind: "call", ref: CALL },
      { kind: "call", ref: AGENT_CALL },
      { kind: "call", ref: OTHER_CALL },
      { kind: "email", ref: SEND },
      { kind: "email", ref: OTHER_SEND },
      { kind: "player", ref: "#20JJJ2CCRU" },
    ],
    via: { principal_kind: "person", client_name: "Ladder" },
    from: "account 0123abcd",
    notifyOwner: async (n) => notified.push(n),
  });
  assert.deepEqual(
    out.refs.map((r) => `${r.kind}:${r.ref}`),
    [
      `call:${CALL}`,
      `call:${AGENT_CALL}`,
      `email:${SEND}`,
      "player:#20JJJ2CCRU",
    ],
  );
  assert.deepEqual(
    out.dropped.map((d) => `${d.kind}:${d.reason}`),
    ["call:not_yours", "email:not_yours"],
  );
  const { rows } = await db.query(
    `select surface, area, message, request_id, send_id, context, via from feedback where feedback_id = $1`,
    [out.feedback_id],
  );
  assert.equal(rows[0].area, "ladder");
  assert.equal(rows[0].message, "The Decks page counts a deck I never played.");
  // The old columns still carry the first call and email (one release).
  assert.equal(rows[0].request_id, CALL);
  assert.equal(rows[0].send_id, SEND);
  assert.deepEqual(rows[0].context.request_ids, [CALL, AGENT_CALL]);
  assert.equal(rows[0].context.path, "/ladder/decks");
  assert.deepEqual(rows[0].via, {
    principal_kind: "person",
    client_name: "Ladder",
  });
  assert.equal(notified.length, 1);
  assert.equal(notified[0].area, "ladder");
  assert.equal(notified[0].feedbackId, out.feedback_id);
});

test("filing refuses an empty or over-long message and an unknown category; the owner's own is not news", async () => {
  await assert.rejects(
    fileFeedback(db, {
      account: person,
      surface: "web",
      area: "console",
      message: "   ",
    }),
    (e) => e instanceof FeedbackError && e.code === "bad_message",
  );
  await assert.rejects(
    fileFeedback(db, {
      account: person,
      surface: "web",
      area: "console",
      message: "x".repeat(8001),
    }),
    (e) => e.code === "bad_message" && /8,001/.test(e.message),
  );
  await assert.rejects(
    fileFeedback(db, {
      account: person,
      surface: "web",
      area: "console",
      category: "rant",
      message: "x",
    }),
    (e) => e.code === "bad_category" && /judgment/.test(e.hint),
  );
  const notified = [];
  await fileFeedback(db, {
    account: { ...person, isOwner: true },
    surface: "web",
    area: "clan",
    category: "judgment",
    message: "Mine.",
    notifyOwner: async (n) => notified.push(n),
  });
  assert.equal(notified.length, 0);
});

test("an answer is news once: a revised answer is unseen again, a status-only change is not", async () => {
  const { feedback_id: id } = await fileFeedback(db, {
    account: person,
    surface: "mcp",
    area: "mcp",
    message: "battles_trends needs a mode split.",
  });
  let a = await answerFeedback(db, {
    feedbackId: id,
    status: "planned",
    response: "Planned for the next minor.",
  });
  assert.equal(a.updated, 1);
  assert.equal(a.answered, true);
  assert.equal(await unseenCount(db, person.accountId), 1);
  await markSeen(db, person.accountId, [id]);
  assert.equal(await unseenCount(db, person.accountId), 0);

  a = await answerFeedback(db, { feedbackId: id, status: "seen" });
  assert.equal(a.answered, false);
  assert.equal(await unseenCount(db, person.accountId), 0);

  a = await answerFeedback(db, {
    feedbackId: id,
    status: "done",
    response: "Shipped in 11.3.0.",
    shippedIn: "11.3.0",
    relatedTools: "battles_trends, battles_performance",
  });
  assert.equal(a.answered, true);
  assert.equal(await unseenCount(db, person.accountId), 1);
  const { rows: events } = await db.query(
    `select detail from account_event where account_id = $1 and kind = 'feedback_responded' order by event_id`,
    [person.accountId],
  );
  assert.deepEqual(
    events.map((e) => e.detail.status),
    ["planned", "done"],
  );
  const item = await itemMine(db, person.accountId, id);
  assert.equal(item.status, "done");
  assert.equal(item.shipped_in, "11.3.0");
  assert.deepEqual(item.related_tools, [
    "battles_trends",
    "battles_performance",
  ]);
  assert.equal(
    await unseenCount(db, person.accountId),
    0,
    "opening it read it",
  );

  // A compare-and-set against a stale read changes nothing.
  const stale = await answerFeedback(db, {
    feedbackId: id,
    status: "declined",
    response: "No.",
    expected: { status: "planned", response: null, responded_at: null },
  });
  assert.equal(stale.updated, 0);
  await assert.rejects(
    answerFeedback(db, { feedbackId: id, status: "new" }),
    (e) => e.code === "bad_status",
  );
});

test("a follow-up must follow the filer's own item; another's is dropped", async () => {
  const { feedback_id: first } = await fileFeedback(db, {
    account: person,
    surface: "web",
    area: "console",
    message: "First.",
  });
  const { feedback_id: theirs } = await fileFeedback(db, {
    account: other,
    surface: "web",
    area: "console",
    message: "Theirs.",
  });
  const reply = await fileFeedback(db, {
    account: person,
    surface: "web",
    area: "console",
    message: "Still broken after your fix.",
    followsId: first,
  });
  assert.equal(String(reply.follows_id), String(first));
  const bad = await fileFeedback(db, {
    account: person,
    surface: "web",
    area: "console",
    message: "Hijack.",
    followsId: theirs,
  });
  assert.equal(bad.follows_id, null);
  assert.equal(bad.dropped[0].reason, "not_yours");
  const opened = await itemMine(db, person.accountId, first);
  assert.deepEqual(opened.followed_by.map(String), [String(reply.feedback_id)]);
  await assert.rejects(
    itemMine(db, person.accountId, theirs),
    (e) => e.status === 404,
  );
  const admin = await feedbackItem(db, first);
  assert.deepEqual(
    admin.thread.map((t) => String(t.feedback_id)),
    [String(reply.feedback_id)],
  );
});

test("an agent files as itself with its relayed person; listMine is its own", async () => {
  const out = await fileFeedback(db, {
    account: agent,
    surface: "mcp",
    area: "mcp",
    category: "praise",
    message: "A member loved the war recap.",
    refs: [{ kind: "call", ref: AGENT_CALL }],
    via: {
      principal_kind: "agent",
      on_behalf_of: "discord:1234",
      request_id: "66666666-6666-4666-8666-666666666666",
    },
  });
  assert.equal(out.refs.length, 1);
  const mineList = await listMine(db, agent.accountId, {});
  assert.equal(mineList.items.length, 1);
  assert.equal(mineList.items[0].refs[0].ref, AGENT_CALL);
  assert.equal(mineList.items[0].area, "mcp");
});

test("the queue filters by area and pages; pending counts per area", async () => {
  for (let i = 0; i < 3; i++)
    await fileFeedback(db, {
      account: other,
      surface: "web",
      area: "clan",
      category: "judgment",
      message: `Clan item ${i}`,
      refs: [{ kind: "clan_action", ref: `J2RGCRVG/${i}` }],
    });
  const first = await feedbackQueue(db, { area: "clan", limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.items.every((i) => i.area === "clan"));
  assert.ok(first.next?.before);
  const second = await feedbackQueue(db, {
    area: "clan",
    limit: 2,
    before: first.next.before,
  });
  assert.ok(second.items.length >= 1);
  assert.ok(
    second.items.every(
      (i) => Number(i.feedback_id) < Number(first.next.before),
    ),
  );
  assert.equal(first.items[0].refs[0].kind, "clan_action");
  const clanCount = first.areas.find((a) => a.area === "clan");
  assert.ok(clanCount.total >= 3);
  const pending = await feedbackPending(db, { area: "clan" });
  assert.ok(pending.pending >= 3);
  assert.ok(pending.items.every((i) => i.area === "clan"));
  assert.ok(pending.by_area.length === 1);
});
