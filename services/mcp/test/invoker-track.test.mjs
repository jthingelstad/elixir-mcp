import { test } from "node:test";
import assert from "node:assert/strict";
import { makeInvoker } from "../src/invoker.mjs";

const fakeDb = { query: async () => ({ rows: [] }) };
const account = { accountId: "00000000-0000-0000-0000-000000000000" };

test("invoker pings track with the tool name; surface picks the event", async () => {
  const pings = [];
  const invoke = makeInvoker({
    db: fakeDb,
    account,
    registry: { invoke: async () => ({ ok: true }) },
    track: async (event, value) => pings.push([event, value]),
  });
  await invoke("war_current", {});
  assert.deepEqual(pings, [["mcp.tool_call", "war_current"]]);

  const webPings = [];
  const invokeWeb = makeInvoker({
    db: fakeDb,
    account,
    registry: { invoke: async () => ({ ok: true }) },
    surface: "web",
    track: async (event, value) => webPings.push([event, value]),
  });
  await invokeWeb("players_summary", {});
  assert.deepEqual(webPings, [["explore.tool_call", "players_summary"]]);
});

test("a failing track never breaks the tool call (house rule)", async () => {
  const invoke = makeInvoker({
    db: fakeDb,
    account,
    registry: { invoke: async () => ({ ok: true }) },
    track: async () => {
      throw new Error("sqs down");
    },
  });
  const { body, isError } = await invoke("players_summary", {});
  assert.equal(isError, false);
  assert.deepEqual(body, { ok: true });
});
