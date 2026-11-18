import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { emitEvent } from "../../../packages/ingest/src/events.mjs";
import { createSession } from "@elixir-mcp/auth";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import { timelineItemRef } from "../src/timeline-item-ref.mjs";
import { makeHandler } from "../src/handler.mjs";

const PLAYER = "#0PGQ2UYL";
const OTHER = "#0RJ29CVY";
const CLAN = "#0Q2L8";
const at = new Date(Date.now() - 300_000).toISOString();
let scratch, handler, author, other, milestone, privateItem;
let duringCheck = null;
let checkedPrompts = [];
const cookies = new Map();
const call = async (accountId, method, path, body, query = {}) => {
  const response = await handler({
    method,
    path,
    queryStringParameters: query,
    headers: {
      cookie: cookies.get(accountId),
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...response, data: JSON.parse(response.body) };
};
before(async () => {
  scratch = await scratchDb("milestone_posts");
  const { db } = scratch;
  const person = async (label, tag) => {
    const id = (
      await db.query(
        "insert into account(email_hash,status) values($1,'approved') returning account_id",
        [label],
      )
    ).rows[0].account_id;
    const { token } = await createSession(db, {
      secret: "test",
      accountId: id,
      emailHash: label,
    });
    cookies.set(id, `__Host-elixir_session=${token}`);
    await db.query("insert into player(player_tag,name) values($1,$2)", [
      tag,
      label,
    ]);
    await db.query(
      "insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at) values($1,$2,true,'primary','verified',now())",
      [id, tag],
    );
    return id;
  };
  author = await person("Invented Ada", PLAYER);
  other = await person("Invented Birch", OTHER);
  await db.query(
    "insert into card(card_id,name,kind,elixir_cost,in_catalog) values(26000000,'Knight','card',3,true)",
  );
  await db.query("insert into clan(clan_tag,name) values($1,'Invented Clan')", [
    CLAN,
  ]);
  await db.query(
    "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values($1,$2,'leader',$3)",
    [CLAN, PLAYER, at],
  );
  await db.query(
    "insert into battle(battle_id,battle_time,type,type_class) values($1,$2,'PvP','pvp')",
    ["f".repeat(64), at],
  );
  await db.query(
    "insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,outcome,crowns) values($1,$2,$3,0,'PvP','pvp','win',3)",
    ["f".repeat(64), PLAYER, at],
  );
  await emitEvent(db, "badge_earned", {
    tag: PLAYER,
    payload: {
      name: "MasteryKnight",
      level: 5,
      prior_level: 4,
      max_level: 10,
      rung: 5,
    },
    windowStart: at,
    windowEnd: at,
  });
  await db.query(
    "insert into attested_fact(subject_kind,clan_tag,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at) values('clan',$1,$2,'member_away','{}','leaders','clan.poapkings.com','milestone-private',$3,$3)",
    [CLAN, PLAYER, at],
  );
  const built = await buildTimeline(
    db,
    [
      { kind: "player", tag: PLAYER },
      { kind: "clan", tag: CLAN, scope: "comprehensive" },
    ],
    {
      accountId: author,
      interactive: true,
      fromMs: Date.parse(at) - 60_000,
      toMs: Date.now(),
      basis: "occurred",
      accountLines: false,
      lateCounts: false,
    },
  );
  milestone = built.timeline.find((it) => it.kind === "badge_earned");
  privateItem = built.timeline.find((it) => it.kind === "member_away");
  assert.ok(milestone && privateItem);
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    posts: true,
    comments: {
      enabled: true,
      capUsd: 10,
      moderate: async (request) => {
        checkedPrompts.push(request.prompt);
        await duringCheck?.();
        return {
          ok: true,
          model: "claude-haiku-5-5",
          input: { allow: true, category: "none" },
          usage: { input_tokens: 20, output_tokens: 5 },
        };
      },
    },
  });
});
beforeEach(async () => {
  await scratch.db.query("truncate account_post cascade");
  await scratch.db.query("delete from comment_check");
  await scratch.db.query(
    "update claim set status='verified',verified_at=now() where account_id=$1",
    [author],
  );
  duringCheck = null;
  checkedPrompts = [];
  await scratch.db.query("delete from account_block");
  await scratch.db.query(
    "delete from claim where account_id=$1 and relationship='friend'",
    [other],
  );
});
after(async () => {
  await handler?.close();
  await scratch?.drop();
});

test("a post attaches its own actual Mastery story, retaining canonical identity and original facts", async () => {
  const response = await call(author, "POST", "/api/me/posts", {
    text: "I reached the next Knight Mastery level",
    moment: {
      ...timelineItemRef(milestone),
      text: "Forged client headline",
      facts: { badge: "Fake Badge", level: 999 },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const attached = response.data.post.post.moment;
  assert.equal(attached?.id, milestone.id);
  assert.equal(attached.kind, "badge_earned");
  assert.equal(attached.at, milestone.at);
  assert.equal(attached.text, milestone.text);
  assert.doesNotMatch(JSON.stringify(attached), /Forged client|Fake Badge|999/);
  const read = await call(author, "GET", "/api/me/posts", undefined, {
    mine: "1",
  });
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(read.data.posts[0].post.moment, attached);
});

test("another player's milestone and private Clan facts cannot be attached", async () => {
  for (const [actor, item] of [
    [other, milestone],
    [author, privateItem],
  ]) {
    const response = await call(actor, "POST", "/api/me/posts", {
      text: "A moment about the record",
      moment: timelineItemRef(item),
    });
    assert.ok([403, 404, 422].includes(response.statusCode), response.body);
  }
  assert.equal(
    (await scratch.db.query("select count(*)::int as n from account_post"))
      .rows[0].n,
    0,
  );
});

test("ownership lost while moderation awaits cannot create a milestone post", async () => {
  duringCheck = () =>
    scratch.db.query(
      "update claim set status='unverified',verified_at=null where account_id=$1 and player_tag=$2",
      [author, PLAYER],
    );
  const response = await call(author, "POST", "/api/me/posts", {
    text: "The last Knight Mastery step",
    moment: timelineItemRef(milestone),
  });
  assert.ok([403, 404].includes(response.statusCode), response.body);
  assert.equal(
    (await scratch.db.query("select count(*)::int as n from account_post"))
      .rows[0].n,
    0,
  );
});

test("milestone posts use the existing follower audience across member, MCP, RSS and digest reads", async () => {
  const { makeRegistry } = await import("@elixir-mcp/tools");
  const { makeInvoker } =
    await import("../../../packages/tools/src/invoker.mjs");
  const { renderRss } = await import("../src/feed-link.mjs");
  const { publicItem } = await import("@elixir-mcp/sharing");
  const { buildDigest } = await import("../../jobs/src/email/build-digest.mjs");
  const { renderMail, htmlToText } = await import("@elixir-mcp/mail");
  const before = process.env.POSTS_ENABLED;
  process.env.POSTS_ENABLED = "true";
  try {
    await scratch.db.query(
      "update player set name='Invented <Ada>' where player_tag=$1",
      [PLAYER],
    );
    const made = await call(author, "POST", "/api/me/posts", {
      text: "My latest recorded milestone",
      moment: timelineItemRef(milestone),
    });
    assert.equal(made.statusCode, 201, made.body);
    const post = made.data.post;
    assert.match(post.post.moment.text, /Invented <Ada>/);
    const read = () =>
      call(other, "GET", "/api/me/posts", undefined, { player: PLAYER });
    assert.equal(
      (await read()).data.posts.length,
      0,
      "outsider has no post audience",
    );
    await scratch.db.query(
      "insert into claim(account_id,player_tag,relationship,notify) values($1,$2,'friend',true)",
      [other, PLAYER],
    );
    assert.equal((await read()).data.posts[0].post.moment.id, milestone.id);
    const invoke = makeInvoker({
      db: scratch.db,
      account: {
        accountId: other,
        kind: "person",
        role: "member",
        timezone: "UTC",
        credentialType: "oauth",
      },
      registry: makeRegistry(),
    });
    const result = await invoke("elixir_timeline", {
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 1000).toISOString(),
      kinds: ["post"],
      mark_read: false,
    });
    assert.equal(result.isError, false, JSON.stringify(result.body));
    const external = result.body.timeline.find((it) => it.id === post.id);
    assert.deepEqual(external.facts.moment, post.post.moment);
    assert.equal(external.publishable, false);
    const rss = renderRss([external]);
    assert.match(rss, /Recorded milestone:/);
    assert.match(rss, /&amp;lt;Ada&amp;gt;/);
    const facts = await buildDigest({
      db: scratch.db,
      account: { accountId: other, kind: "person", timezone: "UTC" },
      cadence: "daily",
      posts: true,
      window: { fromMs: Date.now() - 60_000, toMs: Date.now() + 1000 },
    });
    assert.deepEqual(facts.people[0].items[0].post.moment, post.post.moment);
    const mail = renderMail("tracking_report", facts, {
      timezone: "UTC",
      unsubscribe: "https://elixir.test/off",
      manage: "https://elixir.test/settings/emails",
    });
    assert.match(htmlToText(mail.html), /Recorded|Mastery/);
    assert.match(mail.html, /&lt;Ada&gt;/);
    assert.doesNotMatch(mail.html, /<Ada>/);
    assert.deepEqual(publicItem(post).post.moment, post.post.moment);
    await scratch.db.query(
      "insert into account_block(account_id,blocked_account_id) values($1,$2)",
      [other, author],
    );
    assert.equal(
      (await read()).data.posts.length,
      0,
      "a block still closes the post audience",
    );
    const blocked = await invoke("elixir_timeline", {
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 1000).toISOString(),
      kinds: ["post"],
      mark_read: false,
    });
    assert.equal(
      blocked.body.timeline.some((it) => it.id === post.id),
      false,
    );
  } finally {
    if (before === undefined) delete process.env.POSTS_ENABLED;
    else process.env.POSTS_ENABLED = before;
  }
});

test("editing words retains the canonical achievement and its moderation context after a claim changes", async () => {
  const made = await call(author, "POST", "/api/me/posts", {
    text: "A recorded Mastery step",
    moment: timelineItemRef(milestone),
  });
  assert.equal(made.statusCode, 201, made.body);
  const saved = made.data.post.post;
  await scratch.db.query(
    "update comment_check set created_at=now()-interval '2 minutes'",
  );
  await scratch.db.query(
    "update claim set status='unverified',verified_at=null where account_id=$1",
    [author],
  );
  const edited = await call(author, "PUT", `/api/me/posts/${saved.id}`, {
    text: "My words about that recorded step",
  });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.deepEqual(edited.data.post.post.moment, saved.moment);
  assert.match(
    checkedPrompts.at(-1),
    /their recorded game achievement attached/,
  );
});

test("recorded Ranked promotion and first Evo win use the same canonical attachment path", async () => {
  for (const [kind, payload] of [
    ["ranked_promotion", { from: 1, to: 2 }],
    [
      "card_first_win",
      {
        card_id: 26000000,
        name: "Knight",
        rarity: "common",
        form: "evolution",
        tower_troop: false,
        battle_id: "f".repeat(64),
      },
    ],
  ]) {
    await emitEvent(scratch.db, kind, {
      tag: PLAYER,
      payload,
      windowStart: at,
      windowEnd: at,
    });
    const built = await buildTimeline(
      scratch.db,
      [{ kind: "player", tag: PLAYER }],
      {
        accountId: author,
        interactive: true,
        fromMs: Date.parse(at) - 60_000,
        toMs: Date.now(),
        basis: "occurred",
        accountLines: false,
        lateCounts: false,
      },
    );
    const actual = built.timeline.find((it) => it.kind === kind);
    assert.ok(actual, kind);
    await scratch.db.query("delete from comment_check");
    const made = await call(author, "POST", "/api/me/posts", {
      text: `My recorded ${kind} milestone`,
      moment: timelineItemRef(actual),
    });
    assert.equal(made.statusCode, 201, made.body);
    assert.equal(made.data.post.post.moment.id, actual.id);
    assert.equal(made.data.post.post.moment.text, actual.text);
    assert.equal(made.data.post.post.moment.kind, kind);
  }
});

test("a milestone replaces other attachment types, and an unknown source id cannot be fabricated", async () => {
  for (const moment of [false, 0, "", []]) {
    const rejected = await call(author, "POST", "/api/me/posts", {
      text: "No silently dropped attachment",
      moment,
    });
    assert.equal(rejected.statusCode, 422, rejected.body);
  }
  for (const extra of [{ cards: [26000000] }, { battle: "a-battle" }]) {
    const rejected = await call(author, "POST", "/api/me/posts", {
      text: "One attachment",
      moment: timelineItemRef(milestone),
      ...extra,
    });
    assert.equal(rejected.statusCode, 422, rejected.body);
  }
  const missing = await call(author, "POST", "/api/me/posts", {
    text: "No invented game facts",
    moment: {
      ...timelineItemRef(milestone),
      item_id: "tl_00000000000000000000",
    },
  });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.equal(
    (await scratch.db.query("select count(*)::int as n from account_post"))
      .rows[0].n,
    0,
  );
});
