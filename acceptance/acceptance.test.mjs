/**
 * The harness against a fake door: the runner reports a red case as red
 * and a green one as green, the note-token rule catches the
 * finished_early class (named in notes, served on no row) and lets a
 * tool name, an argument and an allowed word through, and the door
 * client turns a JSON-RPC refusal into an answer. The suite's real cases
 * run against the deployed product from the deploy, not from here: no
 * credential in this repo reaches the real door.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeDoor } from "./door.mjs";
import { noteTokens, notesNameFields, deepKeys } from "./lib.mjs";
import { runSuite, SUITES } from "./run.mjs";

function fakeDoor(answers) {
  const fetchImpl = async (_url, init) => {
    const req = JSON.parse(init.body);
    let payload;
    if (req.method === "tools/list")
      payload = {
        result: {
          tools: Object.keys(answers).map((name) => ({
            name,
            inputSchema: { properties: { verbosity: {}, player_tag: {} } },
          })),
        },
      };
    else {
      const a = answers[req.params.name];
      payload =
        a === undefined
          ? { error: { message: "unknown tool" } }
          : typeof a === "function"
            ? a(req.params.arguments)
            : { result: { structuredContent: a } };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({ jsonrpc: "2.0", id: req.id, ...payload }),
    };
  };
  return makeDoor({ url: "http://fake/mcp", token: "svt_fake", fetchImpl });
}

test("note tokens: snake_case fields, dotted paths and [] segments; prose left alone", () => {
  const tokens = noteTokens([
    "finished_early marks the week; participants[].scoring_decks is the denominator.",
    "applied.window.partial says so; read either side as its own season.",
  ]);
  assert.deepEqual(
    [...tokens].sort(),
    ["finished_early", "scoring_decks"].sort(),
  );
  assert.ok(!tokens.has("applied"), "no underscore, no token");
  const pointed = noteTokens(["and rankings_clans.rated_players moves too."], {
    tools: new Set(["rankings_clans"]),
  });
  assert.equal(pointed.size, 0, "another tool's field, pointed at by path");
});

test("notes-name-fields: the finished_early class fails; tool names, arguments and allowed words pass", () => {
  const ctx = {
    tools: new Map([
      ["war_history", { inputSchema: { properties: { player_tag: {} } } }],
      ["war_current", {}],
    ]),
  };
  const body = {
    weeks: [{ season_id: 1, our_fame: 10134 }],
    notes: [
      "finished_early marks regular weeks where the boat hit the line.",
      "Pass player_tag for one member; war_current has the running week.",
    ],
  };
  assert.throws(
    () => notesNameFields(ctx, "war_history", body),
    /notes name finished_early and the response carries no such field/,
  );
  body.weeks[0].finished_early = true;
  notesNameFields(ctx, "war_history", body);
  body.notes.push("scoring_decks is null on such a week.");
  assert.throws(
    () => notesNameFields(ctx, "war_history", body),
    /scoring_decks/,
  );
  notesNameFields(ctx, "war_history", body, { allow: ["scoring_decks"] });
  assert.ok(deepKeys(body).has("our_fame"));
});

test("the door turns a JSON-RPC refusal into an answer and times a call", async () => {
  const door = fakeDoor({
    game_clock: { now: 1, notes: [] },
    elixir_send_feedback: () => ({
      error: {
        message:
          "The access token lacks the capability required by this tool: feedback:write.",
      },
    }),
  });
  const ok = await door.call("game_clock", {});
  assert.equal(ok.isError, false);
  assert.equal(ok.body.now, 1);
  assert.ok(Number.isInteger(ok.ms));
  const refused = await door.call("elixir_send_feedback", { message: "x" });
  assert.equal(refused.isError, true);
  assert.match(refused.body.error.message, /feedback:write/);
});

test("the runner reports red and green and reuses a read", async () => {
  let calls = 0;
  const door = fakeDoor({
    game_clock: () => {
      calls += 1;
      return { result: { structuredContent: { now: 1, notes: [] } } };
    },
  });
  const saved = { ...SUITES };
  for (const k of Object.keys(SUITES)) delete SUITES[k];
  SUITES.fake = [
    {
      id: "green",
      run: async (ctx) => {
        await ctx.read("game_clock", {});
        await ctx.read("game_clock", {});
        return { ms: 5 };
      },
    },
    {
      id: "red",
      run: async () => {
        throw new Error("an invariant broke");
      },
    },
  ];
  try {
    const report = await runSuite(door, { quiet: true });
    assert.equal(report.cases.length, 2);
    assert.equal(report.failures, 1);
    assert.deepEqual(
      report.cases.map((c) => [c.id, c.ok]),
      [
        ["fake/green", true],
        ["fake/red", false],
      ],
    );
    assert.match(report.cases[1].error, /an invariant broke/);
    assert.equal(calls, 1, "one read, cached for the run");
    const only = await runSuite(door, { quiet: true, only: "green" });
    assert.equal(only.cases.length, 1);
  } finally {
    for (const k of Object.keys(SUITES)) delete SUITES[k];
    Object.assign(SUITES, saved);
  }
});

test("gym.json loads: unique ids, every finding has a control, the verbs are known", async () => {
  const { gymCases, assertOne } = await import("./gym-interp.mjs");
  const blocks = JSON.parse(
    readFileSync(new URL("./gym.json", import.meta.url), "utf8"),
  );
  const cases = gymCases(blocks);
  assert.ok(cases.length >= blocks.length);
  assert.throws(
    () => gymCases([{ id: "99.1", tool: "game_clock", assert: [] }]),
    /finding 99 has no control/,
  );
  const body = {
    weeks: [
      { a: 1, b: 2 },
      { a: 3, b: null },
    ],
    notes: ["finished on war day 3"],
    s: { n: 4 },
  };
  assertOne({ has: "weeks[].a" }, body, body);
  assertOne({ absent: "weeks[0].c" }, body, body);
  assertOne({ eq: ["s.n", 4] }, body, body);
  assertOne({ lt: ["weeks[0].a", "weeks[0].b"] }, body, body);
  assertOne({ gte: ["s.n", 4] }, body, body);
  assertOne({ sum_eq: [["weeks[0].a", 3], "s.n"] }, body, body);
  assertOne({ sorted_asc: [["weeks[].a"]] }, body, body);
  assertOne({ notes_match: "war day \\d" }, body, body);
  assert.throws(
    () => assertOne({ eq: ["weeks[0].c", null] }, body, body),
    /absent/,
  );
  assert.throws(() => assertOne({ bogus: "x" }, body, body), /unknown verb/);
});

test("every real case is read-only: no write tool, no live: true", () => {
  // The arguments a case sends, not the prose it asserts on: a case may
  // check that a note never OFFERS live: true.
  const src = Object.values(SUITES)
    .flat()
    .map((c) => c.run.toString())
    .join("\n");
  for (const forbidden of [
    "collections_edit",
    "elixir_track_player",
    "elixir_track_clan",
    "elixir_nickname",
    "elixir_identify",
  ])
    assert.ok(!src.includes(forbidden), `${forbidden} in a case`);
  assert.ok(
    !/\blive:\s*true\s*[,}]/.test(src),
    "live: true sent as an argument",
  );
});
