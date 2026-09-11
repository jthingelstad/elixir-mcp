import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { handleMcpMessage } from "../src/protocol.mjs";

let scratch;
let account;
const registry = makeRegistry();
const TAG = "#P0Y";
const call = (name, args = {}) =>
  registry.invoke(name, { db: scratch.db, account }, args);

before(async () => {
  scratch = await scratchDb("answer_integrity");
  await scratch.db.query("set timezone to 'UTC'");
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ('answer-integrity','approved') returning account_id",
  );
  account = {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
  await scratch.db.query("insert into player (player_tag) values ($1)", [TAG]);
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [TAG, account.accountId],
  );
  await scratch.db
    .query(`insert into battle (battle_id,battle_time,type,type_class,game_mode_name)
    select 'integrity-'||n,'2026-09-01'::timestamptz+n*interval '1 minute','PvP','pvp','Ladder'
    from generate_series(1,3000) n`);
  await scratch.db.query(
    `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time)
    select 'integrity-'||n,$1,0,case when n<=1000 then 'loss' else 'win' end,
      '2026-09-01'::timestamptz+n*interval '1 minute'
    from generate_series(1,3000) n`,
    [TAG],
  );
});
after(async () => scratch.drop());

test("performance totals agree across views beyond 2000 battles, with explicit recent samples preserved", async () => {
  const args = { player_tag: TAG, from: "2026-09-01", to: "2026-09-05" };
  const summary = await call("battles_performance", args);
  const weekly = await call("battles_performance", {
    ...args,
    group_by: "week",
  });
  const modes = await call("battles_performance", {
    ...args,
    group_by: "mode",
  });
  assert.equal(summary.window.battles, 3000);
  assert.equal(summary.window.win_rate, 0.667);
  assert.equal(
    summary.window.battles,
    weekly.weekly.reduce((n, r) => n + r.battles, 0),
  );
  assert.equal(
    summary.window.battles,
    modes.by_mode.reduce((n, r) => n + r.battles, 0),
  );
  assert.equal(summary.window.current_streak, 2000);
  const sampled = await call("battles_performance", {
    ...args,
    last_n_battles: 12,
  });
  assert.equal(sampled.window.battles, 12);
  assert.equal(sampled.window.current_streak, 12);
  const split = await call("battles_performance", {
    ...args,
    before_after: "2026-09-02",
  });
  assert.equal(split.before.battles + split.after.battles, 3000);
});

test("fresh profile cannot freshen battle answers; unknown inputs stay unknown", async () => {
  await scratch.db.query(
    `insert into poll_state (subject_tag,endpoint,last_admitted_at)
    values ($1,'player',now()),($1,'player_battlelog',now()-interval '2 days')`,
    [TAG],
  );
  const battle = await call("battles_performance", { player_tag: TAG });
  assert.ok(battle.meta.freshness_seconds >= 172800);
  assert.equal(battle.meta.recorded_since, "2026-09-01T00:01:00.000Z");
  assert.ok(battle.meta.recording_active_since);
  const mixed = await call("players_summary", { player_tag: TAG });
  assert.ok(mixed.meta.source_polls.player.freshness_seconds < 5);
  assert.ok(
    mixed.meta.source_polls.player_battlelog.freshness_seconds >= 172800,
  );
  await scratch.db.query(
    "delete from poll_state where subject_tag=$1 and endpoint='player_battlelog'",
    [TAG],
  );
  const unknown = await call("battles_performance", { player_tag: TAG });
  assert.equal(unknown.meta.freshness_seconds, null);
  assert.equal(unknown.meta.source_polls.player_battlelog.observed_at, null);
});

test("coverage uses matching observation intervals and updates when late battles arrive", async () => {
  const tag = "#P0G";
  await scratch.db.query("insert into player (player_tag) values ($1)", [tag]);
  await scratch.db.query(
    `insert into player_snapshot_daily
    (player_tag,snapshot_date,snapshot_kind,lifetime,observed_at) values
    ($1,current_date-3,'daily','{"battleCount":100}',now()-interval '3 days'),
    ($1,current_date,'daily','{"battleCount":130}',now())`,
    [tag],
  );
  const seed = async (start, end) => {
    await scratch.db.query(
      `insert into battle (battle_id,battle_time,type,type_class)
      select 'coverage-'||n,now()-interval '3 days'+n*interval '2 hours','PvP','pvp'
      from generate_series($1::int,$2::int) n`,
      [start, end],
    );
    await scratch.db.query(
      `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time)
      select battle_id,$1,0,'win',battle_time from battle where battle_id like 'coverage-%'
      on conflict do nothing`,
      [tag],
    );
  };
  await seed(1, 20);
  const partial = await call("elixir_coverage", { player_tag: tag });
  assert.equal(partial.observation_intervals[0].expected_battles, 30);
  assert.equal(partial.observation_intervals[0].captured_battles, 20);
  assert.equal(partial.observation_intervals[0].ratio, 0.667);
  await seed(21, 30);
  const complete = await call("elixir_coverage", { player_tag: tag });
  assert.equal(complete.observation_intervals[0].ratio, 1);
  assert.equal(complete.completeness_last_7_days.incomplete_days, null);
  assert.equal(complete.completeness_last_7_days.incomplete_intervals, 0);
  assert.equal(
    typeof complete.completeness_last_7_days.unmeasured_tail_hours,
    "number",
    "the unbracketed tail is explicit beside the measured coverage",
  );
  assert.ok(complete.completeness_last_7_days.unmeasured_tail_hours < 0.1);
});

test("oversized tool output is a bounded JSON failure retaining the request receipt", async () => {
  const response = await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "cards_catalog" },
    },
    {
      registry,
      spendQuota: async () => ({ allowed: true, max: Infinity }),
      invokeTool: async () => ({
        body: {
          cards: "x".repeat(49000),
          meta: {
            request_id: "00000000-0000-0000-0000-000000000001",
            as_of: new Date().toISOString(),
          },
        },
        isError: false,
      }),
    },
  );
  const result = response.payload.result;
  const body = JSON.parse(result.content[0].text);
  assert.equal(result.isError, true);
  assert.equal(body.error.code, "result_too_large");
  assert.equal(body.meta.request_id, "00000000-0000-0000-0000-000000000001");
  assert.ok(body.meta.disclaimer);
  assert.ok(result.content[0].text.length < 48000);
});

test("unknown snapshot times and incompatible lifetime counters do not assert coverage", async () => {
  const tag = "#P0R";
  await scratch.db.query("insert into player (player_tag) values ($1)", [tag]);
  await scratch.db.query(
    `insert into player_snapshot_daily
    (player_tag,snapshot_date,snapshot_kind,lifetime,observed_at) values
    ($1,current_date-2,'daily','{"battleCount":100}',null),
    ($1,current_date-1,'daily','{"battleCount":110}',now()-interval '1 day')`,
    [tag],
  );
  const unknown = await call("elixir_coverage", { player_tag: tag });
  assert.deepEqual(unknown.observation_intervals, []);
  assert.equal(unknown.completeness_last_7_days.average_ratio, null);
  await scratch.db.query(
    `insert into player_snapshot_daily
    (player_tag,snapshot_date,snapshot_kind,lifetime,observed_at)
    values ($1,current_date,'daily','{"battleCount":90}',now())`,
    [tag],
  );
  const reset = await call("elixir_coverage", { player_tag: tag });
  assert.equal(reset.observation_intervals[0].ratio, null);
  assert.equal(reset.completeness_last_7_days.unknown_intervals, 1);
});

test("real successes and refusals remain parseable through the MCP protocol boundary", async () => {
  const { makeInvoker } = await import("../src/invoker.mjs");
  const { assertResponseMeta } = await import("@elixir-mcp/contracts");
  for (const [name, args, fails] of [
    ["players_summary", { player_tag: TAG }, false],
    [
      "battles_performance",
      { player_tag: TAG, from: "2026-09-01", to: "2026-09-05" },
      false,
    ],
    ["battles_performance", { player_tag: "#INVALID" }, true],
  ]) {
    const result = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name, arguments: args },
      },
      {
        registry,
        spendQuota: async () => ({ allowed: true, max: Infinity }),
        invokeTool: makeInvoker({ db: scratch.db, account, registry }),
      },
    );
    const body = JSON.parse(result.payload.result.content[0].text);
    assertResponseMeta(body.meta);
    assert.equal(result.payload.result.isError ?? false, fails);
    assert.equal(result.payload.id, 42);
    const {
      rows: [receipt],
    } = await scratch.db.query(
      "select tool,error_code from mcp_call_audit where request_id=$1",
      [body.meta.request_id],
    );
    assert.equal(receipt.tool, name);
    assert.equal(receipt.error_code, fails ? "invalid_tag" : null);
    if (name === "battles_performance" && !fails)
      assert.equal(body.window.battles, 3000);
  }
});
