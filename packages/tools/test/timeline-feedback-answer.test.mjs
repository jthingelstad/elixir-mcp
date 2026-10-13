/**
 * `account_feedback_responded` (#536 stage 2, 11.13.0): one item per
 * answer, never folded into an account burst; its story is the feedback
 * item, so a revised answer is the same id at a higher revision; its
 * facts are the item as filed and the answer as given, each revision with
 * its own words; it leads to `elixir_my_feedback`.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { answerFeedback } from "@elixir-mcp/feedback";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { buildTimeline, storyId } from "../src/activity/entries.mjs";
import { itemSchema, missingFacts } from "../src/activity/schemas.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

let s;
let db;
let accountId;
let other;
const HOUR = 3_600_000;

before(async () => {
  s = await scratchDb("timeline_feedback_answer");
  db = s.db;
  const account = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, email, status) values ($1, $2, 'approved')
         returning account_id`,
        [hash, `${hash}@example.com`],
      )
    ).rows[0].account_id;
  accountId = await account("answers");
  other = await account("someone-else");
});
after(async () => {
  await s?.drop();
});

const file = async (message, { area = "ladder", owner = accountId } = {}) =>
  (
    await db.query(
      `insert into feedback (account_id, surface, area, category, message, status)
       values ($1, 'web', $2, 'bug', $3, 'new') returning feedback_id`,
      [owner, area, message],
    )
  ).rows[0].feedback_id;

/** The answer items in a window, for one feedback item when `id` names
 *  it (the tests share one account). */
const answers = async (fromMs, toMs, id = null) =>
  (await buildTimeline(db, [], { fromMs, toMs, accountId })).timeline.filter(
    (it) =>
      it.kind === "account_feedback_responded" &&
      (id === null || String(it.facts.feedback_id) === String(id)),
  );

/** Move this item's answers back by `ms`, row and events together, so a
 *  window can hold one answer and not the next. */
const backdate = (feedbackId, ms) =>
  Promise.all([
    db.query(
      `update account_event set created_at = created_at - make_interval(secs => $2 / 1000.0)
        where kind = 'feedback_responded' and detail->>'feedback_id' = $1`,
      [String(feedbackId), ms],
    ),
    db.query(
      `update feedback set responded_at = responded_at - make_interval(secs => $2 / 1000.0)
        where feedback_id = $1`,
      [feedbackId, ms],
    ),
  ]);

test("two answers inside a minute are two items, each with its words, owner-only, no burst", async () => {
  const fromMs = Date.now() - 1000;
  const first = await file("The rank looked off");
  const second = await file("The deck name is wrong", { area: "mcp" });
  await answerFeedback(db, {
    feedbackId: first,
    status: "done",
    response: "Fixed: it reads the live board now.",
    shippedIn: "11.10.1",
  });
  await answerFeedback(db, {
    feedbackId: second,
    status: "needs_info",
    response: "Which deck?",
  });
  const items = await answers(fromMs, Date.now() + 1000);
  assert.equal(items.length, 2, JSON.stringify(items));
  const by = Object.fromEntries(items.map((it) => [it.facts.feedback_id, it]));
  const a = by[Number(first)];
  const b = by[Number(second)];
  assert.ok(a && b, JSON.stringify(items.map((it) => it.facts)));
  assert.equal(a.id, storyId("feedback", String(first)));
  assert.equal(b.id, storyId("feedback", String(second)));
  assert.equal(a.revision, 1);
  assert.equal(a.schema, "account_feedback_responded/3");
  assert.equal(itemSchema(a.kind), "account_feedback_responded/3");
  assert.deepEqual(missingFacts(a), []);
  assert.deepEqual(missingFacts(b), []);
  assert.equal(a.facts.count, 1);
  assert.deepEqual(a.facts.apps, []);
  assert.equal(a.facts.status, "done");
  assert.equal(a.facts.response, "Fixed: it reads the live board now.");
  assert.equal(a.facts.shipped_in, "11.10.1");
  assert.equal(a.facts.area, "ladder");
  assert.equal(a.facts.category, "bug");
  assert.equal(a.facts.message, "The rank looked off");
  assert.equal(a.facts.answered_at, a.at);
  assert.ok(Date.parse(a.facts.filed_at) <= Date.parse(a.at));
  assert.equal(a.visibility, "owner");
  assert.equal(a.publishable, false);
  assert.equal(
    a.text,
    "your account: your feedback “The rank looked off” was answered (done, shipped in 11.10.1).",
  );
  assert.equal(b.facts.status, "needs_info");
  assert.equal(b.facts.shipped_in, null);
  assert.equal(
    b.text,
    "your account: Elixir asked a question about your feedback “The deck name is wrong”.",
  );
  // The other account kinds still fold a burst (#376): unchanged.
  for (let i = 0; i < 3; i++)
    await db.query(
      `insert into account_event (account_id, kind, detail) values ($1, 'connection_revoked', '{}')`,
      [accountId],
    );
  const { timeline } = await buildTimeline(db, [], {
    fromMs,
    toMs: Date.now() + 1000,
    accountId,
  });
  const revoked = timeline.filter(
    (it) => it.kind === "account_connection_revoked",
  );
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].facts.count, 3);
});

test("a revised answer is the same story at a higher revision; each revision tells its own words", async () => {
  const id = await file("War decks look short");
  await answerFeedback(db, {
    feedbackId: id,
    status: "planned",
    response: "Looking into it.",
  });
  await backdate(id, 2 * HOUR);
  await answerFeedback(db, {
    feedbackId: id,
    status: "done",
    response: "Fixed in 11.12.0.",
    shippedIn: "11.12.0",
  });
  const now = Date.now();
  // A window holding only the first answer tells it as it was given.
  const [early] = await answers(now - 3 * HOUR, now - HOUR, id);
  assert.equal(early.id, storyId("feedback", String(id)));
  assert.equal(early.revision, 1);
  assert.equal(early.facts.status, "planned");
  assert.equal(early.facts.response, "Looking into it.");
  assert.equal(early.facts.shipped_in, null);
  // A window holding both tells the story once, at the later answer.
  const both = await answers(now - 3 * HOUR, now + 1000, id);
  assert.equal(both.length, 1, JSON.stringify(both));
  assert.equal(both[0].id, early.id);
  assert.equal(both[0].revision, 2);
  assert.equal(both[0].facts.response, "Fixed in 11.12.0.");
  assert.equal(both[0].facts.shipped_in, "11.12.0");
  assert.equal(
    both[0].text,
    "your account: your feedback “War decks look short” was answered again (done, shipped in 11.12.0).",
  );
});

test("an answer from before 11.13.0 carries the item's words while it is the latest, null once replaced", async () => {
  const id = await file("Old answer");
  const legacy = async (at, status) =>
    db.query(
      `insert into account_event (account_id, kind, detail, created_at)
       values ($1, 'feedback_responded', jsonb_build_object('feedback_id', $2::bigint, 'status', $3::text), $4)`,
      [accountId, id, status, new Date(at)],
    );
  const now = Date.now();
  await legacy(now - 5 * HOUR, "planned");
  await db.query(
    `update feedback set status = 'planned', response = 'On the list.', responded_at = $2
      where feedback_id = $1`,
    [id, new Date(now - 5 * HOUR)],
  );
  const [latest] = await answers(now - 6 * HOUR, now - 4 * HOUR, id);
  assert.equal(latest.facts.response, "On the list.");
  assert.equal(latest.facts.shipped_in, null);
  await legacy(now - 3 * HOUR, "done");
  await db.query(
    `update feedback set status = 'done', response = 'Done now.', shipped_in = '11.9.0',
            responded_at = $2 where feedback_id = $1`,
    [id, new Date(now - 3 * HOUR)],
  );
  const [replaced] = await answers(now - 6 * HOUR, now - 4 * HOUR, id);
  assert.equal(replaced.revision, 1);
  assert.equal(replaced.facts.status, "planned");
  assert.equal(replaced.facts.response, null, "absence over a guess");
  assert.equal(replaced.facts.shipped_in, null);
  const [current] = await answers(now - 4 * HOUR, now - 2 * HOUR, id);
  assert.equal(current.revision, 2);
  assert.equal(current.facts.response, "Done now.");
  assert.equal(current.facts.shipped_in, "11.9.0");
});

test("an event naming no item of the account's keeps its own story and leads nowhere", async () => {
  const theirs = await file("Not yours", { owner: other });
  const fromMs = Date.now() - 1000;
  await db.query(
    `insert into account_event (account_id, kind, detail)
     values ($1, 'feedback_responded', jsonb_build_object('feedback_id', $2::bigint, 'status', 'done'))`,
    [accountId, theirs],
  );
  const [it] = await answers(fromMs, Date.now() + 1000, theirs);
  assert.notEqual(it.id, storyId("feedback", String(theirs)));
  assert.equal(it.facts.message, null, "never another account's words");
  assert.equal(it.facts.response, null);
  assert.deepEqual(missingFacts(it), []);
});

test("elixir_timeline serves the answer with its follow, and reading the timeline marks nothing seen", async () => {
  const id = await file("Follow me");
  const fromMs = Date.now() - 1000;
  await answerFeedback(db, {
    feedbackId: id,
    status: "done",
    response: "Here it is.",
  });
  const invoke = makeInvoker({
    db,
    account: { accountId, timezone: "UTC", credentialType: "oauth" },
    registry: makeRegistry(),
  });
  const res = await invoke("elixir_timeline", {
    from: new Date(fromMs).toISOString(),
    to: new Date(Date.now() + 1000).toISOString(),
    kinds: ["account_feedback_responded"],
    mark_read: false,
  });
  assert.equal(res.isError, false, JSON.stringify(res.body));
  const body = res.body;
  const item = body.timeline.find((x) => x.facts.feedback_id === Number(id));
  assert.ok(item, JSON.stringify(body.timeline));
  assert.deepEqual(item.follow, [
    { tool: "elixir_my_feedback", args: { feedback_id: String(id) } },
  ]);
  const { rows } = await db.query(
    `select response_seen_at from feedback where feedback_id = $1`,
    [id],
  );
  assert.equal(rows[0].response_seen_at, null);
});
