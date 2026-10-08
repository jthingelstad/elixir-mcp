import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  createPostgresLedger,
  createPostgresStore,
} from "@elixir-mcp/clan-state/postgres";
import { clanMaintenance } from "../src/ops-clan-maintenance.mjs";
import { defaults } from "@elixir-mcp/clan-engine";
let scratch;
before(async () => {
  scratch = await scratchDb("clan_maintenance");
});
after(async () => scratch?.drop());
test("targeted removal reconciliation previews current proof, refuses stale evidence and only appends an audited system withdrawal", async () => {
  const db = scratch.db,
    clan = "#PYL",
    tag = "#9QY";
  const ledger = createPostgresLedger(db);
  await db.query("insert into clan(clan_tag) values($1)", [clan]);
  await db.query("insert into player(player_tag) values($1)", [tag]);
  await db.query(
    "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values($1,$2,'member',now()-interval '30 days')",
    [clan, tag],
  );
  await db.query(
    `insert into player_snapshot_daily(player_tag,snapshot_date,snapshot_kind,battle_count,profile_observed_at)
    values($1,current_date-2,'daily',100,now()-interval '2 days'),($1,current_date-1,'daily',101,now()-interval '1 day')`,
    [tag],
  );
  await ledger.savePolicy(clan, {
    values: { ...defaults(), removal_enabled: true },
    by: "#LEAD",
  });
  const card = {
    card_id: "synthetic-removal",
    number: 45,
    type: "removal",
    status: "proposed",
    player_tag: tag,
    raised_at: new Date().toISOString(),
    policy_version: 1,
    evidence: {
      rationale: { headline: "8.02 battle-free days." },
      days_idle: 8.02,
    },
  };
  await ledger.putCard(clan, card);
  const spec = {
    lane: "reconcile_removal",
    clan_tag: clan,
    card_id: card.card_id,
  };
  const preview = await clanMaintenance(scratch.url, spec);
  assert.equal(preview.applied, false);
  assert.equal((await ledger.card(clan, card.card_id)).status, "proposed");
  assert.equal((await ledger.actionLog(clan, card.card_id)).length, 0);
  await db.query(
    "update player_snapshot_daily set battle_count=102 where player_tag=$1 and snapshot_date=current_date-1",
    [tag],
  );
  await assert.rejects(
    clanMaintenance(scratch.url, {
      ...spec,
      apply: true,
      expected_sha256: preview.expected_sha256,
    }),
    /changed/,
  );
  const fresh = await clanMaintenance(scratch.url, spec);
  const result = await clanMaintenance(scratch.url, {
    ...spec,
    apply: true,
    expected_sha256: fresh.expected_sha256,
  });
  assert.equal(result.status, "withdrawn");
  const saved = await ledger.card(clan, card.card_id);
  assert.deepEqual(saved.evidence, card.evidence);
  assert.equal(saved.decided_by, undefined);
  const log = await ledger.actionLog(clan, card.card_id);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, "withdrawn");
  assert.deepEqual(log[0].by, { system: "elixir-clan" });
  assert.equal(
    log[0].detail.activity_evidence.latest_activity_interval.counter_increase,
    2,
  );
  await assert.rejects(clanMaintenance(scratch.url, spec), /pending removal/);
});
test("action review reconstructs missing history without writing it and stays inside one clan", async () => {
  const ledger = createPostgresLedger(scratch.db);
  await ledger.putCard("#P0LYQ", {
    card_id: "c1",
    type: "promote",
    status: "proposed",
    raised_at: "2026-09-01T00:00:00Z",
  });
  await ledger.putCard("#P2LQ0", {
    card_id: "other",
    type: "promote",
    status: "proposed",
    raised_at: "2026-09-01T00:00:00Z",
  });
  const result = await clanMaintenance(scratch.url, {
    lane: "actions",
    clan_tag: "POLYQ",
    limit: 1,
  });
  assert.equal(result.items[0].card.card_id, "c1");
  assert.equal(
    result.items[0].log.some((x) => x.kind === "raised"),
    true,
  );
  assert.deepEqual(
    await createPostgresStore(scratch.db).listByPrefix("#P0LYQ", "action_log#"),
    [],
  );
  for (const spec of [
    { lane: "model" },
    { lane: "actions", clan_tag: "bad" },
    { lane: "actions", clan_tag: "#P0LYQ", limit: 101 },
    // Clan's own feedback lanes retired into the one record (0204).
    { lane: "feedback" },
    { lane: "respond", feedback_id: "f0", status: "done" },
  ])
    await assert.rejects(clanMaintenance("invalid://never-connect", spec));
});

test("maintenance can traverse complete inventories and reads real grants and morning receipts", async () => {
  const ledger = createPostgresLedger(scratch.db);
  const store = createPostgresStore(scratch.db);
  for (let n = 0; n < 3; n++)
    await ledger.putCard("#P0LYQ", {
      card_id: `paged${n}`,
      type: "promote",
      raised_at: `2026-10-0${n + 1}T00:00:00Z`,
    });
  const ids = [];
  let cursor;
  do {
    const page = await clanMaintenance(scratch.url, {
      lane: "actions",
      clan_tag: "#P0LYQ",
      limit: 1,
      cursor,
    });
    ids.push(...page.items.map((x) => x.card.card_id));
    cursor = page.next_cursor;
    assert.equal(page.total, 4);
  } while (cursor);
  assert.equal(new Set(ids).size, 4);
  await store.put({
    pk: "award##P0LYQ#135#war##P2LQ0",
    gsi1pk: "clan##P0LYQ",
    gsi1sk: "award#135#war#1##P2LQ0",
    granted_at: "2026-10-02T00:00:00Z",
  });
  await store.put({
    pk: "morning##P0LYQ",
    day: "2026-10-02",
    completed: true,
    attempts: 1,
  });
  const grants = await clanMaintenance(scratch.url, {
    lane: "grants",
    clan_tag: "#P0LYQ",
  });
  assert.equal(grants.total, 1);
  assert.equal(grants.items[0].granted_at, "2026-10-02T00:00:00Z");
  const morning = await clanMaintenance(scratch.url, {
    lane: "morning",
    clan_tag: "#P0LYQ",
  });
  assert.equal(morning.receipt.completed, true);
  assert.equal(morning.receipt.attempts, 1);
});

test("action summaries stay small with a large legal comment inventory; full logs remain pageable", async () => {
  const store = createPostgresStore(scratch.db);
  for (let c = 0; c < 25; c++) {
    await createPostgresLedger(scratch.db).putCard("#P2LQ0", {
      card_id: `large${c}`,
      type: "promote",
      status: "proposed",
      raised_at: "2026-10-02T00:00:00Z",
    });
    for (let n = 0; n < 200; n++)
      await store.put({
        pk: `action_log##P2LQ0#large${c}#${n}`,
        gsi1pk: "clan##P2LQ0",
        gsi1sk: `action_log#large${c}#${String(n).padStart(3, "0")}`,
        kind: "comment",
        at: "2026-10-02T00:00:00Z",
        text: "x".repeat(1000),
      });
  }
  const summary = await clanMaintenance(scratch.url, {
    lane: "actions",
    clan_tag: "#P2LQ0",
    limit: 25,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 200000);
  assert.ok(summary.items.every((i) => i.log_limit === 3));
  const log = await clanMaintenance(scratch.url, {
    lane: "action_log",
    clan_tag: "#P2LQ0",
    card_id: "large0",
    limit: 100,
  });
  assert.equal(log.total, 200);
  assert.equal(log.items.length, 100);
  assert.ok(log.next_cursor);
});
