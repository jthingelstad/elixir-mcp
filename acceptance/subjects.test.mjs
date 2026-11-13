/**
 * The players acceptance reads but the repo may not name (subjects.mjs):
 * resolved from the roster at run time, deterministically; a placeholder
 * that cannot be resolved skips its case rather than failing it; a
 * resolved tag never reaches the printed report; and a catalogue refresh
 * writes placeholders, never the tags the audit saw. Every tag below is
 * invented (the `#0RUJ` prefix).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  mask,
  redact,
  reportSubjects,
  resolveArgs,
  resolvePlaceholder,
} from "./subjects.mjs";
import { buildCatalogueCases } from "./checks/catalogue.mjs";
import { loadCatalogue, shapeCatalogue, TAG_KEY } from "./catalogue.mjs";
import { normalizeTag } from "@elixir-mcp/contracts";
import { runSuite } from "./run.mjs";
import { CLAN, JAMIE } from "./lib.mjs";

// Relative to the clock: the runner resolves against Date.now().
const NOW = Date.now();
const recent = new Date(NOW - 2 * 86_400_000).toISOString();
const old = new Date(NOW - 100 * 86_400_000).toISOString();

/** A ctx whose roster lists members out of order, the owner among them. */
function rosterCtx(members, { collection = () => true } = {}) {
  const reads = [];
  return {
    reads,
    read: async (tool, args) => {
      reads.push([tool, args]);
      if (tool === "clans_roster") {
        assert.equal(args.clan_tag, CLAN);
        return { body: { members } };
      }
      if (tool === "players_collection")
        return collection(args.player_tag)
          ? { body: { cards: [] } }
          : {
              isError: true,
              body: { error: { code: "result_too_large" } },
            };
      throw new Error(`unexpected read ${tool}`);
    },
  };
}

const MEMBERS = [
  { player_tag: "#0RQGVPLG", last_recorded_battle: recent },
  { player_tag: JAMIE, last_recorded_battle: recent },
  { player_tag: "#0GG2P99Y", last_recorded_battle: old },
  { player_tag: "#0U9JVPYG", last_recorded_battle: recent },
  { player_tag: "#0LL9RJJQ", last_recorded_battle: null },
];

test("a clanmate is the first member by tag, owner left out, with a battle in 30 days", async () => {
  const ctx = rosterCtx(MEMBERS);
  assert.deepEqual(await resolvePlaceholder(ctx, "$CLANMATE_1", NOW), {
    tag: "#0RQGVPLG",
  });
  assert.deepEqual(await resolvePlaceholder(ctx, "$CLANMATE_2", NOW), {
    tag: "#0U9JVPYG",
  });
  const third = await resolvePlaceholder(ctx, "$CLANMATE_3", NOW);
  assert.match(third.reason, /2 of 3 found/);
  // One roster read for the run, however many placeholders.
  assert.equal(ctx.reads.filter(([t]) => t === "clans_roster").length, 1);
});

test("a collection subject is the first member whose collection answers, bounded", async () => {
  const ctx = rosterCtx(MEMBERS, {
    collection: (tag) => tag === "#0U9JVPYG",
  });
  assert.deepEqual(await resolvePlaceholder(ctx, "$COLLECTION_1", NOW), {
    tag: "#0U9JVPYG",
  });
  const none = rosterCtx(MEMBERS, { collection: () => false });
  assert.match(
    (await resolvePlaceholder(none, "$COLLECTION_1", NOW)).reason,
    /players_collection answers/,
  );
});

test("an unknown kind or a roster that does not answer is a reason, not a throw", async () => {
  const ctx = rosterCtx(MEMBERS);
  assert.match(
    (await resolvePlaceholder(ctx, "$RIVAL_1")).reason,
    /no such placeholder kind/,
  );
  const down = { read: async () => ({ isError: true, body: {} }) };
  assert.match(
    (await resolveArgs(down, { player_tag: "$CLANMATE_1" })).skip,
    /did not answer with members/,
  );
  // No placeholder: nothing is read.
  const untouched = { read: async () => assert.fail("read") };
  assert.deepEqual(await resolveArgs(untouched, { days: 7 }), {
    args: { days: 7 },
  });
});

test("an unresolved placeholder SKIPS its catalogue case; a resolved one reads the real tag", async () => {
  const cases = buildCatalogueCases({
    tools: {
      example_tool: {
        p95_ms: 1,
        sets: [
          { args: { player_tag: "$CLANMATE_1", segment: { x: 1 } } },
          { args: { player_tag: "$CLANMATE_9" } },
        ],
      },
    },
  });
  const ctx = rosterCtx(MEMBERS);
  const read = ctx.read;
  ctx.tools = new Map([
    [
      "example_tool",
      { inputSchema: { properties: {} }, outputSchema: { type: "object" } },
    ],
  ]);
  ctx.read = async (tool, args) =>
    tool === "example_tool" ? { body: { args }, ms: 1 } : read(tool, args);
  await cases.find((c) => c.id === "example_tool#0").run(ctx);
  assert.ok(
    ctx.reads.length >= 1 &&
      ctx.subjects.resolved.get("$CLANMATE_1") === "#0RQGVPLG",
  );
  const skipped = await cases.find((c) => c.id === "example_tool#1").run(ctx);
  assert.match(skipped.skip, /\$CLANMATE_9: needs a POAP KINGS member/);
});

test("a failure that echoes a resolved tag is reported with the placeholder", async () => {
  const map = new Map([["$CLANMATE_1", "#0RQGVPLG"]]);
  assert.equal(
    redact("no record of #0RQGVPLG (0RQGVPLG)", map),
    "no record of $CLANMATE_1 ($CLANMATE_1)",
  );
  assert.equal(mask("#0RQGVPLG"), "#0R******");
  const door = {
    toolsList: async () => [
      { name: "players_summary", inputSchema: { properties: {} } },
    ],
    call: async (tool, args) =>
      tool === "clans_roster"
        ? { body: { members: MEMBERS } }
        : {
            isError: true,
            body: { error: { message: `no record of ${args.player_tag}` } },
          },
  };
  const report = await runSuite(door, {
    only: "catalogue/players_summary#",
    quiet: true,
  });
  const failed = report.cases.filter((c) => c.error);
  assert.ok(failed.length > 0, "the placeholder set failed against the door");
  for (const c of failed) assert.doesNotMatch(c.error, /0RUJ/);
});

test("the run keeps full tags only in its local log, mode 0600", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "subj-")), "s.log");
  const ctx = {
    subjects: { resolved: new Map([["$CLANMATE_1", "#0RQGVPLG"]]) },
  };
  assert.deepEqual(reportSubjects(ctx, { file }), ["$CLANMATE_1 = #0R******"]);
  assert.match(readFileSync(file, "utf8"), /\$CLANMATE_1 #0RQGVPLG/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("a catalogue refresh names other players by placeholder and drops other tags", () => {
  const stale = [];
  const shaped = shapeCatalogue(
    {
      days: 7,
      per_tool: 3,
      timing: [],
      sets: [
        {
          tool: "players_summary",
          args: { player_tag: "#0RQGVPLG" },
          calls: 2,
        },
        { tool: "players_summary", args: { player_tag: JAMIE }, calls: 1 },
        {
          tool: "battles_query",
          args: { player_tag: "#0RQGVPLG", days: 30 },
          calls: 1,
        },
        {
          tool: "players_summary",
          args: { player_tag: "#0U9JVPYG" },
          calls: 1,
        },
        {
          tool: "battles_query",
          args: { player_tag: JAMIE, opponent_tag: "#0LL9RJJQ" },
          calls: 1,
        },
      ],
    },
    [
      {
        name: "players_summary",
        inputSchema: { properties: { player_tag: { pattern: "^#" } } },
      },
      {
        name: "battles_query",
        inputSchema: {
          properties: { player_tag: {}, days: {}, opponent_tag: {} },
        },
      },
    ],
    { stale },
  );
  assert.deepEqual(
    shaped.tools.players_summary.sets.map((s) => s.args.player_tag),
    ["$CLANMATE_1", JAMIE, "$CLANMATE_2"],
  );
  // One player keeps one placeholder across tools.
  assert.deepEqual(shaped.tools.battles_query.sets, [
    { args: { days: 30, player_tag: "$CLANMATE_1" }, calls: 1 },
  ]);
  assert.deepEqual(stale, [
    "battles_query: names opponent_tag, which the suite may not name",
  ]);
  assert.doesNotMatch(JSON.stringify({ shaped, stale }), /0RUJ/);
});

test("a refresh reads tags as the shared normalizer does: any spelling is caught", () => {
  const stale = [];
  const shaped = shapeCatalogue(
    {
      days: 7,
      per_tool: 3,
      timing: [],
      sets: [
        {
          tool: "players_summary",
          args: { player_tag: "#0RQGVPLG" },
          calls: 1,
        },
        { tool: "players_summary", args: { player_tag: "0rqgvplg" }, calls: 1 },
        {
          tool: "players_summary",
          args: { player_tag: " #0u9jvpyg " },
          calls: 1,
        },
        {
          tool: "players_summary",
          args: { player_tag: "20jjj2ccru" },
          calls: 1,
        },
        {
          tool: "battles_query",
          args: { player_tag: JAMIE, opponent_tag: "0ll9rjjq" },
          calls: 1,
        },
        {
          tool: "battles_performance",
          args: { segment: { clan_tag: "0gg2p99y" } },
          calls: 1,
        },
        {
          tool: "players_search",
          args: { query: "who is #0gg2p99y" },
          calls: 1,
        },
      ],
    },
    [
      {
        name: "players_summary",
        inputSchema: { properties: { player_tag: {} } },
      },
      {
        name: "battles_query",
        inputSchema: { properties: { player_tag: {}, opponent_tag: {} } },
      },
      {
        name: "battles_performance",
        inputSchema: { properties: { segment: {} } },
      },
      { name: "players_search", inputSchema: { properties: { query: {} } } },
    ],
    { stale },
  );
  // The bare lowercase spelling is the same player as the canonical one;
  // the owner in any spelling stays the owner.
  assert.deepEqual(shaped.tools.players_summary.sets, [
    { args: { player_tag: "$CLANMATE_1" }, calls: 2 },
    { args: { player_tag: "$CLANMATE_2" }, calls: 1 },
    { args: { player_tag: JAMIE }, calls: 1 },
  ]);
  assert.equal(shaped.tools.battles_query, undefined);
  assert.equal(shaped.tools.battles_performance, undefined);
  assert.equal(shaped.tools.players_search, undefined);
  assert.equal(stale.length, 3);
  assert.doesNotMatch(JSON.stringify({ shaped, stale }), /0RUJ/i);
});

/** Every tag a committed catalogue file spells, in any spelling: a tag
 *  argument's value through the shared normalizer, and any hashed tag in
 *  free text. */
function catalogueTags(value, key = null, out = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("$")) return out;
    if (TAG_KEY.test(key ?? "")) {
      try {
        out.add(normalizeTag(value));
      } catch {
        // not a tag
      }
    }
    for (const m of value.match(/#[0289PYLQGRJCUVO]{3,12}\b/gi) ?? [])
      try {
        out.add(normalizeTag(m));
      } catch {
        // not a tag
      }
  } else if (Array.isArray(value))
    for (const v of value) catalogueTags(v, key, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) catalogueTags(v, k, out);
  return out;
}

test("the committed catalogue names no player but the owner and the clan", () => {
  const seed = JSON.parse(
    readFileSync(new URL("./catalogue-seed.json", import.meta.url), "utf8"),
  );
  const tags = catalogueTags([loadCatalogue(), seed]);
  assert.deepEqual(
    [...tags].filter((t) => t !== JAMIE && t !== CLAN),
    [],
    "a real tag in the catalogue: use a placeholder (subjects.mjs)",
  );
  assert.ok(tags.has(JAMIE), "the walk reads the catalogue's tags");
  assert.deepEqual(
    [...catalogueTags({ x: { player_tag: "0rqgvplg" }, q: "see #0u9jvpyg" })],
    ["#0RQGVPLG", "#0U9JVPYG"],
  );
});
