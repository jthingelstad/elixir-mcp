/**
 * A connection's tool surface (0.30.0; one surface since 2026-11-23).
 *
 * Every connection is a person's, at `/mcp`, and is served one catalogue:
 * the same tools/list, the same fingerprint, and a brief that names who
 * the person is so nothing has to be looked up.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRegistry } from "../../../packages/tools/src/tools.mjs";
import { handleMcpMessage } from "../src/protocol.mjs";

const registry = makeRegistry();
const names = () => registry.declarations().map((d) => d.name);

const context = () => ({
  registry,
  spendQuota: async () => ({ allowed: true, count: 1, max: 100 }),
  invokeTool: async () => ({ body: { ok: true }, isError: false }),
});

const call = (name) =>
  handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    },
    context(),
  );

test("a person sees the whole catalogue (42), and no identity map", () => {
  assert.equal(names().length, 42);
  assert.ok(!names().includes("elixir_my_identities"));
  for (const tool of [
    "players_follows",
    "players_highlights",
    "clans_directory",
    "elixir_cheers",
    "elixir_my_players",
    "clans_my_view",
  ])
    assert.ok(names().includes(tool), tool);
});

test("a tool no longer in the catalogue is refused, not served", async () => {
  // Clients cache tools/list for a long time; one holding a list from
  // before 2026-11-23 must not reach a removed tool.
  const refused = await call("elixir_my_identities");
  assert.equal(refused.payload.error.code, -32602);
  assert.match(refused.payload.error.message, /Unknown tool/);
});

test("a person calling a listed tool is served", async () => {
  const res = await call("elixir_my_players");
  assert.ok(res.payload.result);
});

test("initialize advertises the catalogue's fingerprint", async () => {
  const init = await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    context(),
  );
  // serverInfo.version is the only cache-buster clients honour.
  assert.match(init.payload.result.serverInfo.version, /^tools\.[0-9a-f]{12}$/);
});

test("the opening brief no longer sends anyone to look themselves up", async () => {
  const text = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { ...context(), identity: null },
    )
  ).payload.result.instructions;
  // The regression this replaces: every brief opened with "Start with
  // elixir_my_players", a round trip at the start of every session.
  assert.ok(!/Start with elixir_my_players/.test(text));
  // Everyone is invited to file friction.
  assert.ok(text.includes("elixir_send_feedback"));
  assert.doesNotMatch(text, /on_behalf_of|YOU ACT FOR/);
});

test("a person is told who they are, and told not to look it up", async () => {
  const identity = {
    kind: "person",
    grouped: {
      primary: [
        { player_tag: "#0GVUURQ0", name: "Dove Sunny", is_primary: true },
      ],
      alt: [{ player_tag: "#0C2LVVR0", name: "Rapid Clear" }],
      friend: [{ player_tag: "#09YY2UU9", name: "Gecko Silver" }],
    },
    clans: [{ clan_tag: "#0GJJ9QJL", name: "Rival" }],
    // "Your clan" is the primary player's current clan (2026-09-25).
    primaryClan: { clan_tag: "#J2RGCRVG", name: "POAP KINGS", recorded: true },
  };
  const result = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { ...context(), identity },
    )
  ).payload.result;
  assert.equal(
    result._meta["elixir.poapkings.com/principal"].clan.tag,
    identity.primaryClan.clan_tag,
  );
  const text = result.instructions;

  assert.match(text, /YOU ARE Dove Sunny #0GVUURQ0/);
  assert.match(text, /Also you, under another tag: Rapid Clear #0C2LVVR0/);
  assert.match(text, /Friends you follow: Gecko Silver #09YY2UU9/);
  assert.match(text, /Your clan is POAP KINGS #J2RGCRVG/);
  assert.match(text, /OMIT player_tag and clan_tag/);
});

test("a person with no player is told how to get one, not left to fail", async () => {
  const text = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        ...context(),
        identity: { kind: "person", grouped: {}, clans: [] },
      },
    )
  ).payload.result.instructions;
  assert.match(text, /no player yet/);
  assert.match(text, /elixir_follow_player/);
});

test("modern discovery and the installed catalogue are the same surface", async () => {
  const run = (method, params = {}, overrides = {}) =>
    handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      {
        ...context(),
        protocolVersionHeader: "2026-07-28",
        methodHeader: method,
        nameHeader: params.name,
        ...overrides,
      },
    );
  const discovery = (await run("server/discover")).payload.result;
  assert.ok(discovery.supportedVersions.includes("2026-07-28"));
  assert.equal(discovery.capabilities.tools.listChanged, false);
  assert.equal(discovery.cacheScope, "private");
  const list = (await run("tools/list")).payload.result;
  assert.equal(list.resultType, "complete");
  assert.equal(list.cacheScope, "private");
  assert.ok(list.ttlMs >= 0);
  assert.deepEqual(list.tools, registry.declarations());
  const mismatch = await run(
    "tools/call",
    { name: "elixir_cheers" },
    { nameHeader: "war_current" },
  );
  assert.equal(mismatch.payload.error.code, -32020);
});
