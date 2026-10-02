/** War calendar health is retained independently of retired meta jobs. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
let scratch, db;
before(async () => {
  scratch = await scratchDb("war_calendar");
  db = scratch.db;
});
after(async () => {
  await scratch?.drop();
});
test("hourly: the war-calendar guard counts war-typed battles outside every period and emits the metric", async () => {
  const { warBattlesUnresolved, warUnresolvedEmf } =
    await import("../src/war-calendar.mjs");
  const before = await warBattlesUnresolved(db);
  assert.equal(before, 0, "every seeded war battle sits in a period");
  // A war battle in a season the calendar does not hold (the seed ends
  // at 2026-10; a scheduler that stopped would leave such a gap).
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class) values ('gap-1', now() - interval '1 day', 'riverRacePvP', 'pvp')`,
  );
  await db.query(
    `delete from war_period where starts_at <= now() - interval '1 day' and ends_at > now() - interval '1 day'`,
  );
  assert.equal(await warBattlesUnresolved(db), 1);
  const emf = JSON.parse(warUnresolvedEmf(await warBattlesUnresolved(db)));
  assert.equal(emf._aws.CloudWatchMetrics[0].Namespace, "ElixirMCP/Record");
  assert.equal(
    emf._aws.CloudWatchMetrics[0].Metrics[0].Name,
    "WarBattleUnresolved",
  );
  assert.equal(emf.WarBattleUnresolved, 1);
  assert.equal(JSON.parse(warUnresolvedEmf(0)).WarBattleUnresolved, 0);
});
