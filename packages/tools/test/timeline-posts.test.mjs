import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { postFixture, AUTHOR_TAG } from "../../posts/test/fixture.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { validateArgs } from "../src/validate.mjs";
import { OUTPUT_SCHEMAS } from "../src/output-schemas.mjs";

const T = Date.now() - 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
let ctx, people, previous;
before(async () => {
  previous = process.env.POSTS_ENABLED;
  process.env.POSTS_ENABLED = "true";
  ctx = await scratchDb("timeline_posts");
  people = await postFixture(ctx.db, "mcp-posts");
});
after(async () => {
  if (previous === undefined) delete process.env.POSTS_ENABLED;
  else process.env.POSTS_ENABLED = previous;
  await ctx?.drop();
});
beforeEach(async () => {
  await ctx.db.query("truncate account_post cascade");
  await ctx.db.query("delete from account_block");
  await ctx.db.query(`update claim set notify = true where account_id = $1`, [
    people.reader,
  ]);
});
function invoker(who, kind = "person") {
  return makeInvoker({
    db: ctx.db,
    account: {
      accountId: people[who],
      kind,
      role: "member",
      timezone: "UTC",
      credentialType: "oauth",
    },
    registry: makeRegistry(),
  });
}

async function read(who = "reader", args = {}, kind = "person") {
  const result = await invoker(who, kind)("elixir_timeline", {
    from: iso(T),
    to: iso(T + 1_800_000),
    basis: "observed",
    mark_read: false,
    kinds: ["post"],
    ...args,
  });
  assert.equal(result.isError, false, JSON.stringify(result.body));
  return result.body;
}

test("a person's Timeline reads authored posts and questions without private or publishing fields", async () => {
  const p = await people.post({
    at: iso(T + 1000),
    text: "Which card fits <this> & why?",
    cards: [26000000],
  });
  await ctx.db
    .query(`insert into card (card_id, name, kind, elixir_cost, in_catalog)
    values (26000000, 'Knight', 'card', 3, true) on conflict (card_id) do nothing`);
  await ctx.db.query(
    `insert into timeline_comment (item_id, account_id, subject_tag, owner_account_id, body)
     values ($1, $2, $3, $4, 'Only read this inside Elixir')`,
    [p.item_id, people.reader, AUTHOR_TAG, people.author],
  );
  const result = await read();
  const item = result.timeline[0];
  assert.equal(validateArgs(OUTPUT_SCHEMAS.elixir_timeline, result), null);
  for (const key of ["comments", "can_edit", "share_url"]) {
    const invalid = structuredClone(result);
    invalid.timeline[0].facts[key] = "must not reach a post consumer";
    assert.notEqual(
      validateArgs(OUTPUT_SCHEMAS.elixir_timeline, invalid),
      null,
      `${key} must be rejected by the registry validator`,
    );
  }
  const publishable = structuredClone(result);
  publishable.timeline[0].publishable = true;
  assert.notEqual(
    validateArgs(OUTPUT_SCHEMAS.elixir_timeline, publishable),
    null,
  );
  for (const key of ["post", "nickname", "can_edit", "comments", "share_url"]) {
    const invalid = structuredClone(result);
    invalid.timeline[0][key] = "private web-only field";
    assert.notEqual(
      validateArgs(OUTPUT_SCHEMAS.elixir_timeline, invalid),
      null,
      `${key} must be rejected on a post item`,
    );
  }
  assert.equal(item.id, p.item_id);
  assert.equal(item.schema, "post/1");
  assert.equal(item.revision, 1);
  assert.equal(item.visibility, "followers");
  assert.equal(item.publishable, false);
  assert.equal(item.facts.words, "Which card fits <this> & why?");
  assert.equal(item.facts.question, true);
  assert.equal(item.facts.answered, false);
  assert.equal(item.facts.player_tag, AUTHOR_TAG);
  assert.equal(
    JSON.stringify(item).includes("Only read this inside Elixir"),
    false,
  );
  assert.deepEqual(item.facts.cards, [{ id: 26000000, name: "Knight" }]);
  assert.equal(
    item.facts.url,
    `https://elixir.poapkings.com/home/post/${p.id}`,
  );
  for (const key of [
    "comment",
    "share_url",
    "can_edit",
    "account_id",
    "nickname",
    "email",
  ])
    assert.equal(JSON.stringify(item).includes(`"${key}"`), false, key);
  assert.equal(
    (await ctx.db.query("select count(*)::int as n from timeline_share"))
      .rows[0].n,
    0,
  );
});

test("account follows work with no game subject; strangers and non-person principals never gain post scope", async () => {
  await people.post({ at: iso(T + 1000) });
  assert.equal((await read("fan")).timeline.length, 1);
  assert.equal((await read("stranger")).timeline.length, 0);
  assert.equal((await read("reader", {}, "agent")).timeline.length, 0);
  await ctx.db.query(
    `update claim set notify = false where account_id = $1 and player_tag = $2`,
    [people.reader, AUTHOR_TAG],
  );
  assert.equal((await read()).timeline.length, 0);
});

test("a post's normalized deck reaches MCP as cards and a game copy link", async () => {
  const ids = [
    26000000, 26000001, 26000010, 26000014, 27000000, 28000000, 28000008,
    26000021,
  ];
  for (const [i, id] of ids.entries())
    await ctx.db.query(
      `insert into card (card_id, name, kind, elixir_cost, in_catalog)
      values ($1, $2, 'card', 3, true) on conflict (card_id) do update set name = excluded.name`,
      [id, `MCP Card ${i + 1}`],
    );
  await people.post({
    at: iso(T + 1000),
    question: false,
    deck: { cards: ids, tower_troop: null },
  });
  const [item] = (await read()).timeline;
  assert.equal(item.facts.question, false);
  assert.equal(item.facts.deck.cards.length, 8);
  assert.equal(item.facts.deck.cards[7].name, "MCP Card 8");
  assert.equal(item.facts.deck.average_elixir, 3);
  assert.match(
    item.facts.deck.copy_link,
    /^https:\/\/link\.clashroyale\.com\//,
  );
  assert.deepEqual(item.facts.cards, []);
});

test("post-only polls wake, edits keep their story and read pointers remain independent", async () => {
  const p = await people.post({ at: iso(T + 1000) });
  const first = await read("reader", {
    reader: "post-test",
    skip_empty: true,
    mark_read: true,
    to: iso(T + 10_000),
  });
  assert.equal(first.entries_skipped, false);
  assert.equal(first.timeline[0].id, p.item_id);
  assert.equal(first.read_to, iso(T + 10_000));
  await ctx.db.query(
    `update account_post set body = 'Clearer words', updated_at = $2, revision = 2 where post_id = $1`,
    [p.id, iso(T + 20_000)],
  );
  const changed = await read("reader", {
    from: iso(T + 10_000),
    to: iso(T + 20_000),
    skip_empty: true,
  });
  assert.equal(changed.timeline[0].id, p.item_id);
  assert.equal(changed.timeline[0].revision, 2);
  assert.equal(changed.timeline[0].at, iso(T + 1000));
  assert.equal(changed.timeline[0].observed_at, iso(T + 20_000));
  assert.equal(changed.timeline[0].late, true);
  assert.equal(
    (await read("reader", { from: iso(T + 20_000), skip_empty: true }))
      .entries_skipped,
    true,
  );
  assert.equal(
    (await read("reader", { basis: "occurred", to: iso(T + 1000) })).timeline[0]
      .id,
    p.item_id,
  );
  const account = (
    await ctx.db.query(
      `select activity_seen_at, console_timeline_seen_at from account where account_id = $1`,
      [people.reader],
    )
  ).rows[0];
  assert.equal(account.activity_seen_at, null);
  assert.equal(account.console_timeline_seen_at, null);
});

test("moderation, reports and blocks apply again on every MCP read", async () => {
  const p = await people.post({ at: iso(T + 1000) });
  await ctx.db.query(
    `update account_post set status = 'hidden' where post_id = $1`,
    [p.id],
  );
  assert.equal((await read("author")).timeline.length, 0, "hidden own post");
  await ctx.db.query(
    `update account_post set status = 'visible' where post_id = $1`,
    [p.id],
  );
  for (const [a, b] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
      [a, b],
    );
    assert.equal((await read()).timeline.length, 0);
    await ctx.db.query(
      `delete from account_block where account_id = $1 and blocked_account_id = $2`,
      [a, b],
    );
  }
  await ctx.db.query(
    `insert into post_report (post_id, account_id, reason) values ($1, $2, 'other')`,
    [p.id, people.reader],
  );
  assert.equal((await read()).timeline.length, 0);
});

test("post filters apply before caps and every omitted item remains counted", async () => {
  for (let i = 1; i <= 161; i++)
    await people.post({ at: iso(T + i * 1000), text: "Question ".repeat(50) });
  const result = await read();
  assert.ok(result.timeline.length > 0 && result.timeline.length < 150);
  assert.equal(result.timeline.length + result.timeline_more, 161);
  assert.equal(result.has_more, true);
  const older = await read("reader", { to: result.timeline_more_to });
  assert.ok(older.timeline.length > 0);
  const served = new Set(result.timeline.map((it) => it.id));
  assert.ok(older.timeline.every((it) => !served.has(it.id)));
  assert.equal(
    (await read("reader", { player_tag: "#0LYQ8GRP" })).timeline_more,
    0,
  );
  assert.equal(
    (await read("reader", { sections: ["battles"] })).timeline.length,
    0,
  );
});

test("the existing posts switch leaves the record-only MCP read intact", async () => {
  await people.post({ at: iso(T + 1000) });
  delete process.env.POSTS_ENABLED;
  try {
    assert.equal((await read()).timeline.length, 0);
  } finally {
    process.env.POSTS_ENABLED = "true";
  }
});

test("a visible post wakes a personal reader and its author can read its cheers", async () => {
  const p = await people.post({ at: new Date(T) });
  await ctx.db.query("delete from timeline_reader where account_id=$1", [
    people.reader,
  ]);
  await ctx.db.query(
    "update account set activity_seen_at=null where account_id=$1",
    [people.reader],
  );
  assert.equal((await read()).meta.posts_pending, true);
  assert.equal((await read("stranger")).meta.posts_pending, false);
  await read("reader", { reader: "social", mark_read: true });
  assert.equal((await read()).meta.posts_pending, false);
  await ctx.db.query(
    "update account_post set updated_at=now(),revision=revision+1 where item_id=$1",
    [p.item_id],
  );
  assert.equal((await read()).meta.posts_pending, true);
  assert.equal(
    (await read("reader", {}, "agent")).meta.posts_pending,
    undefined,
  );
  await ctx.db.query(
    "insert into timeline_cheer(item_id,account_id,cheer) values($1,$2,'well_played')",
    [p.item_id, people.reader],
  );
  const invoke = makeInvoker({
    db: ctx.db,
    account: { accountId: people.author, kind: "person", timezone: "UTC" },
    registry: makeRegistry(),
  });
  const result = await invoke("elixir_cheers", { days: 2 });
  assert.equal(
    result.body.items.find((item) => item.id === p.item_id)?.cheers.well_played,
    1,
  );
  await ctx.db.query("update claim set is_primary=false where account_id=$1", [
    people.author,
  ]);
  try {
    const own = await invoke("elixir_cheers", { days: 2 });
    assert.equal(own.body.player_tag, null);
    assert.equal(own.body.items[0].id, p.item_id);
  } finally {
    await ctx.db.query(
      "update claim set is_primary=true where account_id=$1 and player_tag=$2",
      [people.author, AUTHOR_TAG],
    );
  }
});

test("the same battle post wakes a poll, reads as a post, and appears once in a mixed feed", async () => {
  const at = iso(T + 1000),
    battle = "mcp-post-attachment";
  await ctx.db.query(
    "insert into battle(battle_id,battle_time,type,type_class) values($1,$2,'PvP','pvp')",
    [battle, at],
  );
  await ctx.db.query(
    "insert into battle_participant(battle_id,battle_time,player_tag,side,outcome,type,type_class) values($1,$2,$3,0,'win','PvP','pvp')",
    [battle, at, AUTHOR_TAG],
  );
  const p = await people.post({ at, question: false });
  await ctx.db.query("update account_post set battle_id=$2 where item_id=$1", [
    p.item_id,
    battle,
  ]);
  for (const who of ["reader", "fan"]) {
    const canonical = await read(who);
    const [item] = canonical.timeline;
    assert.equal(item.id, p.item_id);
    assert.equal(item.facts.battle.battle_id, battle);
    assert.equal(item.publishable, false);
    assert.equal(validateArgs(OUTPUT_SCHEMAS.elixir_timeline, canonical), null);
    const mixed = await read(who, { kinds: undefined });
    const matches = mixed.timeline.filter((it) => it.id === p.item_id);
    assert.equal(matches.length, 1);
    assert.equal(
      matches[0].kind,
      who === "reader" ? "battle_highlight" : "post",
    );
  }
  assert.equal((await read("fan")).meta.posts_pending, true);
  await ctx.db.query(
    "insert into post_report(post_id,account_id,reason) values($1,$2,'other')",
    [p.id, people.reader],
  );
  for (const kinds of [["post"], ["battle_highlight"], undefined]) {
    const page = await read("reader", { kinds, skip_empty: true });
    assert.equal(
      page.timeline.some((item) => item.id === p.item_id),
      false,
    );
    assert.equal(page.meta.posts_pending, false);
    if (kinds?.includes("battle_highlight"))
      assert.equal(page.entries_skipped, true);
  }
  assert.equal((await read("fan")).timeline[0].id, p.item_id);
  for (const who of ["fan", "reader"]) {
    const result = await invoker(who)("players_highlights", {
      player_tag: AUTHOR_TAG,
    });
    assert.equal(result.isError, false);
    assert.deepEqual(
      result.body.highlights.map((row) => row.id),
      who === "fan" ? [p.item_id] : [],
    );
  }
});
