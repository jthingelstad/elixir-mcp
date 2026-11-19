import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  postFixture,
  AUTHOR_TAG,
  READER_TAG,
  STRANGER_TAG,
} from "../../../packages/posts/test/fixture.mjs";
import { makeHandler } from "../src/handler.mjs";
import { playerPairRoutes } from "../src/routes/player-pair.mjs";
import {
  playerPairSummary,
  playerPairBattles,
} from "@elixir-mcp/record/player-pair";

let ctx, people, handler;
const tokens = new Map();
const payload = (r) => JSON.parse(r.body);
async function call(who = "reader", query = {}) {
  return handler({
    method: "GET",
    path: "/api/me/player-pair",
    queryStringParameters: { tag: AUTHOR_TAG, ...query },
    headers: {
      cookie: `__Host-elixir_session=${tokens.get(who)}`,
      "x-elixir-client": "web",
    },
  });
}
async function battle(id, type, sides, hours = 1, eventTag = null) {
  const at = new Date(Date.now() - hours * 3600000);
  await ctx.db.query(
    "insert into battle(battle_id,battle_time,type,type_class,event_tag,game_mode_name) values($1,$2,$3,'pvp',$4,$5)",
    [id, at, type, eventTag, type === "clanMate2v2" ? "TeamVsTeam" : "Ladder"],
  );
  for (const [side, tags] of sides.entries())
    for (const tag of tags)
      await ctx.db.query(
        "insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,outcome,crowns) values($1,$2,$3,$4,$5,'pvp',$6,$7)",
        [
          id,
          tag,
          side,
          at,
          type,
          side === 0 ? "win" : "loss",
          side === 0 ? 3 : 1,
        ],
      );
}
before(async () => {
  ctx = await scratchDb("player_pair");
  people = await postFixture(ctx.db, "player-pair");
  for (const who of ["reader", "stranger"]) {
    const { token } = await createSession(ctx.db, {
      secret: "test",
      accountId: people[who],
      emailHash: `player-pair-${who}`,
    });
    tokens.set(who, token);
  }
  handler = makeHandler({ databaseUrl: ctx.url, secret: "test" });
  await ctx.db.query(
    "insert into player(player_tag,name) values('#0PLUG2V9','Invented Opponent')",
  );
  await battle("a".repeat(64), "clanMate2v2", [
    [READER_TAG, AUTHOR_TAG],
    [STRANGER_TAG, "#0PLUG2V9"],
  ]);
  await battle("b".repeat(64), "PvP", [[READER_TAG], [AUTHOR_TAG]], 2);
});
after(async () => {
  await handler?.close();
  await ctx?.drop();
});

test("a followed friend's actual pair records keep teammate and opponent evidence in separate modes", async () => {
  const response = await call();
  assert.equal(response.statusCode, 200, response.body);
  const data = payload(response);
  assert.equal(data.selected_player, READER_TAG);
  const day = data.modes.find((m) => m.key === "casual").days[0];
  assert.equal(day.teamed, true);
  assert.equal(day.wins, 1);
  assert.match(day.day, /^\d{4}-\d\d-\d\d$/);
  assert.equal(data.modes.find((m) => m.key === "casual").teamed, 1);
  assert.equal(data.modes.find((m) => m.key === "casual").against, 0);
  assert.equal(data.modes.find((m) => m.key === "ladder").against, 1);
  const teamed = payload(
    await call("reader", { mode: "casual", side: "teamed" }),
  );
  assert.equal(teamed.battles.length, 1);
  assert.equal(teamed.battles[0].battle_id, "a".repeat(64));
  assert.ok(teamed.battles[0].url.includes("/battle/"));
  assert.equal(
    payload(await call("reader", { mode: "ladder", side: "teamed" })).battles
      .length,
    0,
  );
});

test("only a current visible friend and a verified owned player can read pair associations", async () => {
  assert.equal((await call("stranger")).statusCode, 404);
  assert.equal((await call(null)).statusCode, 401);
  const agent = playerPairRoutes({
    resolveAccount: async () => ({ kind: "agent", accountId: people.reader }),
  });
  assert.equal(
    (await agent["GET /api/me/player-pair"](null, {})).statusCode,
    403,
  );
  assert.equal((await call("reader", { as: STRANGER_TAG })).statusCode, 404);
  assert.equal(
    (await call("reader", { side: "teamed", mode: "everything" })).statusCode,
    400,
  );
  assert.equal(
    (await call("reader", { side: "teamed", mode: "casual", before: "broken" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await call("reader", {
        side: "teamed",
        mode: "casual",
        before: Buffer.from(
          JSON.stringify({ at: "0", id: "a".repeat(64) }),
        ).toString("base64url"),
      })
    ).statusCode,
    400,
  );
  for (const [a, b] of [
    [people.reader, people.author],
    [people.author, people.reader],
  ]) {
    await ctx.db.query(
      "insert into account_block(account_id,blocked_account_id) values($1,$2)",
      [a, b],
    );
    assert.equal((await call()).statusCode, 404);
    const page = await handler({
      method: "GET",
      path: "/api/player",
      queryStringParameters: { tag: AUTHOR_TAG },
      headers: { cookie: `__Host-elixir_session=${tokens.get("reader")}` },
    });
    assert.equal(page.statusCode, 200, page.body);
    assert.equal(
      payload(page).you.pair,
      false,
      "the tab does not disclose a blocked social association",
    );
    await ctx.db.query("delete from account_block");
  }
  await ctx.db.query(
    "update claim set status='unverified' where account_id=$1 and is_primary",
    [people.reader],
  );
  try {
    assert.equal(payload(await call()).state, "verify");
    const page = await call("reader", { side: "teamed", mode: "casual" });
    assert.equal(page.statusCode, 403, page.body);
    assert.deepEqual(payload(page), { error: "verification_required" });
  } finally {
    await ctx.db.query(
      "update claim set status='verified' where account_id=$1 and is_primary",
      [people.reader],
    );
  }
});

test("two verified own players are distinct pairs, not pooled across their sides", async () => {
  await ctx.db.query(
    "insert into claim(account_id,player_tag,relationship,status,verified_at) values($1,'#0PLUG2V9','alt','verified',now())",
    [people.reader],
  );
  try {
    const own = payload(await call("reader", { as: "#0PLUG2V9" }));
    assert.equal(own.selected_player, "#0PLUG2V9");
    assert.equal(own.own_players.length, 2);
    assert.equal(own.modes.find((m) => m.key === "casual").teamed, 0);
    assert.equal(own.modes.find((m) => m.key === "casual").against, 1);
    assert.equal(
      own.modes.some((m) => m.key === "ladder"),
      false,
    );
  } finally {
    await ctx.db.query(
      "delete from claim where account_id=$1 and player_tag='#0PLUG2V9'",
      [people.reader],
    );
  }
});

test("boats, out-of-window games and unrelated players never imply a shared battle", async () => {
  await battle("c".repeat(64), "boatBattle", [[READER_TAG], [AUTHOR_TAG]]);
  await battle("d".repeat(64), "PvP", [[READER_TAG], [AUTHOR_TAG]], 31 * 24);
  await battle("e".repeat(64), "PvP", [[READER_TAG], [STRANGER_TAG]]);
  await battle("f".repeat(64), "PvP", [[STRANGER_TAG], [AUTHOR_TAG]]);
  const modes = payload(await call()).modes;
  assert.equal(modes.find((m) => m.key === "casual").teamed, 1);
  assert.equal(modes.find((m) => m.key === "ladder").against, 1);
  assert.equal(
    modes.some((m) => m.key === "war"),
    false,
  );
  assert.deepEqual(
    await playerPairSummary(ctx.db, {
      playerTag: READER_TAG,
      friendTag: READER_TAG,
      fromMs: Date.now() - 30 * 86400000,
      toMs: Date.now(),
    }),
    [],
    "a player is never their own teammate",
  );
});

test("a page applies the pair, side and mode before its cap, with stable tied-time pagination", async () => {
  const time = new Date(Date.now() - 3600000);
  const ids = [];
  for (let i = 20; i < 42; i++) {
    const id = i.toString(16).padEnd(64, "0");
    ids.push(id);
    await battle(id, "friendly", [[READER_TAG], [AUTHOR_TAG]]);
    await ctx.db.query("update battle set battle_time=$2 where battle_id=$1", [
      id,
      time,
    ]);
    await ctx.db.query(
      "update battle_participant set battle_time=$2 where battle_id=$1",
      [id, time],
    );
  }
  const first = payload(
    await call("reader", { side: "against", mode: "casual" }),
  );
  assert.equal(first.battles.length, 20);
  assert.ok(first.next_before);
  const rest = payload(
    await call("reader", {
      side: "against",
      mode: "casual",
      before: first.next_before,
    }),
  );
  assert.equal(rest.battles.length, 2);
  assert.equal(rest.next_before, null);
  const got = [...first.battles, ...rest.battles].map((b) => b.battle_id);
  assert.deepEqual(got, ids.toReversed());
  assert.equal(new Set(got).size, 22);
  assert.equal(
    payload(await call("reader", { side: "teamed", mode: "casual" })).battles
      .length,
    1,
  );
});

test("pair reads probe only the named player's range and matched battle keys", async () => {
  await ctx.db.query(`insert into battle(battle_id,battle_time,type,type_class)
    select md5('pair-filler-'||n)||md5('pair-tail-'||n),now()-interval '12 days','PvP','pvp' from generate_series(1,10000)n`);
  await ctx.db.query(
    `insert into battle_participant(battle_id,player_tag,side,battle_time,type,type_class,outcome)
    select b.battle_id,t.tag,t.side,b.battle_time,b.type,b.type_class,'win'
      from generate_series(1,10000)n join battle b on b.battle_id=md5('pair-filler-'||n)||md5('pair-tail-'||n)
      cross join(values($1::text,0),($2::text,1))t(tag,side)`,
    [AUTHOR_TAG, STRANGER_TAG],
  );
  await ctx.db.query("analyze battle;analyze battle_participant");
  const queries = [];
  const db = {
    query: (text, values) => {
      queries.push({ text, values });
      return ctx.db.query(text, values);
    },
  };
  const ask = {
    playerTag: READER_TAG,
    friendTag: AUTHOR_TAG,
    fromMs: Date.now() - 30 * 86400000,
    toMs: Date.now(),
  };
  await playerPairSummary(db, ask);
  await playerPairBattles(db, { ...ask, mode: "casual", side: "against" });
  const visit = (node, fn) => {
    fn(node);
    for (const child of node.Plans ?? []) visit(child, fn);
  };
  let maxBuffers = 0;
  for (const query of queries) {
    const root = (
      await ctx.db.query(
        `explain(analyze,buffers,format json) ${query.text}`,
        query.values,
      )
    ).rows[0]["QUERY PLAN"][0].Plan;
    visit(root, (node) => {
      if (["battle", "battle_participant"].includes(node["Relation Name"]))
        assert.notEqual(
          node["Node Type"],
          "Seq Scan",
          `${node["Relation Name"]} must remain a bounded index probe`,
        );
    });
    const buffers =
      (root["Shared Hit Blocks"] ?? 0) + (root["Shared Read Blocks"] ?? 0);
    maxBuffers = Math.max(maxBuffers, buffers);
    assert.ok(buffers < 500, `${buffers} shared buffers`);
  }
  console.log(
    JSON.stringify({
      benchmark: "player-pair",
      unrelated_battles: 10000,
      queries: queries.length,
      max_shared_buffers: maxBuffers,
    }),
  );
});
