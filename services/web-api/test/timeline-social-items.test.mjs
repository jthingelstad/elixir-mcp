import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { emitEvent } from "../../../packages/ingest/src/events.mjs";
import { createSession } from "@elixir-mcp/auth";
import { ensurePassport } from "@elixir-mcp/stamps";
import { grantStamps } from "../../../packages/stamps/src/store.mjs";
import {
  buildTimeline,
  storyId,
  subjectsFor,
} from "@elixir-mcp/tools/activity/entries";
import { ownFeedItem, stampedTags, withCheers } from "../src/cheers.mjs";
import { makeHandler } from "../src/handler.mjs";
import { readClanFeed } from "../src/clan-feed.mjs";
import { recoverMemberItemRef } from "../src/timeline-items.mjs";
import { readConversations } from "../src/conversations.mjs";
import { makeHandler as makeGameConsumer } from "../../timeline-sync/src/handler.mjs";

const PLAYER = "#0PGQ2UYL";
const MEMBER = "#0RJ29CVY";
const LEADER = "#0LYQ8GRP";
const CLAN = "#0Q2L8";
const now = Date.now();
const DAY = 86_400_000;
const at = (ms) => new Date(ms).toISOString();
let ctx, handler, reader, leader, author, stranger, follower, postId, items;
let duringCheck = null;
const cookies = new Map();

const refOf = (it) => ({
  item_id: it.id,
  kind: it.kind,
  source: it.section === "people" ? "people" : "game",
  subject: it.subjects.find((s) => s.tag === it.subject_tag) ?? it.subjects[0],
  account: it.facts.account_id,
  at: it.facts.started_at ?? it.sort_at ?? it.at,
});
async function resolve(accountId, it, item = refOf(it)) {
  return ownFeedItem(ctx.db, {
    accountId,
    itemId: it.id,
    tags: it.subjects.map((s) => s.tag),
    subjects: await subjectsFor(ctx.db, accountId),
    item,
    posts: true,
  });
}
async function call(accountId, method, path, body, query = {}) {
  const r = await handler({
    method,
    path,
    headers: {
      ...(accountId ? { cookie: cookies.get(accountId) } : {}),
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    queryStringParameters: query,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...r, data: JSON.parse(r.body) };
}

before(async () => {
  ctx = await scratchDb("timeline_social_items");
  const { db } = ctx;
  const person = async (name, tag = null, role = null) => {
    const id = (
      await db.query(
        "insert into account(email_hash,status,timezone) values($1,'approved','UTC') returning account_id",
        [name],
      )
    ).rows[0].account_id;
    const { token } = await createSession(db, {
      secret: "test",
      accountId: id,
      emailHash: name,
    });
    cookies.set(id, `__Host-elixir_session=${token}`);
    await ensurePassport(db, id);
    if (tag) {
      await db.query("insert into player(player_tag,name) values($1,$2)", [
        tag,
        name,
      ]);
      await db.query(
        "insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at) values($1,$2,true,'primary','verified',$3)",
        [id, tag, at(now - 3_600_000)],
      );
      if (role)
        await db.query(
          "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values($1,$2,$3,$4)",
          [CLAN, tag, role, at(now - 30 * DAY)],
        );
    }
    return id;
  };
  await db.query("insert into clan(clan_tag,name) values($1,'Invented Clan')", [
    CLAN,
  ]);
  author = await person("Invented Player", PLAYER);
  reader = await person("Invented Member", MEMBER, "member");
  leader = await person("Invented Leader", LEADER, "leader");
  stranger = await person("Invented Stranger");
  follower = await person("Invented Follower");
  await db.query(
    "insert into claim(account_id,player_tag,relationship) values($1,$2,'friend')",
    [follower, PLAYER],
  );
  postId = (
    await db.query(
      "insert into account_post(item_id,account_id,player_tag,body) values('tl_fed00000000000000001',$1,$2,'Invented question') returning post_id::text",
      [author, PLAYER],
    )
  ).rows[0].post_id;
  const battle = "e".repeat(64);
  await db.query(
    "insert into battle(battle_id,battle_time,type,type_class,created_at) values($1,$2,'PvP','pvp',$2)",
    [battle, at(now - 10 * DAY)],
  );
  for (const [side, tag] of [PLAYER, MEMBER].entries())
    await db.query(
      "insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,outcome,crowns) values($1,$2,$3,$4,'PvP','pvp',$5,$6)",
      [
        battle,
        tag,
        side,
        at(now - 10 * DAY),
        side ? "loss" : "win",
        side ? 0 : 3,
      ],
    );
  await db.query(
    "insert into account_post(item_id,account_id,player_tag,battle_id,body) values('tl_fed00000000000000002',$1,$2,$3,'Battle from the record')",
    [author, PLAYER, battle],
  );
  await db.query(
    "insert into player(player_tag,name) values('#0PLUG2V9','Invented Opponent')",
  );
  await db.query(
    "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values($1,$2,'member',$3)",
    [CLAN, PLAYER, at(now - 30 * DAY)],
  );
  for (let i = 0; i < 5; i += 1) {
    const id = `social-2v2-${i}`;
    const when = at(now - 2 * DAY + i * 240_000);
    await db.query(
      "insert into battle(battle_id,battle_time,type,type_class,created_at) values($1,$2,'trail','pvp',$2)",
      [id, when],
    );
    for (const [tag, side] of [
      [PLAYER, 0],
      [LEADER, 0],
      [MEMBER, 1],
      ["#0PLUG2V9", 1],
    ])
      await db.query(
        "insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,outcome,crowns,clan_tag,starting_trophies) values($1,$2,$3,$4,'trail','pvp',$5,$6,$7,6000)",
        [id, tag, side, when, side ? "loss" : "win", side ? 0 : 3, CLAN],
      );
  }
  await emitEvent(db, "best_trophies_band", {
    tag: PLAYER,
    payload: {
      best: 9000,
      band: 9000,
      crossed_by: { battle_id: "social-2v2-0" },
    },
    windowStart: at(now - 2 * DAY - 60_000),
    windowEnd: at(now - 2 * DAY),
    occurredAt: at(now - 2 * DAY),
  });
  for (const days of [1, 12])
    for (const [name, hour] of [
      ["MasteryKnight", 0],
      ["MasteryHogRider", 1],
    ])
      await emitEvent(db, "badge_earned", {
        tag: PLAYER,
        payload: {
          name,
          level: days === 1 ? 10 : 5,
          prior_level: days === 1 ? 9 : 4,
          max_level: 10,
          rung: days === 1 ? 10 : 5,
        },
        windowStart: at(now - days * DAY + hour * 60_000 - 60_000),
        windowEnd: at(now - days * DAY + hour * 60_000),
      });
  await db.query(
    "insert into clan_event(clan_tag,event_type,timing,occurred_at,window_start,window_end,player_tag,role_after) values($1,'member_joined','exact',$2,$2,$2,$3,'member')",
    [CLAN, at(now - 3_600_000), PLAYER],
  );
  for (const [kind, visibility, detail] of [
    [
      "clan_message",
      "clan",
      { channel: "clan_chat", body: "Invented clan note" },
    ],
    ["member_away", "leaders", { until: at(now + DAY) }],
  ])
    await db.query(
      "insert into attested_fact(subject_kind,clan_tag,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at) values('clan',$1,$2,$3,$4,$5,'clan.poapkings.com',$3,$6,$6)",
      [CLAN, MEMBER, kind, detail, visibility, at(now - 3_600_000)],
    );
  await db.query(
    "insert into attested_fact(subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at) values('player',$1,'personal_record','{\"game\":\"drop\",\"score\":10}','player','drop.poapkings.com','social-existing-record',$2,$2)",
    [PLAYER, at(now - 3_600_000)],
  );
  await grantStamps(db, author, [{ stamp_id: "mutual", level: 1 }], {
    now: at(now - 3_600_000),
  });
  await db.query(
    "insert into account_event(account_id,kind,created_at) values($1,'place_set',$2)",
    [author, at(now - 3_600_000)],
  );
  items = (
    await buildTimeline(
      db,
      [
        { kind: "player", tag: PLAYER },
        { kind: "clan", tag: CLAN, scope: "comprehensive" },
      ],
      {
        accountId: leader,
        interactive: true,
        fromMs: now - 15 * DAY,
        toMs: now,
        basis: "occurred",
        accountLines: false,
        people: { accounts: [author], players: true },
        lateCounts: false,
      },
    )
  ).timeline;
  handler = makeHandler({
    databaseUrl: ctx.url,
    secret: "test",
    comments: {
      enabled: true,
      capUsd: 10,
      moderate: async () => {
        await duringCheck?.();
        return {
          ok: true,
          model: "claude-haiku-5-5",
          input: { allow: true, category: "none" },
          usage: { input_tokens: 20, output_tokens: 5 },
        };
      },
    },
    posts: true,
  });
});
after(async () => {
  await handler?.close();
  await ctx?.drop();
});

test("the starter preview returns one recent item from a current named friend only", async () => {
  const preview = (account, players) =>
    call(account, "GET", "/api/me/people/followed-moment", undefined, {
      players,
    });
  const response = await preview(follower, [MEMBER, PLAYER].join(","));
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.data.item.subject_tag, PLAYER);
  assert.equal(response.data.item.can_cheer, true);
  assert.equal(response.data.item.item_ref.item_id, response.data.item.id);
  assert.ok(Date.parse(response.data.item.at) >= now - 7 * DAY);
  assert.equal((await preview(follower, MEMBER)).data.item, null);
  assert.equal((await preview(stranger, PLAYER)).data.item, null);
  for (const [blocker, other] of [
    [author, follower],
    [follower, author],
  ]) {
    await ctx.db.query(
      "insert into account_block(account_id,blocked_account_id) values($1,$2)",
      [blocker, other],
    );
    try {
      assert.equal((await preview(follower, PLAYER)).data.item, null);
    } finally {
      await ctx.db.query(
        "delete from account_block where account_id=$1 and blocked_account_id=$2",
        [blocker, other],
      );
    }
  }
  assert.equal((await preview(follower, "bad!")).statusCode, 400);
});

test("My conversations retains every source kind and rechecks private Clan roles", async () => {
  const kinds = [
    "badge_earned",
    "member_joined",
    "player_verified",
    "stamp_earned",
    "clan_message",
    "member_away",
  ];
  const joined = items.filter((it) => kinds.includes(it.kind));
  assert.equal(new Set(joined.map((it) => it.kind)).size, kinds.length);
  const ids = [];
  try {
    for (const it of joined) {
      assert.ok(await resolve(leader, it));
      const row = (
        await ctx.db.query(
          `insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body)
        values($1,$2,$2,$3,'A joined conversation') returning comment_id::text`,
          [
            it.id,
            leader,
            it.subjects.find((s) => s.kind === "player")?.tag ?? null,
          ],
        )
      ).rows[0];
      ids.push(row.comment_id);
      await ctx.db.query(
        "update comment_conversation set item_ref=$3::jsonb where account_id=$1 and item_id=$2",
        [leader, it.id, JSON.stringify(refOf(it))],
      );
    }
    const read = () => call(leader, "GET", "/api/me/conversations");
    let list = await read();
    assert.equal(list.statusCode, 200, list.body);
    for (const it of joined)
      assert.ok(
        list.data.items.some((row) => row.item_id === it.id),
        it.kind,
      );
    await ctx.db.query(
      "update clan_membership set role='member' where player_tag=$1",
      [LEADER],
    );
    list = await read();
    assert.ok(
      !list.data.items.some((row) => row.item_ref.kind === "member_away"),
      "private source access is current, not membership at join time",
    );
    assert.ok(
      list.data.items.some((row) => row.item_ref.kind === "clan_message"),
    );
  } finally {
    await ctx.db.query(
      "update clan_membership set role='leader' where player_tag=$1",
      [LEADER],
    );
    await ctx.db.query(
      "delete from timeline_comment where comment_id=any($1::bigint[])",
      [ids],
    );
    await ctx.db.query(
      "delete from comment_conversation where account_id=$1 and item_id=any($2::text[])",
      [leader, joined.map((it) => it.id)],
    );
  }
});

test("unfollowed recorded player and clan items resolve by actual source beyond Home's week", async () => {
  const badges = items.filter((it) => it.kind === "badge_earned");
  assert.equal(badges.length, 2);
  for (const it of [
    ...badges,
    items.find((it) => it.kind === "member_joined"),
  ]) {
    const found = await resolve(stranger, it);
    assert.ok(found, `actual ${it.kind} at ${it.at} remains actionable`);
    assert.equal(found.id, it.id);
    assert.equal(found.kind, it.kind);
    assert.deepEqual(found.facts, it.facts);
  }
});

test("member people items resolve with their original identity", async () => {
  for (const kind of ["player_verified", "stamp_earned", "place_set"]) {
    const it = items.find((it) => it.kind === kind);
    assert.ok(it, kind);
    assert.equal((await resolve(stranger, it))?.id, it.id, kind);
  }
});

test("private Clan items require the exact current source audience", async () => {
  const clan = items.find((it) => it.kind === "clan_message");
  const leaders = items.find((it) => it.kind === "member_away");
  assert.ok(clan && leaders);
  assert.equal((await resolve(reader, clan))?.id, clan.id);
  assert.equal(await resolve(stranger, clan), null);
  assert.equal((await resolve(leader, leaders))?.id, leaders.id);
  assert.equal(await resolve(reader, leaders), null);
  assert.equal(await resolve(stranger, leaders), null);
  for (const [account, it, status] of [
    [reader, clan, 200],
    [leader, leaders, 200],
    [reader, leaders, 404],
    [stranger, clan, 404],
    [stranger, leaders, 404],
  ]) {
    const read = await call(account, "GET", "/api/me/comments", undefined, {
      item: it.id,
      item_ref: JSON.stringify(refOf(it)),
    });
    assert.equal(
      read.statusCode,
      status,
      `${it.kind} stays in its original comment audience: ${read.body}`,
    );
  }
});

test("cheer and comment transport accepts the canonical item locator", async () => {
  const it = items.find(
    (it) => it.kind === "badge_earned" && Date.parse(it.at) < now - 7 * DAY,
  );
  const reaction = await call(stranger, "PUT", "/api/me/cheers", {
    item_id: it.id,
    cheer: "well_played",
    item: refOf(it),
  });
  assert.equal(reaction.statusCode, 200, reaction.body);
  assert.equal(reaction.data.my_cheer, "well_played");
  const comments = await call(stranger, "GET", "/api/me/comments", undefined, {
    item: it.id,
    item_ref: JSON.stringify(refOf(it)),
  });
  assert.equal(comments.statusCode, 200, comments.body);
  assert.equal(
    (
      await call(stranger, "GET", "/api/me/comments", undefined, {
        item: it.id,
        item_ref: "{broken",
      })
    ).statusCode,
    404,
  );
});

test("all normal signed-in Timeline surfaces carry canonical social identity and shared counts", async () => {
  // The pages list the Timeline's week; a badge from 12 days ago is past it
  // and keeps its permalink (the cheer test above reached it).
  const old = items.find(
    (it) => it.kind === "badge_earned" && Date.parse(it.at) < now - 7 * DAY,
  );
  const recent = items.find(
    (it) => it.kind === "badge_earned" && Date.parse(it.at) > now - 7 * DAY,
  );
  const cheered = await call(stranger, "PUT", "/api/me/cheers", {
    item_id: recent.id,
    cheer: "well_played",
    item: refOf(recent),
  });
  assert.equal(cheered.statusCode, 200, cheered.body);
  const player = await call(stranger, "GET", "/api/player", undefined, {
    tag: PLAYER,
  });
  assert.equal(player.statusCode, 200, player.body);
  assert.equal(player.data.window_days, 7);
  assert.ok(!player.data.timeline.some((it) => it.id === old.id));
  const shown = player.data.timeline.find((it) => it.id === recent.id);
  assert.equal(shown.item_ref.item_id, recent.id);
  assert.equal(shown.cheers.well_played, 1);
  const cheers = await call(stranger, "GET", "/api/me/cheers", undefined, {
    player: PLAYER,
  });
  assert.equal(cheers.statusCode, 200, cheers.body);
  assert.ok(cheers.data.items.every((it) => it.item_ref.item_id === it.id));
  assert.ok(cheers.data.items.some((it) => it.kind === "badge_earned"));
  const person = items.find((it) => it.kind === "player_verified");
  const account = await call(
    stranger,
    "GET",
    `/api/accounts/${person.facts.account_id}`,
  );
  assert.equal(account.statusCode, 200, account.body);
  assert.ok(!account.data.timeline.some((it) => it.id === old.id));
  assert.equal(
    account.data.timeline.find((it) => it.id === recent.id)?.item_ref.item_id,
    recent.id,
  );
  const clan = await readClanFeed(
    ctx.db,
    { accountId: reader, kind: "person", timezone: "UTC" },
    CLAN,
    now,
    { comments: true, posts: true },
  );
  const arrival = clan.items.find((it) => it.kind === "member_joined");
  assert.equal(arrival.item_ref.item_id, arrival.id);
  assert.deepEqual(arrival.cheers, {});
  const session = items.find((it) =>
    ["battle_session", "session_standout"].includes(it.kind),
  );
  assert.ok(session);
  const page = await call(stranger, "GET", "/api/player/session", undefined, {
    tag: PLAYER,
    id: session.id,
    at: session.facts.started_at,
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.data.item.item_ref.item_id, session.id);
  assert.deepEqual(page.data.item.cheers, {});
  assert.deepEqual(page.data.marks, [
    { battle_id: "social-2v2-0", label: "New best: 9,000 trophies" },
  ]);
});

test("post locators retain the live authored audience with no game projection fallback", async () => {
  const it = {
    id: "tl_fed00000000000000001",
    kind: "post",
    subjects: [{ kind: "player", tag: PLAYER }],
  };
  const ref = { item_id: it.id, source: "post", kind: "post", post_id: postId };
  assert.equal((await resolve(follower, it, ref))?.id, it.id);
  assert.equal(await resolve(stranger, it, ref), null);
  assert.equal(
    await resolve(follower, it, {
      ...ref,
      post_id: String(Number(postId) + 1),
    }),
    null,
  );
  assert.equal(
    await resolve(stranger, it, {
      ...ref,
      source: "game",
      subject: { kind: "player", tag: PLAYER },
      at: at(now),
    }),
    null,
  );
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [author, follower],
  );
  try {
    assert.equal(await resolve(follower, it, ref), null);
  } finally {
    await ctx.db.query("delete from account_block where account_id=$1", [
      author,
    ]);
  }
  await ctx.db.query(
    "update account_post set status='hidden' where post_id=$1",
    [postId],
  );
  try {
    assert.equal(await resolve(follower, it, ref), null);
  } finally {
    await ctx.db.query(
      "update account_post set status='visible' where post_id=$1",
      [postId],
    );
  }
});

test("reports use the same exact item locator instead of a current-week follow fallback", async () => {
  const it = items.find(
    (row) => row.kind === "badge_earned" && Date.parse(row.at) < now - 7 * DAY,
  );
  const id = (
    await ctx.db.query(
      "insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body) values($1,$2,$2,$3,'Invented reply') returning comment_id::text",
      [it.id, author, PLAYER],
    )
  ).rows[0].comment_id;
  const forged = await call(stranger, "POST", "/api/me/comment-reports", {
    id,
    reason: "other",
    item: { ...refOf(it), item_id: "tl_00000000000000000000" },
  });
  assert.equal(forged.statusCode, 404, forged.body);
  const report = await call(stranger, "POST", "/api/me/comment-reports", {
    id,
    reason: "other",
    item: refOf(it),
  });
  assert.equal(report.statusCode, 200, report.body);
});

test("a cached private locator loses access after current membership or role changes", async () => {
  const clan = items.find((it) => it.kind === "clan_message");
  const leaders = items.find((it) => it.kind === "member_away");
  await ctx.db.query(
    "update clan_membership set left_observed_at=now() where clan_tag=$1 and player_tag=$2",
    [CLAN, MEMBER],
  );
  try {
    assert.equal(await resolve(reader, clan), null);
  } finally {
    await ctx.db.query(
      "update clan_membership set left_observed_at=null where clan_tag=$1 and player_tag=$2",
      [CLAN, MEMBER],
    );
  }
  await ctx.db.query(
    "update clan_membership set role='member' where clan_tag=$1 and player_tag=$2",
    [CLAN, LEADER],
  );
  try {
    assert.equal(await resolve(leader, leaders), null);
  } finally {
    await ctx.db.query(
      "update clan_membership set role='leader' where clan_tag=$1 and player_tag=$2",
      [CLAN, LEADER],
    );
  }
});

test("forged identities, account notices and blocks never gain a broader fallback", async () => {
  const it = items.find((it) => it.kind === "badge_earned");
  assert.equal(
    await resolve(stranger, it, {
      ...refOf(it),
      item_id: "tl_00000000000000000000",
    }),
    null,
  );
  assert.equal(
    await resolve(stranger, it, { ...refOf(it), source: "account" }),
    null,
  );
  assert.equal(
    await resolve(stranger, it, {
      ...refOf(it),
      subject: { kind: "player", tag: MEMBER },
    }),
    null,
  );
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [author, stranger],
  );
  try {
    assert.equal(await resolve(stranger, it), null);
    const people = items.find((row) => row.kind === "stamp_earned");
    assert.equal(await resolve(stranger, people), null);
  } finally {
    await ctx.db.query("delete from account_block where account_id=$1", [
      author,
    ]);
  }
});

test("blocks disable initial controls and reject retained legacy follow lookups in both directions", async () => {
  const it = items.find(
    (row) => row.kind === "badge_earned" && Date.parse(row.at) > now - 7 * DAY,
  );
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship) values($1,$2,'friend')",
    [stranger, PLAYER],
  );
  try {
    for (const pair of [
      [author, stranger],
      [stranger, author],
    ]) {
      await ctx.db.query(
        "insert into account_block(account_id,blocked_account_id) values($1,$2)",
        pair,
      );
      try {
        const page = await call(stranger, "GET", "/api/player", undefined, {
          tag: PLAYER,
        });
        assert.equal(page.statusCode, 200, page.body);
        assert.equal(
          page.data.timeline.find((row) => row.id === it.id).can_cheer,
          false,
        );
        const legacy = await ownFeedItem(ctx.db, {
          accountId: stranger,
          itemId: it.id,
          tags: [PLAYER],
          subjects: await subjectsFor(ctx.db, stranger),
          posts: true,
        });
        assert.equal(
          legacy,
          null,
          "a retained claim never bypasses the owner block",
        );
        assert.equal(await resolve(stranger, it), null);
      } finally {
        await ctx.db.query(
          "delete from account_block where account_id=$1 and blocked_account_id=$2",
          pair,
        );
      }
    }
  } finally {
    await ctx.db.query(
      "delete from claim where account_id=$1 and player_tag=$2",
      [stranger, PLAYER],
    );
  }
  assert.equal((await withCheers(ctx.db, [it], stranger))[0].can_cheer, true);
  assert.equal(
    (await withCheers(ctx.db, [it], stranger, { allowed: false }))[0].can_cheer,
    false,
  );
});

test("private and People cheers do not stamp recipients for game mail, push or external reads", async () => {
  for (const [account, kind] of [
    [stranger, "stamp_earned"],
    [leader, "member_away"],
    [reader, "clan_message"],
  ]) {
    const it = items.find((row) => row.kind === kind);
    const answer = await call(account, "PUT", "/api/me/cheers", {
      item_id: it.id,
      cheer: "well_played",
      item: refOf(it),
    });
    assert.equal(answer.statusCode, 200, answer.body);
    const row = (
      await ctx.db.query(
        "select subject_tags from timeline_cheer where item_id=$1 and account_id=$2",
        [it.id, account],
      )
    ).rows[0];
    assert.equal(
      row.subject_tags,
      null,
      `${kind} cannot enter the game recipient lane`,
    );
    if (it.section === "attested")
      assert.equal(
        (await call(account, "POST", "/api/me/item-shares", refOf(it)))
          .statusCode,
        404,
        "membership never grants public sharing of private Clan state",
      );
  }
  const old = items.find(
    (it) => it.kind === "badge_earned" && Date.parse(it.at) < now - 7 * DAY,
  );
  assert.deepEqual(
    (
      await ctx.db.query(
        "select subject_tags from timeline_cheer where item_id=$1 and account_id=$2",
        [old.id, stranger],
      )
    ).rows[0].subject_tags,
    [PLAYER],
    "public game reactions keep their existing recipient behavior",
  );
  const personal = items.find((it) => it.kind === "personal_record");
  const answered = await call(stranger, "PUT", "/api/me/cheers", {
    item_id: personal.id,
    item: refOf(personal),
    cheer: "well_played",
  });
  assert.equal(answered.statusCode, 200, answered.body);
  assert.deepEqual(
    (
      await ctx.db.query(
        "select subject_tags from timeline_cheer where item_id=$1 and account_id=$2",
        [personal.id, stranger],
      )
    ).rows[0].subject_tags,
    [PLAYER],
    "the existing player-visibility personal record receipt is preserved",
  );
});

test("a real merged 2v2 standout resolves to the identical player session story", async () => {
  const it = items.find(
    (row) => row.kind === "session_standout" && row.subject_tag === PLAYER,
  );
  assert.ok(it, "the clan's five-win standout and player session are merged");
  assert.ok(it.subjects.some((s) => s.kind === "clan" && s.tag === CLAN));
  assert.ok(it.subjects.some((s) => s.kind === "player" && s.tag === PLAYER));
  assert.equal(it.facts.battles, 5);
  const found = await resolve(stranger, it);
  assert.equal(found?.id, it.id);
  assert.equal(found.kind, "battle_session");
});

test("a five-day quiet crossing stays actionable after the player returns", async () => {
  const tag = "#0YVQPJ";
  await ctx.db.query(
    "insert into player(player_tag,name) values($1,'Invented Quiet Player')",
    [tag],
  );
  await emitEvent(ctx.db, "badge_earned", {
    tag,
    payload: {
      name: "MasteryKnight",
      level: 5,
      prior_level: 4,
      max_level: 10,
      rung: 5,
    },
    windowStart: at(now - 5 * DAY - 3_600_000),
    windowEnd: at(now - 5 * DAY - 3_540_000),
  });
  const battle = async (key, when) => {
    await ctx.db.query(
      "insert into battle(battle_id,battle_time,type,type_class,created_at) values($1,$2,'PvP','pvp',$2)",
      [key, at(when)],
    );
    await ctx.db.query(
      "insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,outcome) values($1,$2,0,$3,'PvP','pvp','win')",
      [key, tag, at(when)],
    );
  };
  await battle("social-quiet-before", now - 10 * DAY);
  const built = await buildTimeline(ctx.db, [{ kind: "player", tag }], {
    fromMs: now - 6 * DAY,
    toMs: now - 5 * DAY,
    basis: "occurred",
    accountLines: false,
    lateCounts: false,
  });
  const crossing = built.timeline.find(
    (it) => it.kind === "quiet_crossed" && it.facts.player_tag === tag,
  );
  assert.ok(crossing);
  assert.equal(crossing.facts.rung, 5);
  await battle("social-quiet-return", now - 4 * DAY);
  const found = await resolve(stranger, crossing);
  assert.equal(found?.id, crossing.id);
  assert.equal(found.facts.rung, 5);
});

test("private comment source admission is checked again after moderation awaits", async () => {
  for (const [actor, kind, change, restore] of [
    [
      reader,
      "clan_message",
      () =>
        ctx.db.query(
          "update clan_membership set left_observed_at=now() where clan_tag=$1 and player_tag=$2",
          [CLAN, MEMBER],
        ),
      () =>
        ctx.db.query(
          "update clan_membership set left_observed_at=null where clan_tag=$1 and player_tag=$2",
          [CLAN, MEMBER],
        ),
    ],
    [
      leader,
      "member_away",
      () =>
        ctx.db.query(
          "update clan_membership set role='member' where clan_tag=$1 and player_tag=$2",
          [CLAN, LEADER],
        ),
      () =>
        ctx.db.query(
          "update clan_membership set role='leader' where clan_tag=$1 and player_tag=$2",
          [CLAN, LEADER],
        ),
    ],
  ]) {
    await ctx.db.query(
      "insert into claim(account_id,player_tag,relationship) values($1,$2,'friend') on conflict do nothing",
      [leader, MEMBER],
    );
    const it = items.find((row) => row.kind === kind);
    duringCheck = change;
    try {
      const reply = await call(actor, "POST", "/api/me/comments", {
        item_id: it.id,
        item: refOf(it),
        text: `Checking the ${kind === "clan_message" ? "clan" : "member"} moment`,
      });
      assert.equal(reply.statusCode, 403, reply.body);
      assert.equal(
        (
          await ctx.db.query(
            "select count(*)::int as n from timeline_comment where item_id=$1",
            [it.id],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      duringCheck = null;
      await restore();
      await ctx.db.query(
        "delete from claim where account_id=$1 and player_tag=$2 and relationship='friend'",
        [leader, MEMBER],
      );
    }
  }
});

test("battle pages retain canonical permitted posts with the same current moderation and blocks", async () => {
  const id = "tl_fed00000000000000002";
  const battle = "e".repeat(64);
  const read = () =>
    call(stranger, "GET", "/api/me/cheers", undefined, { battle });
  const page = await read();
  assert.equal(page.statusCode, 200, page.body);
  const post = page.data.items.find((it) => it.id === id);
  assert.ok(post, "a previously visible battle post keeps its social thread");
  assert.equal(post.kind, "post");
  assert.equal(post.can_cheer, true);
  assert.equal(post.item_ref.source, "post");
  assert.equal(
    (
      await call(stranger, "PUT", "/api/me/cheers", {
        item_id: id,
        item: post.item_ref,
        cheer: "well_played",
      })
    ).statusCode,
    200,
  );
  const postKey = (
    await ctx.db.query(
      "select post_id::text from account_post where item_id=$1",
      [id],
    )
  ).rows[0].post_id;
  for (const status of ["hidden", "removed"]) {
    await ctx.db.query(
      "update account_post set status=$2,removed_at=case when $2='removed' then now() else null end where post_id=$1",
      [postKey, status],
    );
    assert.ok(!(await read()).data.items.some((it) => it.id === id));
  }
  await ctx.db.query(
    "update account_post set status='visible',removed_at=null where post_id=$1",
    [postKey],
  );
  await ctx.db.query(
    "insert into post_report(post_id,account_id,reason) values($1,$2,'other')",
    [postKey, stranger],
  );
  try {
    assert.ok(!(await read()).data.items.some((it) => it.id === id));
  } finally {
    await ctx.db.query("delete from post_report where post_id=$1", [postKey]);
  }
  for (const pair of [
    [author, stranger],
    [stranger, author],
  ]) {
    await ctx.db.query(
      "insert into account_block(account_id,blocked_account_id) values($1,$2)",
      pair,
    );
    try {
      assert.ok(!(await read()).data.items.some((it) => it.id === id));
    } finally {
      await ctx.db.query(
        "delete from account_block where account_id=$1 and blocked_account_id=$2",
        pair,
      );
    }
  }
});

test("a game-owner removal cannot guess into a private Clan thread; authors retain erasure", async () => {
  const it = items.find((row) => row.kind === "member_away");
  const id = (
    await ctx.db.query(
      "insert into timeline_comment(item_id,account_id,owner_account_id,subject_tag,body,receipt_allowed) values($1,$2,$3,$4,'Private invented reply',false) returning comment_id::text",
      [it.id, leader, reader, MEMBER],
    )
  ).rows[0].comment_id;
  const denied = await call(reader, "DELETE", `/api/me/comments/${id}`, {
    item: refOf(it),
  });
  assert.equal(denied.statusCode, 404, denied.body);
  assert.equal(
    (
      await ctx.db.query(
        "select status from timeline_comment where comment_id=$1",
        [id],
      )
    ).rows[0].status,
    "visible",
  );
  await ctx.db.query(
    "update clan_membership set role='member' where clan_tag=$1 and player_tag=$2",
    [CLAN, LEADER],
  );
  try {
    const own = await call(leader, "DELETE", `/api/me/comments/${id}`, {
      item: refOf(it),
    });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(
      (
        await ctx.db.query(
          "select count(*)::int as n from timeline_comment where comment_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await ctx.db.query(
      "update clan_membership set role='leader' where clan_tag=$1 and player_tag=$2",
      [CLAN, LEADER],
    );
  }
});

test("queued Drop games keep canonical identity and social actions inside the current player audience", async () => {
  const queue = "arn:aws:sqs:us-east-1:000000000000:elixir-drop-games";
  const game = {
    version: 1,
    type: "drop.game.completed",
    accountId: author,
    playerTag: PLAYER,
    gameId: randomUUID(),
    mode: "exact-ten",
    startedAt: at(now - 60_000),
    completedAt: at(now - 50_000),
    score: 10,
    answers: 1,
    cards: [
      { id: 26000000, name: "Knight", cost: 3, reason: "solution" },
      { id: 26000020, name: "Giant Skeleton", cost: 6, reason: "solution" },
      { id: 26000010, name: "Skeletons", cost: 1, reason: "solution" },
    ],
  };
  const consumer = makeGameConsumer({
    dropGamesQueueArn: queue,
    connect: async () => ({
      query: ctx.db.query.bind(ctx.db),
      end: async () => {},
    }),
  });
  assert.deepEqual(
    await consumer({
      Records: ["first", "retry"].map((messageId) => ({
        eventSourceARN: queue,
        messageId,
        body: JSON.stringify(game),
      })),
    }),
    { batchItemFailures: [] },
  );
  const facts = (
    await ctx.db.query(
      "select fact_id::text from attested_fact where fact_type='drop_game' and detail->>'game_id'=$1",
      [game.gameId],
    )
  ).rows;
  assert.equal(facts.length, 1, "queue retry preserves the same game identity");
  const id = storyId("attested_fact", facts[0].fact_id);
  const build = async (accountId) =>
    (
      await buildTimeline(
        ctx.db,
        [
          { kind: "player", tag: PLAYER },
          { kind: "player", tag: MEMBER },
          { kind: "clan", tag: CLAN, scope: "comprehensive" },
        ],
        {
          accountId,
          interactive: true,
          fromMs: now - DAY,
          toMs: Date.now(),
          basis: "occurred",
          accountLines: false,
          lateCounts: false,
        },
      )
    ).timeline.filter((it) => it.kind === "drop_game");
  const [it] = await build(author);
  assert.equal(it.id, id);
  assert.equal(it.section, "attested");
  assert.equal(it.facts.visibility, "player");
  assert.deepEqual(it.facts.cards, game.cards);
  assert.equal(it.publishable, false);
  assert.equal(
    stampedTags(it),
    null,
    "Drop reactions do not acquire game mail or push recipients",
  );
  assert.deepEqual(
    await build(leader),
    [],
    "shared Clan membership grants no Drop access",
  );
  assert.equal(await resolve(leader, it), null);
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship) values($1,$2,'friend')",
    [reader, PLAYER],
  );
  await ctx.db.query(
    "insert into account_follow(account_id,followed_account_id) values($1,$2)",
    [leader, author],
  );
  const pageId = items.find((row) => row.kind === "player_verified").facts
    .account_id;
  try {
    for (const account of [author, reader, leader]) {
      assert.equal((await build(account))[0]?.id, id);
      assert.equal((await resolve(account, it))?.id, id);
      for (const [path, query] of [
        ["/api/player", { tag: PLAYER }],
        [`/api/accounts/${pageId}`, {}],
      ]) {
        const page = await call(account, "GET", path, undefined, query);
        assert.equal(page.statusCode, 200, page.body);
        const shown = page.data.timeline.find((row) => row.id === id);
        assert.equal(shown.section, "attested");
        assert.equal(shown.item_ref.item_id, id);
        assert.equal(shown.item_ref.subject.tag, PLAYER);
        assert.equal(shown.can_cheer, true);
        assert.equal(shown.comments.open, true);
        assert.deepEqual(shown.facts.cards, game.cards);
      }
      const cheer = await call(account, "PUT", "/api/me/cheers", {
        item_id: id,
        item: refOf(it),
        cheer: "well_played",
      });
      assert.equal(cheer.statusCode, 200, cheer.body);
      assert.equal(cheer.data.my_cheer, "well_played");
      const comment = await call(account, "POST", "/api/me/comments", {
        item_id: id,
        item: refOf(it),
        text: "I saw the Knight and Skeletons in that game",
      });
      assert.equal(comment.statusCode, 201, comment.body);
    }
    assert.equal(await resolve(stranger, it), null);
    assert.deepEqual(await build(stranger), []);
    for (const [method, path, body, query] of [
      [
        "PUT",
        "/api/me/cheers",
        { item_id: id, item: refOf(it), cheer: "well_played" },
      ],
      [
        "POST",
        "/api/me/comments",
        { item_id: id, item: refOf(it), text: "An unavailable game" },
      ],
      [
        "GET",
        "/api/me/comments",
        undefined,
        { item: id, item_ref: JSON.stringify(refOf(it)) },
      ],
    ]) {
      const denied = await call(stranger, method, path, body, query);
      assert.equal(denied.statusCode, 404, denied.body);
    }
    const thread = await call(reader, "GET", "/api/me/comments", undefined, {
      item: id,
      item_ref: JSON.stringify(refOf(it)),
    });
    assert.equal(thread.statusCode, 200, thread.body);
    assert.equal(thread.data.comments.length, 3);
    assert.ok(
      (
        await ctx.db.query(
          "select subject_tags from timeline_cheer where item_id=$1",
          [id],
        )
      ).rows.every((row) => row.subject_tags === null),
    );
    assert.equal(
      (await call(author, "POST", "/api/me/item-shares", refOf(it))).statusCode,
      404,
      "current Drop access never grants a public share capability",
    );
    await ctx.db.query(
      "update claim set notify=false where account_id=$1 and player_tag=$2",
      [reader, PLAYER],
    );
    assert.equal(
      await resolve(reader, it),
      null,
      "cached locator loses muted player access",
    );
    await ctx.db.query(
      "delete from account_follow where account_id=$1 and followed_account_id=$2",
      [leader, author],
    );
    assert.equal(
      await resolve(leader, it),
      null,
      "cached locator loses account follow access",
    );
  } finally {
    await ctx.db.query(
      "delete from claim where account_id=$1 and player_tag=$2",
      [reader, PLAYER],
    );
    await ctx.db.query(
      "delete from account_follow where account_id=$1 and followed_account_id=$2",
      [leader, author],
    );
  }
});

test("an exact member destination reads one canonical item and thread under its current audience", async () => {
  const old = items.find(
    (it) => it.kind === "badge_earned" && Date.parse(it.at) < now - 7 * DAY,
  );
  const privateItem = items.find((it) => it.kind === "member_away");
  const read = (account, it, ref = refOf(it)) =>
    call(account, "GET", `/api/me/timeline-items/${it.id}`, undefined, {
      item_ref: JSON.stringify(ref),
    });
  for (const it of [old, items.find((it) => it.kind === "stamp_earned")]) {
    const response = await read(stranger, it);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.data.item.id, it.id);
    assert.equal(response.data.item.item_ref.item_id, it.id);
    assert.equal(response.data.item.can_cheer, true);
    assert.ok(response.data.item.comments);
  }
  assert.equal((await read(leader, privateItem)).statusCode, 200);
  assert.equal((await read(reader, privateItem)).statusCode, 404);
  assert.equal((await read(stranger, privateItem)).statusCode, 404);
  assert.equal((await read(null, old)).statusCode, 401);
  assert.equal(
    (
      await read(stranger, old, {
        ...refOf(old),
        item_id: "tl_00000000000000000000",
      })
    ).statusCode,
    404,
  );
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [author, stranger],
  );
  try {
    const denied = await read(stranger, old);
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.data.item, undefined);
  } finally {
    await ctx.db.query(
      "delete from account_block where account_id=$1 and blocked_account_id=$2",
      [author, stranger],
    );
  }
});

test("historical conversation recovery is exact, named and subject to current audience", async () => {
  const old = items.find(
    (it) => it.kind === "badge_earned" && Date.parse(it.at) < now - 7 * DAY,
  );
  const restore = (accountId, itemId, subjectTag = PLAYER) =>
    recoverMemberItemRef(ctx.db, {
      accountId,
      itemId,
      subjectTag,
      commentedAt: at(now),
      posts: true,
    });
  assert.equal((await restore(stranger, old.id))?.item_id, old.id);
  assert.equal(await restore(stranger, old.id, MEMBER), null);
  assert.equal(await restore(stranger, "tl_00000000000000000000"), null);
  const privateItem = items.find((it) => it.kind === "member_away");
  // An old private row may have kept only the involved player, while the
  // source is its clan. The missing locator is not permission to guess.
  assert.equal(await restore(reader, privateItem.id, CLAN), null);
  assert.equal(
    (await restore(leader, privateItem.id, CLAN))?.item_id,
    privateItem.id,
  );
  const post = "tl_fed00000000000000001";
  assert.equal((await restore(follower, post))?.source, "post");
  assert.equal(await restore(stranger, post), null);
  await ctx.db.query(
    "insert into account_block(account_id,blocked_account_id) values($1,$2)",
    [author, stranger],
  );
  try {
    assert.equal(await restore(stranger, old.id), null);
  } finally {
    await ctx.db.query(
      "delete from account_block where account_id=$1 and blocked_account_id=$2",
      [author, stranger],
    );
  }
});

test("conversation pages bound current-source work across distinct recorded players", async () => {
  const tags = Array.from(
    { length: 21 },
    (_, i) =>
      `#0P${i.toString(2).replaceAll("0", "P").replaceAll("1", "Y").padStart(7, "P")}`,
  );
  for (const [i, tag] of tags.entries()) {
    await ctx.db.query("insert into player(player_tag,name) values($1,$2)", [
      tag,
      `Invented conversation player ${i}`,
    ]);
    await emitEvent(ctx.db, "badge_earned", {
      tag,
      payload: {
        name: "MasteryKnight",
        level: 10,
        prior_level: 9,
        max_level: 10,
        rung: 10,
      },
      windowStart: at(now - DAY - 60000),
      windowEnd: at(now - DAY),
    });
  }
  const built = await buildTimeline(
    ctx.db,
    tags.map((tag) => ({ kind: "player", tag })),
    {
      accountId: reader,
      interactive: true,
      fromMs: now - 2 * DAY,
      toMs: now,
      basis: "occurred",
      accountLines: false,
      lateCounts: false,
    },
  );
  const badgeItems = built.timeline.filter(
    (it) => it.kind === "badge_earned" && tags.includes(it.subject_tag),
  );
  assert.equal(badgeItems.length, 21);
  try {
    for (const it of badgeItems) {
      await ctx.db.query(
        "insert into timeline_comment(item_id,account_id,subject_tag,body) values($1,$2,$3,'A fixture contribution')",
        [it.id, reader, it.subject_tag],
      );
      await ctx.db.query(
        "update comment_conversation set item_ref=$3::jsonb where account_id=$1 and item_id=$2",
        [reader, it.id, JSON.stringify(refOf(it))],
      );
    }
    let statements = 0;
    const tracked = {
      query: (...args) => {
        statements++;
        return ctx.db.query(...args);
      },
    };
    const start = performance.now();
    const page = await readConversations(tracked, reader, { posts: true });
    console.log(
      JSON.stringify({
        benchmark: "conversation-current-sources",
        candidates: tags.length,
        shown: page.items.length,
        statements,
        ms: Math.round(performance.now() - start),
      }),
    );
    assert.equal(page.items.length, 8);
    assert.ok(page.next, "remaining candidates have a continuation");
    assert.ok(page.items.every((it) => tags.includes(it.item_ref.subject.tag)));
    assert.ok(statements <= 180, `${statements} statements`);
  } finally {
    await ctx.db.query(
      "delete from timeline_comment where account_id=$1 and subject_tag=any($2::text[])",
      [reader, tags],
    );
    await ctx.db.query(
      "delete from comment_conversation where account_id=$1 and legacy_subject_tag=any($2::text[])",
      [reader, tags],
    );
  }
});
