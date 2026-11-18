import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
  READER_TAG,
  STRANGER_TAG,
} from "../../../packages/posts/test/fixture.mjs";
import { gzipSync } from "node:zlib";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { ensurePassport } from "@elixir-mcp/stamps";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
const ALT = "#0UCCGLUQ",
  UNVERIFIED = "#0RPYVQ9R",
  OUTSIDER = "#0JR2U89V";
const A = "#0L8P9LLJ",
  B = "#0QC8RCGY",
  C = "#0Q2L8";
const rosterAt = new Date(Date.now() - 60_000);
let ctx, people, handler, token;
const ids = {};
const call = async (method, path, body) => {
  const response = await handler({
    method,
    path: path.split("?")[0],
    queryStringParameters: Object.fromEntries(
      new URLSearchParams(path.split("?")[1] ?? ""),
    ),
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ...response, data: JSON.parse(response.body) };
};
const page = (tag) => call("GET", `/api/player?tag=${encodeURIComponent(tag)}`);
before(async () => {
  ctx = await scratchDb("clanmate_connections");
  people = await postFixture(ctx.db, "clanmate-connections");
  await ctx.db.query(
    "delete from claim where account_id=$1 and relationship='friend'",
    [people.reader],
  );
  for (const [tag, name] of [
    [ALT, "Invented Alt"],
    [UNVERIFIED, "Invented Unverified"],
    [OUTSIDER, "Invented Outsider"],
  ])
    await ctx.db.query("insert into player(player_tag,name)values($1,$2)", [
      tag,
      name,
    ]);
  for (const [tag, verified] of [
    [ALT, true],
    [UNVERIFIED, false],
  ])
    await ctx.db.query(
      "insert into claim(account_id,player_tag,relationship,status,verified_at)values($1,$2,'alt',$3,$4)",
      [
        people.reader,
        tag,
        verified ? "verified" : "unverified",
        verified ? rosterAt : null,
      ],
    );
  for (const [tag, name] of [
    [A, "Invented Main Clan"],
    [B, "Invented Alt Clan"],
    [C, "Invented Other Clan"],
  ]) {
    await ctx.db.query(
      "insert into clan(clan_tag,name,roster_observed_at)values($1,$2,$3)",
      [tag, name, rosterAt],
    );
    await ctx.db.query(
      "insert into poll_state(subject_tag,endpoint,last_admitted_at)values($1,'clan',$2)",
      [tag, rosterAt],
    );
  }
  for (const [tag, clan] of [
    [READER_TAG, A],
    [STRANGER_TAG, A],
    [ALT, B],
    [AUTHOR_TAG, B],
    [UNVERIFIED, C],
    [OUTSIDER, C],
  ])
    await ctx.db.query(
      "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role)values($1,$2,$3,'member')",
      [clan, tag, new Date(rosterAt.getTime() - 3600_000)],
    );
  ({ token } = await createSession(ctx.db, {
    secret: "test",
    accountId: people.reader,
    emailHash: "clanmate-connections-reader",
  }));
  for (const who of ["author", "reader", "fan"]) {
    ids[who] = (await ensurePassport(ctx.db, people[who])).passport_id;
    await ctx.db.query("update account set handle=$2 where account_id=$1", [
      people[who],
      `invented_${who}`,
    ]);
  }
  handler = makeHandler({
    databaseUrl: ctx.url,
    secret: "test",
    enqueue: async () => {},
  });
});
beforeEach(async () => {
  await ctx.db.query(
    "update claim set status='verified',verified_at=$3 where account_id=$1 and player_tag=any($2::text[])",
    [people.reader, [READER_TAG, ALT], rosterAt],
  );
  await ctx.db.query(
    "update account set starter_hidden_at=null where account_id=$1",
    [people.reader],
  );
  await ctx.db.query("delete from account_block");
  await ctx.db.query("delete from claim where account_id=$1", [people.fan]);
  await ctx.db.query("delete from player_profile_membership");
  await ctx.db.query(
    "delete from claim where account_id=$1 and relationship='friend'",
    [people.reader],
  );
  await ctx.db.query("delete from account_follow where account_id=$1", [
    people.reader,
  ]);
  await ctx.db.query("update clan_membership set left_observed_at=null");
  await ctx.db.query(
    "update poll_state set last_admitted_at=$1 where endpoint='clan'",
    [rosterAt],
  );
  await ctx.db.query("delete from poll_state where endpoint='player'");
  await ctx.db.query("update clan set roster_observed_at=$1", [rosterAt]);
});
after(async () => {
  await handler?.close();
  await ctx?.drop();
});
test("a current verified alt's roster creates a Clanmate, not a stored friend or quota claim", async () => {
  const before = (await ctx.db.query("select count(*)::int as n from claim"))
    .rows[0].n;
  const response = await page(AUTHOR_TAG);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.data.you.connection, "clanmate");
  assert.equal(response.data.you.clanmate, B);
  assert.deepEqual(response.data.you.shared_clan, {
    clan_tag: B,
    name: "Invented Alt Clan",
  });
  assert.equal(response.data.you.following, false);
  assert.equal(response.data.you.close, false);
  assert.equal((await page(STRANGER_TAG)).data.you.connection, "clanmate");
  assert.equal(
    (await page(OUTSIDER)).data.you.connection,
    null,
    "unverified own claim cannot anchor automatic connections",
  );
  assert.equal((await page(READER_TAG)).data.you.connection, "self");
  assert.equal(
    (await page(ALT)).data.you.clanmate,
    null,
    "own players are not clanmates of themselves",
  );
  assert.equal(
    (await ctx.db.query("select count(*)::int as n from claim")).rows[0].n,
    before,
  );
});
test("newer profile absence, unknown evidence and a moved clan override an old open roster", async () => {
  for (const [state, tag] of [
    ["none", B],
    ["unknown", B],
    ["member", C],
  ]) {
    await ctx.db.query(
      "insert into player_profile_membership(player_tag,state,observed_at,clan_tag,clan_observed_at)values($1,$2,$3,$4,$3)on conflict(player_tag)do update set state=excluded.state,observed_at=excluded.observed_at,clan_tag=excluded.clan_tag,clan_observed_at=excluded.clan_observed_at",
      [
        AUTHOR_TAG,
        state,
        new Date(rosterAt.getTime() + 30_000),
        state === "member" ? tag : null,
      ],
    );
    await ctx.db.query(
      "update player set last_known_clan_tag=$2,last_seen_at=$3 where player_tag=$1",
      [AUTHOR_TAG, tag, new Date(rosterAt.getTime() + 30_000)],
    );
    const read = (await page(AUTHOR_TAG)).data;
    assert.equal(read.you.connection, null, state);
    assert.equal(
      read.player.clan_tag,
      null,
      `${state}: header cannot repeat the contradicted old roster`,
    );
    assert.equal(read.player.clan_name, null, `${state}: no stale clan name`);
  }
});
test("two-way blocks suppress automatic membership and explicit Friend/Close takes precedence", async () => {
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship,close)values($1,$2,'friend',true)",
    [people.reader, AUTHOR_TAG],
  );
  const friend = (await page(AUTHOR_TAG)).data.you;
  assert.equal(friend.connection, "friend");
  assert.equal(friend.close, true);
  assert.equal(friend.clanmate, B);
  for (const [a, b] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      "insert into account_block(account_id,blocked_account_id)values($1,$2)",
      [a, b],
    );
    const blockedPage = (await page(AUTHOR_TAG)).data;
    assert.equal(
      blockedPage.player.clan_tag,
      B,
      "public current game identity is independent of a social block",
    );
    assert.equal(blockedPage.player.clan_name, "Invented Alt Clan");
    const blocked = blockedPage.you;
    assert.equal(blocked.connection, null);
    assert.equal(blocked.clanmate, null);
    assert.equal(blocked.shared_clan, null);
    await ctx.db.query("delete from account_block");
  }
});
test("removing a voluntary friend leaves the current automatic Clanmate connection", async () => {
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship)values($1,$2,'friend')",
    [people.reader, AUTHOR_TAG],
  );
  const response = await call("POST", "/api/me/players", {
    action: "remove",
    player_tag: AUTHOR_TAG,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.data.connection, "clanmate");
  assert.equal(response.data.clanmate, B);
  assert.equal((await page(AUTHOR_TAG)).data.you.following, false);
});
test("onboarding names automatic clanmates without asking to follow them", async () => {
  for (const path of ["starter", "suggested", "find"]) {
    const response = await call("GET", `/api/me/people/${path}`);
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(
      !response.data.people.some((p) =>
        [AUTHOR_TAG, STRANGER_TAG].includes(p.tag),
      ),
      path,
    );
    if (path === "starter") {
      assert.equal(response.data.clanmate_count, 2);
      assert.deepEqual(
        response.data.clanmates.map((p) => p.tag).sort(),
        [AUTHOR_TAG, STRANGER_TAG].sort(),
      );
    }
  }
  await ctx.db.query(
    "update account set starter_hidden_at=now() where account_id=$1",
    [people.reader],
  );
  const hidden = await call("GET", "/api/me/people/starter");
  assert.equal(hidden.data.offer, false);
  assert.equal(
    hidden.data.clanmate_count,
    2,
    "Not now does not erase existing automatic connections",
  );
});
test("Find's clan section includes verified alts and plan context survives an empty peer list", async () => {
  const response = await call("GET", "/api/me/people/clan");
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(
    response.data.players.map((p) => p.player_tag).sort(),
    [AUTHOR_TAG, STRANGER_TAG].sort(),
  );
  assert.ok(response.data.players.every((p) => p.connection === "clanmate"));
  await ctx.db.query(
    "update clan_membership set left_observed_at=now() where player_tag=$1",
    [AUTHOR_TAG],
  );
  const plan = await call(
    "GET",
    `/api/me/follow-plan?clan_tag=${encodeURIComponent(B)}`,
  );
  assert.equal(plan.statusCode, 200, plan.body);
  assert.deepEqual(plan.data.shared_clan, {
    clan_tag: B,
    name: "Invented Alt Clan",
  });
  assert.deepEqual(plan.data.players, []);
});

test("profile clan evidence survives unrelated later identity sightings", async () => {
  const observed = new Date(rosterAt.getTime() + 10_000);
  await ctx.db.query(
    "insert into player_profile_membership(player_tag,state,observed_at,clan_tag,clan_observed_at)values($1,'member',$2,$3,$2)",
    [AUTHOR_TAG, observed, B],
  );
  await ctx.db.query(
    "update player set last_known_clan_tag=$2,last_seen_at=now() where player_tag=$1",
    [AUTHOR_TAG, C],
  );
  assert.equal((await page(AUTHOR_TAG)).data.you.connection, "clanmate");
  await ctx.db.query(
    "update player_profile_membership set clan_observed_at=null where player_tag=$1",
    [AUTHOR_TAG],
  );
  assert.equal(
    (await page(AUTHOR_TAG)).data.you.connection,
    null,
    "old projector cannot reuse an earlier clan tag",
  );
  await ctx.db.query(
    "update clan set roster_observed_at=now() where clan_tag=$1",
    [B],
  );
  assert.equal(
    (await page(AUTHOR_TAG)).data.you.connection,
    "clanmate",
    "a newer roster independently confirms membership",
  );
});
test("own-player current evidence gates the entire automatic clan and never uses a followed clan", async () => {
  await ctx.db.query(
    "insert into player_profile_membership(player_tag,state,observed_at)values($1,'none',now())",
    [ALT],
  );
  assert.equal((await page(AUTHOR_TAG)).data.you.connection, null);
  assert.equal((await page(STRANGER_TAG)).data.you.connection, "clanmate");
  await ctx.db.query(
    "update clan_membership set left_observed_at=now() where player_tag=$1",
    [READER_TAG],
  );
  const clan = await call("GET", "/api/me/people/clan");
  assert.equal(clan.data.clan, null);
  assert.equal(clan.data.requires_verification, false);
  await ctx.db.query(
    "update claim set status='unverified',verified_at=null where account_id=$1 and (is_primary or relationship='alt')",
    [people.reader],
  );
  assert.equal(
    (await call("GET", "/api/me/people/clan")).data.requires_verification,
    true,
  );
  await ctx.db.query(
    "update claim set status='verified',verified_at=now() where account_id=$1 and player_tag=any($2::text[])",
    [people.reader, [READER_TAG, ALT]],
  );
});
test("circle suggestions name shared clans only for current friends, including a verified alt’s clan", async () => {
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship) values($1,$2,'friend')",
    [people.reader, AUTHOR_TAG],
  );
  const suggestions = async () =>
    (await call("GET", "/api/me/home/circle")).data.circle.suggestions;
  assert.equal(
    (await suggestions()).find((p) => p.tag === AUTHOR_TAG)?.clanmate,
    true,
  );
  assert.ok(!(await suggestions()).some((p) => p.tag === STRANGER_TAG));
  await ctx.db.query(
    "update clan_membership set left_observed_at=now() where player_tag=$1",
    [AUTHOR_TAG],
  );
  assert.equal(
    (await suggestions()).find((p) => p.tag === AUTHOR_TAG)?.clanmate,
    false,
  );
});
test("member search and account pages share the connection while account-follow stays voluntary", async () => {
  const search = await call("POST", "/api/me/tool", {
    tool: "players_search",
    args: { query: "Writer" },
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(
    search.data.body.matches.find((p) => p.player_tag === AUTHOR_TAG)
      .connection,
    "clanmate",
  );
  const accounts = await call("GET", "/api/accounts?q=invented_author");
  assert.equal(accounts.data.accounts[0].connection, "clanmate");
  const account = await call("GET", `/api/accounts/${ids.author}`);
  assert.equal(account.statusCode, 200, account.body);
  assert.equal(account.data.you.connection, "clanmate");
  assert.equal(account.data.you.following, false);
  const followed = await call("POST", "/api/me/account-follows", {
    id: ids.author,
  });
  assert.equal(followed.data.connection, "friend");
  assert.equal(followed.data.clanmate, B);
  const star = await call("POST", "/api/me/players", {
    action: "close_on",
    player_tag: AUTHOR_TAG,
  });
  assert.equal(star.statusCode, 200, star.body);
  assert.equal(
    (await call("GET", `/api/accounts/${ids.author}`)).data.you.close,
    true,
  );
  assert.equal(
    (await call("GET", "/api/accounts?q=invented_author")).data.accounts[0]
      .close,
    true,
  );
  const removed = await call("DELETE", `/api/me/account-follows/${ids.author}`);
  assert.equal(removed.data.connection, "clanmate");
  assert.equal(removed.data.following, false);
});
test("an account cannot borrow a Clanmate connection with an unverified player claim", async () => {
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship,status)values($1,$2,'alt','unverified')",
    [people.fan, STRANGER_TAG],
  );
  const response = await call("GET", `/api/accounts/${ids.fan}`);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.data.you.connection, null);
  assert.equal(response.data.you.clanmate, null);
});

test("an admitted archive-only roster does not revive membership contradicted by a newer profile", async () => {
  const {
    rows: [gateway],
  } = await ctx.db.query(
    "insert into gateway(owner_account_id,name,static_ip,status)values($1,'invented-roster-receipt','127.0.0.1','active')returning gateway_id",
    [people.reader],
  );
  const newer = new Date(rosterAt.getTime() + 20_000);
  await ctx.db.query(
    "insert into player_profile_membership(player_tag,state,observed_at,clan_tag,clan_observed_at)values($1,'none',$2,null,$2)",
    [AUTHOR_TAG, newer],
  );
  assert.equal((await page(AUTHOR_TAG)).data.you.connection, null);
  const memberList = [ALT, AUTHOR_TAG].map((tag) => ({
    tag,
    name: "Invented receipt member",
    role: "member",
  }));
  const result = await processResult(
    ctx.db,
    {
      v: 1,
      job: { endpoint: "clan", entity_key: B, lane: "bulk" },
      gateway_id: gateway.gateway_id,
      fetched_at: new Date(rosterAt.getTime() + 40_000).toISOString(),
      status: "ok",
      body_gzip_b64: gzipSync(
        Buffer.from(
          JSON.stringify({
            tag: B,
            name: "Invented Alt Clan",
            members: memberList.length,
            memberList,
          }),
        ),
      ).toString("base64"),
    },
    { skipProjection: true },
  );
  assert.equal(result.outcome, "admitted");
  const admitted = (
    await ctx.db.query(
      "select last_admitted_at from poll_state where subject_tag=$1 and endpoint='clan'",
      [B],
    )
  ).rows[0];
  assert.ok(
    admitted.last_admitted_at > newer,
    "receipt freshness really advanced",
  );
  assert.equal(
    (await page(AUTHOR_TAG)).data.you.connection,
    null,
    "no actual roster was projected",
  );
});
test("Clanmate does not grant Close or bypass voluntary Friend storage", async () => {
  const held = async () =>
    (
      await ctx.db.query(
        "select count(*)::int as n from claim where account_id=$1",
        [people.reader],
      )
    ).rows[0].n;
  const before = await held();
  const close = await call("POST", "/api/me/players", {
    action: "close_on",
    player_tag: AUTHOR_TAG,
  });
  assert.equal(close.statusCode, 404, close.body);
  assert.equal(await held(), before);
  const added = await call("POST", "/api/me/players", {
    player_tag: AUTHOR_TAG,
    relationship: "friend",
  });
  assert.equal(added.statusCode, 200, added.body);
  assert.equal(added.data.connection, "friend");
  assert.equal(added.data.clanmate, B);
  assert.equal(
    await held(),
    before + 1,
    "only the confirmed Friend creates a saved claim",
  );
  const marked = await call("POST", "/api/me/players", {
    action: "close_on",
    player_tag: AUTHOR_TAG,
  });
  assert.equal(marked.statusCode, 200, marked.body);
  assert.equal(marked.data.connection, "friend");
  assert.equal(marked.data.close, true);
});
test("blocked peers do not contribute automatic counts or Clan lists in either direction", async () => {
  for (const [a, b] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      "insert into account_block(account_id,blocked_account_id)values($1,$2)",
      [a, b],
    );
    const starter = await call("GET", "/api/me/people/starter");
    assert.equal(starter.data.clanmate_count, 1);
    assert.deepEqual(
      starter.data.clanmates.map((p) => p.tag),
      [STRANGER_TAG],
    );
    const clan = await call("GET", "/api/me/people/clan");
    assert.deepEqual(
      clan.data.players.map((p) => p.player_tag),
      [STRANGER_TAG],
    );
    await ctx.db.query("delete from account_block");
  }
});
