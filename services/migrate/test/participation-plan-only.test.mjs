import { test } from "node:test";
import assert from "node:assert/strict";
import { participationPlan } from "../src/ops-participation-plan.mjs";
import {
  MEMBERS_SQL,
  FORMER_MEMBERS_SQL,
} from "@elixir-mcp/record/participation-sql";

function fixtureClient() {
  const calls = [];
  let connected = false;
  let ended = false;
  return {
    calls,
    get connected() {
      return connected;
    },
    get ended() {
      return ended;
    },
    async connect() {
      connected = true;
    },
    async end() {
      ended = true;
    },
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === MEMBERS_SQL || sql === FORMER_MEMBERS_SQL)
        return { rows: [{ player_tag: "PRIVATE_MEMBER" }] };
      if (sql.startsWith("explain (format json)"))
        return {
          rows: [
            {
              "QUERY PLAN": [
                {
                  Plan: {
                    "Node Type": "Aggregate",
                    "Plan Rows": 5,
                    "Total Cost": 42,
                    Output: ["PRIVATE_MEMBER"],
                    Plans: [
                      {
                        "Node Type": "Index Only Scan",
                        "Relation Name": "battle_participant",
                        "Index Name": "battle_participant_player_time_cover",
                        "Plan Rows": 10,
                        "Total Cost": 20,
                        "Index Cond": "PRIVATE_MEMBER",
                        Filter: "PRIVATE_CLAN",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };
      if (sql.startsWith("set ")) return { rows: [] };
      if (
        sql.includes("pg_indexes") ||
        sql.includes("pg_class") ||
        sql.includes("pg_settings")
      )
        return { rows: [] };
      throw new Error("an aggregate was executed");
    },
  };
}

test("plan-only diagnoses the canonical query without executing its aggregate or exposing bound values", async () => {
  const db = fixtureClient();
  const result = await participationPlan(
    "unused",
    {
      clan_tag: "#2PQRJ8LV",
      weeks: 8,
      queries: ["battles_by_week"],
    },
    db,
  );
  assert.equal(result.analyze, false);
  assert.equal(result.plans[0].name, "battles_by_week");
  assert.ok(
    result.plans[0].nodes.some(
      (node) => node.index === "battle_participant_player_time_cover",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE_|Index Cond|Filter|Output/,
  );
  assert.equal(
    db.calls.filter((call) => call.sql.startsWith("explain ")).length,
    1,
  );
  assert.ok(db.calls[0].sql.includes("default_transaction_read_only = on"));
  assert.ok(
    db.calls.some((call) => call.sql === "set statement_timeout = 5000"),
  );
  assert.ok(db.calls.some((call) => call.sql === "set lock_timeout = 500"));
  assert.ok(db.ended);
});

test("plan-only binds former-member plans through the canonical membership reads", async () => {
  const db = fixtureClient();
  await participationPlan(
    "unused",
    {
      clan_tag: "#2PQRJ8LV",
      queries: ["battles_by_week", "former_battles_by_week"],
    },
    db,
  );
  assert.ok(db.calls.some((call) => call.sql === FORMER_MEMBERS_SQL));
  assert.equal(
    db.calls.filter((call) => call.sql.startsWith("explain ")).length,
    2,
  );
  assert.ok(db.ended);
});

test("plan-only refuses broad or unknown requests before opening a connection", async () => {
  for (const spec of [
    { queries: [] },
    { queries: ["unknown"] },
    { queries: ["battles_by_week", "battles_by_week"] },
    { queries: ["battles_by_week", "war_weeks", "donations_by_week"] },
    { weeks: 9 },
    { clan_tag: "not a tag" },
  ]) {
    const db = fixtureClient();
    assert.ok(
      (
        await participationPlan(
          "unused",
          { clan_tag: "#2PQRJ8LV", ...spec },
          db,
        )
      ).error,
    );
    assert.equal(db.connected, false);
  }
});

test("plan-only closes its read-only connection when planning fails", async () => {
  const db = fixtureClient();
  const original = db.query.bind(db);
  db.query = (sql, values) => {
    if (sql.startsWith("explain ")) throw new Error("bounded planning timeout");
    return original(sql, values);
  };
  await assert.rejects(
    participationPlan("unused", { clan_tag: "#2PQRJ8LV" }, db),
    /bounded planning timeout/,
  );
  assert.ok(db.ended);
});

test("plan-only closes a connection that fails to initialize", async () => {
  const db = fixtureClient();
  db.connect = async () => {
    throw new Error("connection timeout");
  };
  await assert.rejects(
    participationPlan("unused", { clan_tag: "#2PQRJ8LV" }, db),
    /connection timeout/,
  );
  assert.ok(db.ended);
});
