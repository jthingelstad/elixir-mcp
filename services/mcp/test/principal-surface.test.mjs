/**
 * A connection's tool surface describes the job it is for (0.30.0).
 *
 * The failure this prevents is quiet rather than loud. A clan leader may hold a
 * personal connector AND an agent connector in one Claude session; if both
 * publish identical tool lists, the model chooses between them arbitrarily and
 * the two answer from different subjects without saying so. elixir_my_players
 * is the sharpest case — on an agent connection its honest answer would be its
 * OWNER's claimed players, which is how a clan bot came to be able to recite
 * personal tags into a public channel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRegistry } from "../src/tools.mjs";
import { handleMcpMessage } from "../src/protocol.mjs";

const registry = makeRegistry();
const names = (kind) => registry.declarations(kind).map((d) => d.name);

const context = (kind) => ({
  registry,
  kind,
  spendQuota: async () => ({ allowed: true, count: 1, max: 100 }),
  invokeTool: async () => ({ body: { ok: true }, isError: false }),
});

const call = (kind, name) =>
  handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    },
    context(kind),
  );

test("a person still sees everything — the default surface does not move", () => {
  assert.equal(names("person").length, registry.declarations().length);
  assert.ok(names("person").includes("elixir_my_players"));
  assert.ok(
    names(null).includes("elixir_my_players"),
    "unknown kind is a person",
  );
});

test("an agent has no personal identity tools", () => {
  const agent = names("agent");
  assert.ok(!agent.includes("elixir_my_players"));
  assert.ok(!agent.includes("elixir_add_player"));
  assert.ok(!agent.includes("elixir_add_clan"));
  // But it keeps the things a clan agent actually needs.
  assert.ok(agent.includes("elixir_events"), "its own feed");
  assert.ok(agent.includes("elixir_feedback"), "and its own voice");
  assert.ok(agent.includes("war_current"));
  assert.ok(agent.includes("game_clock"));
});

test("an integration has no 'me' at all", () => {
  const integration = names("integration");
  assert.ok(!integration.includes("elixir_my_players"));
  assert.ok(!integration.includes("elixir_nickname"), "nobody to nickname");
  assert.ok(
    !integration.includes("elixir_events"),
    "no subjects, so an empty pipe forever",
  );
  // It is a corpus consumer, and the corpus is all still there.
  assert.ok(integration.includes("players_profile"));
  assert.ok(integration.includes("battles_meta_decks"));
  assert.ok(integration.includes("game_clock"));
});

test("hiding is not enforcement: a remembered tool is refused, not served", async () => {
  // Clients cache tools/list for a long time -- this server publishes a
  // fingerprint precisely because they do. An agent holding yesterday's list
  // must not be able to call off it.
  const refused = await call("agent", "elixir_my_players");
  assert.ok(refused.payload.error, "an agent calling a person tool is refused");
  assert.equal(refused.payload.error.code, -32601);
  assert.equal(refused.payload.error.data.kind, "agent");

  const allowed = await call("agent", "war_current");
  assert.ok(allowed.payload.result, "and its own tools still work");
});

test("a person calling the same tool is served", async () => {
  const res = await call("person", "elixir_my_players");
  assert.ok(res.payload.result);
});

test("initialize advertises the surface the caller will actually get", async () => {
  const forAgent = await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    context("agent"),
  );
  const forPerson = await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    context("person"),
  );
  // The fingerprint rides serverInfo.version, so two surfaces must not claim
  // to be the same one -- that string is the only cache-buster clients honour.
  assert.notEqual(
    forAgent.payload.result.serverInfo.version,
    forPerson.payload.result.serverInfo.version,
  );
});

test("the opening brief no longer sends anyone to look themselves up", async () => {
  const brief = async (kind, identity = null) =>
    (
      await handleMcpMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { ...context(kind), identity },
      )
    ).payload.result.instructions;

  const person = await brief("person");
  const agent = await brief("agent");
  const integration = await brief("integration");

  // The regression this replaces: every brief opened with "Start with
  // elixir_my_players", a holdover from before universal reads that cost a
  // round trip -- sometimes three -- at the start of every session.
  for (const [name, text] of [
    ["person", person],
    ["agent", agent],
    ["integration", integration],
  ])
    assert.ok(
      !/Start with elixir_my_players/.test(text),
      `${name} still enumerates first`,
    );

  // Everyone is still invited to file friction; that is the point of the
  // exercise, not a person-only courtesy.
  for (const text of [person, agent, integration])
    assert.ok(text.includes("elixir_feedback"));
});

test("a person is told who they are, and told not to look it up", async () => {
  const identity = {
    kind: "person",
    grouped: {
      primary: [
        { player_tag: "#UL2V9QRG0", name: "raquaza", is_primary: true },
      ],
      alt: [{ player_tag: "#U8RYG9Y2U", name: "King Levy" }],
      watching: [{ player_tag: "#20R8QRLYLP", name: "Chanco" }],
    },
    clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS" }],
  };
  const text = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { ...context("person"), identity },
    )
  ).payload.result.instructions;

  assert.match(text, /YOU ARE raquaza #UL2V9QRG0/);
  assert.match(text, /Also you, under another tag: King Levy #U8RYG9Y2U/);
  assert.match(text, /watching: Chanco #20R8QRLYLP/);
  assert.match(text, /Your clan is POAP KINGS #J2RGCRVG/);
  assert.match(text, /OMIT player_tag and clan_tag/);
});

test("an agent is told its clan and how to learn who is asking", async () => {
  const identity = {
    kind: "agent",
    clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS", members: 48 }],
    leaders: [
      { player_tag: "#20JJJ2CCRU", name: "King Thing", role: "leader" },
      { player_tag: "#UL2V9QRG0", name: "raquaza", role: "coLeader" },
    ],
    identityCount: 3,
  };
  const text = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { ...context("agent"), identity },
    )
  ).payload.result.instructions;

  assert.match(text, /YOU ACT FOR POAP KINGS #J2RGCRVG \(48 members\)/);
  assert.match(text, /King Thing \(leader\)/);
  assert.match(text, /on_behalf_of/);
  assert.match(text, /elixir_identify/);
  assert.match(text, /You already know 3 of them/);

  // The roster is deliberately NOT here: it changes daily and this text is
  // held until the agent reconnects.
  assert.ok(!text.includes("#20R8QRLYLP"), "no roster in the block");
  assert.match(text, /clans_roster ONCE/);
});

test("a person with no player is told how to get one, not left to fail", async () => {
  const text = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        ...context("person"),
        identity: { kind: "person", grouped: {}, clans: [] },
      },
    )
  ).payload.result.instructions;
  assert.match(text, /no player yet/);
  assert.match(text, /elixir_add_player/);
});
