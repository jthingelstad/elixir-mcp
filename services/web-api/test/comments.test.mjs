/**
 * Comments, blocks and reports (2026-11-16), against a real PostgreSQL
 * database and the real handler, with the model faked. Pinned here:
 *
 * - the check runs before every post and fails closed (an error, a throw,
 *   an answer that is not a verdict, the month's cap): nothing posts
 *   unchecked, and the words are kept only on a refusal;
 * - who may comment: a Verified player of their own, an item in their
 *   own feed, the owner's setting (followers, following, nobody);
 * - a block is an access-control property: the blocked person's reads
 *   hold none of the blocker's comments, and the blocker's hold none of
 *   theirs, in the item's list and on the feed's cards alike; the follows
 *   between them end;
 * - two reports from different accounts hide a comment; the reporter
 *   stops seeing it at once; its author still does; an admin decides;
 * - rate limits and the cooldown after refusals;
 * - a stock comment ("gg") posts without the model; the wait for the
 *   model is 12 s, inside the request's deadline, and nothing is stored
 *   on a refusal, an error, a pause or a pass that lands too late;
 * - with comments off every person route answers 404 comments_off.
 *
 * Made-up tags: this repository is public.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { ensurePassport } from "@elixir-mcp/stamps";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { makeHandler } from "../src/handler.mjs";
import { withComments } from "../src/comments.mjs";
import { readFile } from "node:fs/promises";
import {
  createModelBridge,
  modelRequestKey,
} from "@elixir-mcp/clan/model-bridge.mjs";
import { createBox } from "@elixir-mcp/clan/sealed.mjs";
import {
  MODERATION_WAIT_MS,
  REFUSAL_WORDS,
  UNKNOWN_CHECK_USD,
} from "../src/comment-check.mjs";

const V = "#0YRL2GQP"; // OWNER's primary, verified
const R = "#0LCVJ8YR"; // READER's primary, verified
const F = "#0UVC8J9R"; // FAN's primary, verified
const S = "#0PJ8LQ2Y"; // SPAMMER's primary, verified
const U = "#0QYC9U2P"; // UNVERIFIED's primary, claimed only

let scratch, handler, offHandler, cappedHandler;
let OWNER, READER, FAN, SPAMMER, UNVERIFIED, ADMIN;
let ITEM;
const sessions = new Map();
const pageIds = new Map();
const data = (r) => JSON.parse(r.body);

/** The fake model: answers what `next` says, and records each request. */
const asked = [];
let next = () => ({ allow: true, category: "none" });
const moderate = async (input) => {
  asked.push(input);
  const say = await next(input);
  if (say instanceof Error) throw say;
  if (say?.ok === false) return say;
  return {
    ok: true,
    model: "claude-haiku-5-5",
    input: say,
    usage: { input_tokens: 900, output_tokens: 12 },
  };
};

async function person(hash, role = "member") {
  const id = (
    await scratch.db.query(
      `insert into account(email_hash,status,role) values ($1,'approved',$2)
       returning account_id`,
      [hash, role],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  pageIds.set(id, (await ensurePassport(scratch.db, id)).passport_id);
  return id;
}
const callWith =
  (h) =>
  (id, method, path, body, query = {}) =>
    h({
      path,
      method,
      queryStringParameters: query,
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(id)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
let call;
const claim = (account, tag, relationship, verified = false) =>
  scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      account,
      tag,
      verified ? "verified" : "unverified",
      relationship === "primary",
      relationship,
      verified ? new Date() : null,
    ],
  );
const follow = (reader, tag) =>
  call(reader, "POST", "/api/claims", {
    player_tag: tag,
    relationship: "friend",
  });
const post = (id, text, item = ITEM) =>
  call(id, "POST", "/api/me/comments", {
    item_id: item,
    subjects: [V],
    text,
  });
const list = (id) =>
  call(id, "GET", "/api/me/comments", null, { item: ITEM, subjects: V });
const texts = async (id) => {
  const r = await list(id);
  assert.equal(r.statusCode, 200, r.body);
  return data(r).comments.map((c) => c.text);
};
const checks = async (accountId) =>
  (
    await scratch.db.query(
      `select verdict, stage, category, body, cost_usd::text as cost
         from comment_check where account_id = $1 order by check_id`,
      [accountId],
    )
  ).rows;

before(async () => {
  scratch = await scratchDb("comments");
  const { db } = scratch;
  for (const tag of [V, R, F, S, U])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `Name ${tag}`,
    ]);
  const comments = { enabled: true, capUsd: 10, moderate };
  handler = makeHandler({ databaseUrl: scratch.url, secret: "test", comments });
  offHandler = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  cappedHandler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments: { ...comments, capUsd: 0.0001 },
  });
  call = callWith(handler);
  OWNER = await person("cm-owner");
  READER = await person("cm-reader");
  FAN = await person("cm-fan");
  SPAMMER = await person("cm-spammer");
  UNVERIFIED = await person("cm-unverified");
  ADMIN = await person("cm-admin", "admin");
  await claim(OWNER, V, "primary", true);
  await claim(READER, R, "primary", true);
  await claim(FAN, F, "primary", true);
  await claim(SPAMMER, S, "primary", true);
  await claim(UNVERIFIED, U, "primary");
  // One item about V this week: a personal record.
  const at = new Date(Date.now() - 3_600_000).toISOString();
  await db.query(
    `insert into attested_fact
       (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
     values ('player',$1,'personal_record','{"game":"drop","score":10}','player',
             'drop.poapkings.com','comments-test',$2,$2)`,
    [V, at],
  );
  const built = await buildTimeline(
    db,
    [{ kind: "player", tag: V, relationship: "friend", nickname: null }],
    {
      fromMs: Date.now() - 86_400_000,
      toMs: Date.now(),
      accountId: OWNER,
      interactive: true,
      accountLines: false,
    },
  );
  ITEM = built.timeline[0]?.id;
  assert.match(ITEM, /^tl_[0-9a-f]{20}$/);
});

after(async () => {
  await scratch?.drop();
});

test("with comments off, every person route answers 404 comments_off", async () => {
  const off = callWith(offHandler);
  for (const [method, path, body] of [
    ["GET", "/api/me/comments"],
    ["POST", "/api/me/comments", { item_id: "tl_0", text: "gg" }],
    ["DELETE", "/api/me/comments/1"],
    ["POST", "/api/me/comment-reports", { id: "1", reason: "spam" }],
    ["GET", "/api/me/comment-setting"],
    ["PUT", "/api/me/comment-setting", { who: "nobody" }],
    ["GET", "/api/me/blocks"],
    ["POST", "/api/me/blocks", { player_tag: V }],
    ["DELETE", "/api/me/blocks/aaaaaaaaaaaa"],
  ]) {
    const r = await off(READER, method, path, body);
    assert.equal(r.statusCode, 404, `${method} ${path}`);
    assert.equal(data(r).error, "comments_off");
  }
  // And Settings is told the feature is off.
  const me = data(await off(READER, "GET", "/api/me"));
  assert.equal(me.features?.comments, false);
});

test("an item outside the reader's feed is not found; following opens it", async () => {
  const r = await post(READER, "gg");
  assert.equal(r.statusCode, 404, r.body);
  assert.equal(asked.length, 0, "no check for an item not in the feed");
  assert.equal((await follow(READER, V)).statusCode, 200);
  const opened = data(await list(READER));
  assert.equal(opened.open, true);
  assert.deepEqual(opened.comments, []);
});

test("a person with no Verified player may not comment", async () => {
  await follow(UNVERIFIED, V);
  const r = await post(UNVERIFIED, "gg");
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(data(r).error, "not_verified");
  assert.equal(data(await list(UNVERIFIED)).open, false);
  assert.equal(asked.length, 0);
});

test("an allowed comment posts after the check, and its words are not kept in the log", async () => {
  next = () => ({ allow: true, category: "none" });
  const r = await post(READER, "  that   Hog cycle was​ clean gg ");
  assert.equal(r.statusCode, 201, r.body);
  const { comment } = data(r);
  assert.equal(comment.text, "that Hog cycle was clean gg");
  assert.equal(comment.mine, true);
  assert.equal(comment.author.player_tag, R);
  assert.equal(comment.author.account_id, pageIds.get(READER));
  assert.match(comment.id, /^[1-9][0-9]*$/, "a bigint id travels as a string");
  // The model was asked once, with the words and the item, nothing more.
  assert.equal(asked.length, 1);
  assert.equal(asked[0].model, "claude-haiku-5-5");
  assert.match(
    asked[0].prompt,
    /<comment>\nthat Hog cycle was clean gg\n<\/comment>/,
  );
  assert.match(asked[0].prompt, /A player with a verified Clash Royale player/);
  const [row] = await checks(READER);
  assert.equal(row.verdict, "allow");
  assert.equal(row.stage, "model");
  assert.equal(
    row.body,
    null,
    "an allowed comment's words stay out of the log",
  );
  assert.ok(Number(row.cost) > 0);
  // The owner sees it on the item and on the feed's card.
  assert.deepEqual(await texts(OWNER), ["that Hog cycle was clean gg"]);
});

test("the feed's cards carry the count, the latest two and whether the reader may add one", async () => {
  const items = [
    {
      id: ITEM,
      kind: "personal_record",
      section: "attested",
      subjects: [{ kind: "player", tag: V }],
    },
  ];
  const [card] = await withComments(scratch.db, items, READER, {
    enabled: true,
  });
  assert.equal(card.comments.count, 1);
  assert.equal(card.comments.open, true);
  assert.equal(card.comments.latest[0].text, "that Hog cycle was clean gg");
  const [off] = await withComments(scratch.db, items, READER, {
    enabled: false,
  });
  assert.equal(off.comments, undefined, "off leaves the items as they are");
  // An unrecognized shape is never enough to admit a thread.
  const [news] = await withComments(
    scratch.db,
    [
      {
        id: "tl_00000000000000000001",
        subjects: [{ kind: "clan", tag: "#0RQYGC2L" }],
      },
    ],
    READER,
    { enabled: true },
  );
  assert.equal(news.comments, null);
});

test("a filter refusal never reaches the model and keeps the words for the queue", async () => {
  const before = asked.length;
  // FAN does not follow V yet: the item is not in their feed.
  assert.equal((await post(FAN, "check my site dot com")).statusCode, 404);
  await follow(FAN, V);
  const r = await post(FAN, "check my site dot com");
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(data(r).category, "link");
  assert.equal(data(r).message, REFUSAL_WORDS.link);
  assert.equal(asked.length, before, "the model was not asked");
  const [row] = await checks(FAN);
  assert.deepEqual(
    { verdict: row.verdict, stage: row.stage, category: row.category },
    { verdict: "refuse", stage: "filter", category: "link" },
  );
  assert.equal(row.body, "check my site dot com");
});

test("a model refusal names one plain reason and posts nothing", async () => {
  next = () => ({ allow: false, category: "harassment" });
  const r = await post(FAN, "you are trash at this game uninstall");
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(data(r).category, "harassment");
  assert.equal(data(r).message, REFUSAL_WORDS.harassment);
  assert.deepEqual(await texts(OWNER), ["that Hog cycle was clean gg"]);
});

test("the check fails closed: an error, a throw or a non-verdict posts nothing", async () => {
  for (const say of [
    () => ({ ok: false, code: "outcome_unknown" }),
    () => new Error("timeout"),
    () => ({ maybe: true }),
  ]) {
    next = say;
    const r = await post(OWNER, "nice one me");
    assert.equal(r.statusCode, 503, r.body);
    assert.equal(data(r).error, "unavailable");
  }
  const rows = await checks(OWNER);
  assert.deepEqual(
    rows.map((r) => r.verdict),
    ["error", "error", "error"],
  );
  // An answer with no usage is charged a cent, so errors still reach the cap.
  assert.equal(Number(rows[1].cost), UNKNOWN_CHECK_USD);
  assert.deepEqual(await texts(OWNER), ["that Hog cycle was clean gg"]);
});

test("at the month's cap, comments pause and the model is not asked", async () => {
  next = () => ({ allow: true, category: "none" });
  const before = asked.length;
  const r = await callWith(cappedHandler)(OWNER, "POST", "/api/me/comments", {
    item_id: ITEM,
    subjects: [V],
    text: "my own words",
  });
  assert.equal(r.statusCode, 503, r.body);
  assert.equal(data(r).error, "paused");
  assert.equal(asked.length, before);
  assert.equal((await checks(OWNER)).at(-1).verdict, "paused");
});

test("three refusals in an hour start a cooldown", async () => {
  await follow(SPAMMER, V);
  next = () => ({ allow: false, category: "spam" });
  for (let i = 0; i < 3; i++)
    assert.equal((await post(SPAMMER, `free gems ${i}`)).statusCode, 422);
  const before = asked.length;
  const r = await post(SPAMMER, "a fine comment now");
  assert.equal(r.statusCode, 429, r.body);
  assert.equal(data(r).error, "cooldown");
  assert.ok(data(r).until);
  assert.equal(asked.length, before);
});

test("more than five checks in a minute are rate limited", async () => {
  await scratch.db.query(
    `insert into comment_check (account_id, item_id, verdict, stage)
     select $1, $2, 'allow', 'model' from generate_series(1, 5)`,
    [FAN, ITEM],
  );
  const r = await post(FAN, "one more");
  assert.equal(r.statusCode, 429, r.body);
  assert.equal(data(r).error, "rate_limited");
  await scratch.db.query(
    `delete from comment_check where account_id = $1 and verdict = 'allow'`,
    [FAN],
  );
});

test("the owner's setting decides who may comment", async () => {
  const set = (who) => call(OWNER, "PUT", "/api/me/comment-setting", { who });
  assert.equal(
    data(await call(OWNER, "GET", "/api/me/comment-setting")).who,
    "followers",
  );
  assert.equal((await set("loud")).statusCode, 400);
  assert.equal(data(await set("nobody")).who, "nobody");
  assert.equal(data(await list(READER)).open, false);
  assert.equal(data(await post(READER, "still here")).error, "not_open");
  // The owner may always comment on their own items.
  next = () => ({ allow: true, category: "none" });
  assert.equal((await post(OWNER, "thanks all")).statusCode, 201);
  // "following": only people the owner follows back.
  await set("following");
  assert.equal(data(await list(READER)).open, false);
  await call(OWNER, "POST", "/api/claims", {
    player_tag: R,
    relationship: "friend",
  });
  assert.equal(data(await list(READER)).open, true);
  assert.equal(data(await list(FAN)).open, false);
  await set("followers");
  assert.equal(data(await list(FAN)).open, true);
});

test("reports: two hide a comment, the reporter stops seeing it at once, the author still does", async () => {
  const mine = data(await list(READER)).comments.find((c) => c.mine);
  assert.ok(mine);
  const report = (who, reason = "bullying") =>
    call(who, "POST", "/api/me/comment-reports", { id: mine.id, reason });
  assert.equal((await report(FAN, "rude")).statusCode, 400);
  // Someone the item is not in the feed of may not report its comments,
  // whatever id they guess (Codex on #1078).
  const outsider = await person("cm-outsider");
  assert.equal((await report(outsider)).statusCode, 404);
  // The subjects a report names only narrow: they never open an item the
  // reader's own follows do not (Codex on #1082).
  assert.equal(
    (
      await call(outsider, "POST", "/api/me/comment-reports", {
        id: mine.id,
        reason: "bullying",
        subjects: [V, "#0GVJ9V"],
      })
    ).statusCode,
    404,
  );
  assert.equal((await report(READER)).statusCode, 404, "never your own");
  assert.equal((await report(FAN)).statusCode, 200);
  assert.ok(
    !(await texts(FAN)).includes(mine.text),
    "the reporter no longer sees it",
  );
  assert.ok(
    (await texts(OWNER)).includes(mine.text),
    "one report hides nothing",
  );
  assert.equal((await report(OWNER, "spam")).statusCode, 200);
  assert.ok(!(await texts(SPAMMER)).includes(mine.text), "two reports hide it");
  assert.ok(
    (await texts(READER)).includes(mine.text),
    "its author still sees it",
  );
  // Admin: the queue holds it with both reports; a member is refused.
  assert.equal((await call(FAN, "GET", "/api/admin/comments")).statusCode, 403);
  const q = data(await call(ADMIN, "GET", "/api/admin/comments"));
  const queued = q.reported.find((c) => c.id === mine.id);
  assert.equal(queued.status, "hidden");
  assert.equal(queued.reports.length, 2);
  assert.ok(q.refused.some((c) => c.text === "check my site dot com"));
  assert.ok(q.month.checks > 0);
  // Dismissed: it shows again, and the queue is clear of it.
  assert.equal(
    (await call(ADMIN, "POST", "/api/admin/comments/dismiss", { id: mine.id }))
      .statusCode,
    200,
  );
  assert.ok((await texts(SPAMMER)).includes(mine.text));
  assert.ok(
    !data(await call(ADMIN, "GET", "/api/admin/comments")).reported.some(
      (c) => c.id === mine.id,
    ),
  );
});

test("a block is silent, ends the follows and hides each side's comments from the other", async () => {
  next = () => ({ allow: true, category: "none" });
  assert.equal((await post(FAN, "great push")).statusCode, 201);
  // The owner's bell names player-visible personal-record comments.
  const bell = data(await call(OWNER, "GET", "/api/me/bell"));
  assert.ok(bell.comments.items.some((c) => c.text === "great push"));
  assert.ok(bell.comments.items.some((c) => c.text.startsWith("that Hog")));
  const fanSaw = await texts(FAN);
  assert.ok(fanSaw.includes("that Hog cycle was clean gg"));
  // The owner blocks READER by one of READER's comments.
  const theirs = data(await list(OWNER)).comments.find(
    (c) => c.author.player_tag === R,
  );
  const r = await call(OWNER, "POST", "/api/me/blocks", {
    comment_id: theirs.id,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(
    data(r).blocks.map((b) => b.account_id),
    [pageIds.get(READER)],
  );
  // The follows between them are gone, both ways.
  const { rows } = await scratch.db.query(
    `select account_id, player_tag from claim
      where relationship = 'friend' and account_id = any($1::uuid[])
        and player_tag = any($2::text[])`,
    [
      [OWNER, READER],
      [V, R],
    ],
  );
  assert.deepEqual(rows, []);
  // The owner's reads hold none of READER's comments.
  const ownerSees = data(await list(OWNER)).comments;
  assert.ok(ownerSees.every((c) => c.author.player_tag !== R));
  const [card] = await withComments(
    scratch.db,
    [
      {
        id: ITEM,
        kind: "personal_record",
        section: "attested",
        subjects: [{ kind: "player", tag: V }],
      },
    ],
    OWNER,
    { enabled: true },
  );
  assert.ok(card.comments.latest.every((c) => c.author.player_tag !== R));
  // READER's reads hold none of the owner's, even on a card they still
  // hold, and they may not comment on the owner's items.
  const [theirCard] = await withComments(
    scratch.db,
    [
      {
        id: ITEM,
        kind: "personal_record",
        section: "attested",
        subjects: [{ kind: "player", tag: V }],
      },
    ],
    READER,
    { enabled: true },
  );
  assert.ok(theirCard.comments.latest.every((c) => c.author.player_tag !== V));
  assert.equal(theirCard.comments.open, false);
  // Following again is refused as if the player had no owner.
  const again = await follow(READER, V);
  assert.notEqual(again.statusCode, 200);
  // Nobody tells READER: their own block list is empty.
  assert.deepEqual(
    data(await call(READER, "GET", "/api/me/blocks")).blocks,
    [],
  );
  // Cheers on the owner's item: READER's (blocked) is left out of the
  // owner's bell, FAN's (no block) still counts. An unqualified column
  // in the block predicate once got both wrong (Codex on #1078).
  await scratch.db.query(
    `insert into timeline_cheer (account_id, item_id, cheer)
     values ($1, $3, 'royal'), ($2, $3, 'wow')`,
    [READER, FAN, ITEM],
  );
  const cheered = data(await call(OWNER, "GET", "/api/me/bell"));
  const reaction = cheered.reactions.items.find((x) => x.item_id === ITEM);
  assert.deepEqual(reaction?.cheers, { wow: 1 }, JSON.stringify(cheered));
  await scratch.db.query(
    "delete from timeline_cheer where item_id = $1 and account_id = any($2::uuid[])",
    [ITEM, [READER, FAN]],
  );
  // The owner's bell leaves READER's comments out.
  const after = data(await call(OWNER, "GET", "/api/me/bell"));
  assert.ok(after.comments.items.every((c) => !c.text.startsWith("that Hog")));
  assert.ok(after.comments.items.some((c) => c.text === "great push"));
  // Unblock: comments show again; follows stay ended.
  const un = await call(
    OWNER,
    "DELETE",
    `/api/me/blocks/${pageIds.get(READER)}`,
  );
  assert.equal(un.statusCode, 200, un.body);
  assert.deepEqual(data(un).blocks, []);
  assert.ok(
    data(await list(OWNER)).comments.some((c) => c.author.player_tag === R),
  );
});

test("blocking yourself is refused, and so is a page nobody owns", async () => {
  const self = await call(OWNER, "POST", "/api/me/blocks", { player_tag: V });
  assert.equal(self.statusCode, 400);
  const nobody = await call(OWNER, "POST", "/api/me/blocks", {
    account_id: "zzzzzzzzzzzz",
  });
  assert.equal(nobody.statusCode, 404);
});

test("the owner removes a comment (kept for admins); an author deletes their own outright", async () => {
  const fans = data(await list(OWNER)).comments.find(
    (c) => c.author.player_tag === F,
  );
  assert.equal(fans.can_delete, true, "the owner may remove it");
  const gone = await call(OWNER, "DELETE", `/api/me/comments/${fans.id}`);
  assert.equal(data(gone).removed, true);
  assert.ok(!(await texts(FAN)).includes("great push"));
  const { rows } = await scratch.db.query(
    `select status, removed_by from timeline_comment where comment_id = $1::bigint`,
    [fans.id],
  );
  assert.deepEqual(rows[0], { status: "removed", removed_by: "owner" });
  // A stranger may not delete someone else's.
  const owners = data(await list(OWNER)).comments.find((c) => c.mine);
  assert.equal(
    (await call(FAN, "DELETE", `/api/me/comments/${owners.id}`)).statusCode,
    404,
  );
  const own = await call(OWNER, "DELETE", `/api/me/comments/${owners.id}`);
  assert.equal(data(own).deleted, true);
  const { rows: left } = await scratch.db.query(
    `select 1 from timeline_comment where comment_id = $1::bigint`,
    [owners.id],
  );
  assert.equal(left.length, 0);
});

test("admin removal and suspension", async () => {
  const one = data(await list(OWNER)).comments[0];
  assert.equal(
    (await call(FAN, "POST", "/api/admin/comments/remove", { id: one.id }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(ADMIN, "POST", "/api/admin/comments/remove", { id: one.id }))
      .statusCode,
    200,
  );
  const s = await call(ADMIN, "POST", "/api/admin/comment-suspensions", {
    account_id: pageIds.get(FAN),
    days: 7,
  });
  assert.equal(s.statusCode, 200, s.body);
  assert.equal(data(await list(FAN)).open, false);
  assert.equal(data(await post(FAN, "hello")).error, "not_open");
  await call(ADMIN, "POST", "/api/admin/comment-suspensions", {
    account_id: pageIds.get(FAN),
    days: 0,
  });
  assert.equal(data(await list(FAN)).open, true);
});

test("posts from one account are checked one at a time (Codex on #1078)", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  // A clean minute for the owner: earlier tests spent their limits.
  await scratch.db.query("delete from comment_check where account_id = $1", [
    OWNER,
  ]);
  next = async () => {
    await gate;
    return { allow: true, category: "none" };
  };
  const first = post(OWNER, "one at a time please");
  // The first is with the model; a second waits for nothing and is told so.
  await new Promise((r) => setTimeout(r, 200));
  const second = await post(OWNER, "and another one");
  assert.equal(second.statusCode, 429, second.body);
  assert.match(data(second).message, /still being checked/);
  release();
  const firstOut = await first;
  assert.equal(firstOut.statusCode, 201, firstOut.body);
  next = () => ({ allow: true, category: "none" });
  // The lock is let go: the next post is checked as usual.
  assert.equal((await post(OWNER, "and now another")).statusCode, 201);
});

test("a bearer that is not a session never reaches the comment routes", async () => {
  const sub = await subjectsFor(scratch.db, READER);
  assert.ok(Array.isArray(sub));
  const r = await handler({
    path: "/api/me/comments",
    method: "POST",
    headers: {
      authorization: "Bearer not-a-person",
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    body: JSON.stringify({ item_id: ITEM, text: "hi" }),
  });
  assert.ok([401, 403].includes(r.statusCode), r.body);
});

test("a pause that has ended reads as none (Codex on #1081)", async () => {
  await scratch.db.query(
    `insert into comment_setting (account_id, suspended_until)
     values ($1, now() - interval '1 day')
     on conflict (account_id) do update
       set suspended_until = excluded.suspended_until`,
    [SPAMMER],
  );
  const r = await call(SPAMMER, "GET", "/api/me/comment-setting");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(data(r).suspended_until, null);
});

test("Admin's pause is the cap's state now, beside the checks it turned away (Codex on #1081)", async () => {
  const on = data(await call(ADMIN, "GET", "/api/admin/comments"));
  assert.equal(on.month.paused, false);
  assert.equal(typeof on.month.paused_checks, "number");
  const noCap = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments: { enabled: true, capUsd: 0, moderate },
  });
  const off = data(await callWith(noCap)(ADMIN, "GET", "/api/admin/comments"));
  assert.equal(off.month.paused, true);
});

test("a player page says whether you blocked its verified owner (Codex on #1081)", async () => {
  const page = async (who) =>
    data(await call(who, "GET", "/api/player", null, { tag: V }));
  const before = await page(UNVERIFIED);
  assert.equal(before.you.blocked, false);
  await scratch.db.query(
    `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
    [UNVERIFIED, OWNER],
  );
  assert.equal((await page(UNVERIFIED)).you.blocked, true);
  // Never the other way: the owner is not told.
  assert.equal((await page(OWNER)).you.blocked, false);
  await scratch.db.query(
    `delete from account_block where account_id = $1 and blocked_account_id = $2`,
    [UNVERIFIED, OWNER],
  );
});

/** A new verified commenter who follows V. */
async function commenter(hash, tag) {
  const id = await person(hash);
  await scratch.db.query("insert into player(player_tag,name) values ($1,$2)", [
    tag,
    `Name ${tag}`,
  ]);
  await claim(id, tag, "primary", true);
  await follow(id, V);
  return id;
}
const stored = async (accountId) =>
  Number(
    (
      await scratch.db.query(
        "select count(*) from timeline_comment where account_id = $1",
        [accountId],
      )
    ).rows[0].count,
  );

test("a stock comment posts without the model; a repeat of it is still refused", async () => {
  const QUICK = await commenter("cm-quick", "#0PLUG2V9");
  next = () => ({ allow: true, category: "none" });
  const before = asked.length;
  const r = await post(QUICK, "GG  wp!!");
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(data(r).comment.text, "GG wp!!");
  assert.equal(asked.length, before, "the model was not asked");
  const [row] = await checks(QUICK);
  assert.deepEqual(
    { verdict: row.verdict, stage: row.stage, category: row.category },
    { verdict: "allow", stage: "filter", category: "stock" },
  );
  assert.equal(Number(row.cost), 0);
  // The repeat rule runs before the list: the same words today are refused.
  const again = await post(QUICK, "gg wp!!");
  assert.equal(again.statusCode, 422, again.body);
  assert.equal(data(again).message, REFUSAL_WORDS.repeated);
  // Emoji alone are read by the model.
  assert.equal((await post(QUICK, "🔥🔥")).statusCode, 201);
  assert.equal(asked.length, before + 1);
});

test("the model's wait is 12 s, inside the request's deadline, and silence answers unavailable", async () => {
  // index.mjs builds the comment bridge with this wait and nothing else.
  const index = await readFile(new URL("../src/index.mjs", import.meta.url));
  assert.match(String(index), /timeoutMs: MODERATION_WAIT_MS,/);
  // The soft deadline is 18.5 s (deadline.mjs) and a write keeps 3 s back;
  // the app gives up at 20 s (apps/web client).
  assert.ok(MODERATION_WAIT_MS + 3000 + 2000 <= 18_500);
  const WAIT = await commenter("cm-wait", "#0GRJCUV");
  const objects = new Map();
  let clock = 1_000_000;
  const bridge = createModelBridge({
    secret: "test-bridge",
    storage: {
      async get(k) {
        return objects.get(k) ?? null;
      },
      async put(k, text) {
        objects.set(k, text);
        return true;
      },
    },
    now: () => clock,
    // The relay never answers: time passes as the bridge polls.
    pause: async (ms) => {
      clock += ms;
    },
    timeoutMs: MODERATION_WAIT_MS,
  });
  const quiet = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    comments: { enabled: true, capUsd: 10, moderate: bridge.moderate },
  });
  const r = await callWith(quiet)(WAIT, "POST", "/api/me/comments", {
    item_id: ITEM,
    subjects: [V],
    text: "that Hog cycle was clean",
  });
  assert.equal(r.statusCode, 503, r.body);
  assert.equal(data(r).error, "unavailable");
  assert.equal(data(r).message, REFUSAL_WORDS.unavailable);
  assert.ok(clock - 1_000_000 >= MODERATION_WAIT_MS);
  assert.ok(clock - 1_000_000 < MODERATION_WAIT_MS + 500);
  // The relay was told the same wait.
  const [key] = [...objects.keys()];
  const id = key.slice("clan-model/request/".length, -".json".length);
  assert.equal(key, modelRequestKey(id));
  const box = createBox("test-bridge", "clan model bridge v1");
  const sealed = JSON.parse(objects.get(key)).box;
  assert.equal(
    JSON.parse(box.open(sealed, `request:${id}`)).timeout_ms,
    MODERATION_WAIT_MS,
  );
  assert.equal(await stored(WAIT), 0);
  await quiet.close();
});

test("nothing is stored on a refusal, an error, a pause or a pass that lands too late", async () => {
  const SLOW = await commenter("cm-slow", "#0Q2L8");
  next = () => ({ allow: false, category: "spam" });
  assert.equal((await post(SLOW, "free gems here")).statusCode, 422);
  next = () => ({ ok: false, code: "outcome_unknown" });
  assert.equal((await post(SLOW, "rematch me")).statusCode, 503);
  next = () => ({ allow: true, category: "none" });
  const paused = await callWith(cappedHandler)(
    SLOW,
    "POST",
    "/api/me/comments",
    { item_id: ITEM, subjects: [V], text: "paused words" },
  );
  assert.equal(paused.statusCode, 503, paused.body);
  assert.equal(data(paused).error, "paused");
  // A pass after the write margin: the request's soft deadline is 3.1 s
  // away, the write must begin 3 s before it, and the model takes 0.2 s.
  next = async () => {
    await new Promise((r) => setTimeout(r, 200));
    return { allow: true, category: "none" };
  };
  const late = await handler(
    {
      path: "/api/me/comments",
      method: "POST",
      queryStringParameters: {},
      headers: {
        cookie: `__Host-elixir_session=${sessions.get(SLOW)}`,
        "x-elixir-client": "web",
        "cloudfront-viewer-address": "8.8.4.4:443",
      },
      body: JSON.stringify({ item_id: ITEM, subjects: [V], text: "late one" }),
    },
    { requestId: "late-test", remainingMs: () => 4600 },
  );
  next = () => ({ allow: true, category: "none" });
  assert.equal(late.statusCode, 503, late.body);
  assert.equal(data(late).error, "unavailable");
  assert.deepEqual(
    (await checks(SLOW)).map((c) => `${c.verdict}:${c.category ?? ""}`),
    ["refuse:spam", "error:outcome_unknown", "paused:", "error:late"],
  );
  assert.equal(await stored(SLOW), 0);
});
