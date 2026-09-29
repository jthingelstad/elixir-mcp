/**
 * The brief a client actually delivers, and the results a strict client
 * accepts (review 2026-09-27 §6.1-6.2, issue #65).
 *
 * Claude Code hands the model the first 2,048 characters of `instructions`
 * and no more. The brief ran about 4,500 for a person, so START, the
 * feedback line and half the rules never arrived, and nothing noticed:
 * acceptance and the Gym skip initialize. These render the brief for the
 * heaviest identities an account can hold and hold it to that budget.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@elixir-mcp/contracts";
import { makeRegistry } from "../../../packages/tools/src/tools.mjs";
import {
  handleMcpMessage,
  INSTRUCTIONS_BUDGET,
  requestProtocolVersion,
} from "../src/protocol.mjs";
import { OUTPUT_SCHEMAS } from "../../../packages/tools/src/output-schemas.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = makeRegistry();

const context = (kind, extra = {}) => ({
  registry,
  kind,
  spendQuota: async () => ({ allowed: true, count: 1, max: 100 }),
  invokeTool: async () => ({ body: { ok: true }, isError: false }),
  ...extra,
});

const brief = async (kind, identity) =>
  (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { ...context(kind), identity },
    )
  ).payload.result.instructions;

// Names at the game's 15-character limit, tags at their longest.
const name15 = (i) => `Player Name ${String(i).padStart(3, "0")}`;
const players = (n, prefix) =>
  Array.from({ length: n }, (_, i) => ({
    player_tag: `#${prefix}${String(i).padStart(11, "2")}`,
    name: name15(i),
  }));
const clans = (n) =>
  Array.from({ length: n }, (_, i) => ({
    clan_tag: `#C${String(i).padStart(8, "2")}`,
    name: `Clan Name ${String(i).padStart(5, "0")}`,
    members: 50,
  }));

// 50 players (the account's slots) and 10 clans.
const heavyPerson = {
  kind: "person",
  grouped: {
    primary: [{ ...players(1, "P")[0], is_primary: true }],
    alt: players(5, "A"),
    friend: players(15, "F"),
    watching: players(29, "W"),
  },
  clans: clans(10),
  // The longest clan sentence: the not-recorded clause.
  primaryClan: { ...clans(1)[0], recorded: false },
};
const heavyAgent = {
  kind: "agent",
  clans: clans(10),
  leaders: [
    { ...players(1, "L")[0], role: "leader" },
    ...players(49, "K").map((p) => ({ ...p, role: "coLeader" })),
  ],
  identityCount: 5000,
};

// Each sentence a model needs, as the start of the text that must arrive.
const KEY = {
  both: [
    "segment is REQUIRED",
    "applied.window",
    "archetype label",
    "fit_for",
    "Modes are different games",
    "notes[]",
    "re-fetch tools/list",
    "elixir_send_feedback",
    "Manual: elixir_docs",
    "protocol#argument-conventions",
  ],
  person: [
    "YOU ARE Player Name 000",
    "Your clan is Clan Name 00000",
    "elixir_my_players lists them",
    "OMIT player_tag and clan_tag",
    "START: players_summary",
  ],
  agent: [
    "YOU ACT FOR Clan Name 00000",
    "Leadership: Player Name 000 (leader)",
    "clans_roster ONCE",
    "on_behalf_of",
    "elixir_identify",
    "You already know 5000",
    "START: war_current",
    "display_name",
  ],
};

for (const [kind, identity] of [
  ["person", heavyPerson],
  ["agent", heavyAgent],
]) {
  test(`a ${kind}'s brief with a 50-player, 10-clan identity arrives whole inside ${INSTRUCTIONS_BUDGET} characters`, async () => {
    const text = await brief(kind, identity);
    const delivered = text.slice(0, INSTRUCTIONS_BUDGET);
    for (const sentence of [...KEY.both, ...KEY[kind]])
      assert.ok(
        delivered.includes(sentence),
        `"${sentence}" is cut from the ${kind} brief (${text.length} characters)`,
      );
    assert.ok(
      text.length <= INSTRUCTIONS_BUDGET,
      `the ${kind} brief is ${text.length} characters`,
    );
    assert.match(text, /not endorsed by Supercell/);
  });
}

test("a heavy identity is counted, a light one named", async () => {
  const heavy = await brief("person", heavyPerson);
  assert.match(
    heavy,
    /You also track 49 more players \(5 alts, 15 friends, 29 you watch\) and 9 more clans: elixir_my_players lists them/,
  );
  assert.ok(!heavy.includes(players(5, "A")[1].player_tag));
  const agent = await brief("agent", heavyAgent);
  assert.match(agent, /Also 9 more clans/);
  assert.match(agent, /\(leader\) and 49 co-leaders/);

  const light = await brief("person", {
    kind: "person",
    grouped: {
      primary: [{ player_tag: "#UL2V9QRG0", name: "raquaza" }],
      alt: [{ player_tag: "#U8RYG9Y2U", name: "King Levy" }],
    },
    clans: [
      { clan_tag: "#J2RGCRVG", name: "POAP KINGS" },
      { clan_tag: "#GCYQR9VY", name: "Ship It!" },
    ],
    primaryClan: { clan_tag: "#J2RGCRVG", name: "POAP KINGS", recorded: true },
  });
  assert.match(light, /Also you, under another tag: King Levy #U8RYG9Y2U/);
  assert.match(light, /You also track Ship It! #GCYQR9VY/);
  assert.ok(light.length <= INSTRUCTIONS_BUDGET);
});

test("the brief's manual pointer names a real section, and that section says the window grammar the brief no longer does", () => {
  const protocol = readFileSync(
    path.join(here, "../../../apps/site/src/docs/protocol.md"),
    "utf8",
  );
  const section = protocol
    .split(/^## /m)
    .find((s) => s.startsWith("Argument conventions"));
  assert.ok(section, "protocol#argument-conventions exists");
  // Every applied.window.source the contract has (defect 5, 2026-09-19:
  // the instructions named three of five; they now point here).
  for (const source of OUTPUT_SCHEMAS.players_summary.properties.applied
    .properties.window.properties.source.enum)
    assert.match(section, new RegExp(`\`${source}\``), source);
  assert.match(section, /verbosity: full \| compact/);
});

const agentArgs = (d) =>
  JSON.stringify(d.inputSchema).match(/"(on_behalf_of|display_name)"/g) ?? [];

test("a person's tools/list carries no agent-only argument; an agent's and the catalogue's do", () => {
  const person = registry.declarations("person");
  assert.deepEqual(person.flatMap(agentArgs), []);
  assert.deepEqual(registry.declarations(undefined).flatMap(agentArgs), []);
  // At least thirteen tools take them on an agent connection, segment's
  // object included.
  const agent = registry
    .declarations("agent")
    .filter((d) => agentArgs(d).length);
  assert.ok(agent.length >= 13, `${agent.length} agent tools take them`);
  assert.ok(
    registry
      .declarations("agent")
      .find((d) => d.name === "battles_meta_decks")
      .inputSchema.properties.segment.anyOf.some(
        (b) => b.properties?.on_behalf_of,
      ),
  );
  assert.ok(registry.declarations().flatMap(agentArgs).length > 0);
});

test("a person who still sends them is never refused: they are dropped before validation", async () => {
  const body = await registry.invoke(
    "game_clock",
    {},
    { on_behalf_of: "discord:1", display_name: "Somebody" },
  );
  assert.ok(body.meta, "answered");
  // segment's object: dropped there too, so the refusal for a real
  // mistake lists what a person's schema holds.
  await assert.rejects(
    registry.invoke(
      "battles_meta_decks",
      {},
      { segment: { on_behalf_of: "discord:1", bogus: 1 } },
    ),
    (err) =>
      err.code === "bad_request" &&
      /segment has no property 'bogus'\. Known: player_tag, clan_tag, collection\.$/.test(
        err.message,
      ),
  );
  // An agent's own unknown argument is still refused, and the hint says
  // which contract this is and to reconnect (review §6.2).
  await assert.rejects(
    registry.invoke(
      "game_clock",
      { account: { kind: "agent" } },
      { display_name: "Somebody" },
    ),
    (err) =>
      err.code === "bad_request" &&
      /has no property 'display_name'/.test(err.message) &&
      err.hint.includes(`contract ${CONTRACT_VERSION}`) &&
      /reconnect/.test(err.hint),
  );
});

const toolCall = (invoked, extra = {}) =>
  handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "game_clock", arguments: {} },
    },
    context("person", { invokeTool: async () => invoked, ...extra }),
  );

test("an error result carries no structuredContent; the text block has the envelope", async () => {
  const failed = (
    await toolCall({
      body: {
        error: {
          code: "bad_request",
          class: "input",
          message: "no",
          hint: "h",
        },
        meta: { contract_version: CONTRACT_VERSION },
      },
      isError: true,
    })
  ).payload.result;
  assert.equal(failed.isError, true);
  assert.ok(!("structuredContent" in failed), "no structuredContent on error");
  assert.equal(JSON.parse(failed.content[0].text).error.code, "bad_request");

  const ok = (
    await toolCall({
      body: { now: "x", meta: {}, notes: [], docs: "clocks" },
      isError: false,
    })
  ).payload.result;
  assert.equal(ok.isError, false);
  assert.equal(ok.structuredContent.now, "x");
});

test("MCP-Protocol-Version: absent is 2025-03-26, a supported value passes, anything else is HTTP 400", async () => {
  assert.deepEqual(requestProtocolVersion(undefined), {
    ok: true,
    version: "2025-03-26",
  });
  assert.equal(requestProtocolVersion("2025-06-18").ok, true);
  assert.equal(requestProtocolVersion("2025-03-26").ok, true);
  assert.equal(requestProtocolVersion("2099-01-01").ok, false);

  const ok = await toolCall(
    { body: { meta: {}, notes: [], docs: "clocks" }, isError: false },
    { protocolVersionHeader: "2025-06-18" },
  );
  assert.equal(ok.statusCode, 200);
  const refused = await toolCall(
    { body: { meta: {}, notes: [], docs: "clocks" }, isError: false },
    { protocolVersionHeader: "2099-01-01" },
  );
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.payload.error.code, -32600);
  assert.deepEqual(refused.payload.error.data.supported, [
    "2025-06-18",
    "2025-03-26",
  ]);
  // A notification is held to it too; initialize negotiates in its body.
  const note = await handleMcpMessage(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    context("person", { protocolVersionHeader: "1999-01-01" }),
  );
  assert.equal(note.statusCode, 400);
  const init = await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    },
    context("person", { protocolVersionHeader: "2025-11-25" }),
  );
  assert.equal(init.statusCode, 200);
  assert.equal(init.payload.result.protocolVersion, "2025-06-18");
});
