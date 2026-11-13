/**
 * The players acceptance reads but the repo may not name (subjects.mjs):
 * resolved from the roster at run time, deterministically; a placeholder
 * that cannot be resolved skips its case rather than failing it; a
 * resolved tag never reaches the printed report; and a catalogue refresh
 * writes placeholders, never the tags the audit saw. Every tag below is
 * invented (from docs/invented-tags.json); `assertNoFixtureTag` checks
 * that none of them, in any spelling, reaches a report or a catalogue.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  KINDS,
  mask,
  PICKS,
  pickRow,
  placeholdersIn,
  redact,
  reportSubjects,
  resolveArgs,
  resolvePlaceholder,
  seedSubjects,
  substitute,
} from "./subjects.mjs";
import { gymCases } from "./gym-interp.mjs";
import { buildCatalogueCases } from "./checks/catalogue.mjs";
import { loadCatalogue, shapeCatalogue, TAG_KEY } from "./catalogue.mjs";
import { normalizeTag } from "@elixir-mcp/contracts";
import { runSuite } from "./run.mjs";
import { CLAN, JAMIE } from "./lib.mjs";

// Every tag body this file hands the runner, read from its own source, so
// a fixture added later is checked too. The owner and the clan may appear.
const FIXTURE_TAGS = [
  ...new Set(
    readFileSync(new URL(import.meta.url), "utf8")
      .match(/(?<=[#"\s])0[0289PYLQGRJCUV]{3,}(?![0-9A-Z])/gi)
      .map((t) => t.toUpperCase()),
  ),
];
function assertNoFixtureTag(text) {
  const upper = String(text).toUpperCase();
  for (const t of FIXTURE_TAGS)
    assert.ok(!upper.includes(t), `a fixture tag leaked: ${mask(`#${t}`)}`);
}

test("the leak check knows the fixtures", () => {
  assert.ok(FIXTURE_TAGS.length >= 4, FIXTURE_TAGS.length);
  assert.throws(() => assertNoFixtureTag(`x ${FIXTURE_TAGS[0].toLowerCase()}`));
});

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
    (await resolvePlaceholder(ctx, "$NOBODY_1")).reason,
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
          { args: { player_tag: "$CLANMATE_1", mode: "ladder" } },
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
  for (const c of failed) assertNoFixtureTag(c.error);
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
  assertNoFixtureTag(JSON.stringify({ shaped, stale }));
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
          tool: "clans_roster",
          args: { clan_tag: "0gg2p99y" },
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
        name: "clans_roster",
        inputSchema: { properties: { clan_tag: {} } },
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
  assert.equal(shaped.tools.clans_roster, undefined);
  assert.equal(shaped.tools.players_search, undefined);
  assert.equal(stale.length, 3);
  assertNoFixtureTag(JSON.stringify({ shaped, stale }));
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

// --- The Gym's subjects: picks, placeholders inside strings, names,
// followed players and their clans, seeded replays, retired cases.

const RIVAL_A = "#009099JJL8";
const RIVAL_B = "#009RRP008";
const FOLLOWED = "#009RVRV2J";
const FOLLOWED_IDLE = "#009UG9G82J";
const OTHER_CLAN = "#009UUQYQG";

/** A ctx answering from a table of tool -> body (or a function of args). */
function tableCtx(table) {
  const reads = [];
  return {
    reads,
    read: async (tool, args) => {
      reads.push([tool, args]);
      const t = table[tool];
      if (!t) return { isError: true, body: { error: { message: "no" } } };
      return { body: typeof t === "function" ? t(args) : t, ms: 1 };
    },
  };
}

test("every pick names a frozen read and a path, and only $RIVAL_n or $MEMBER_n", () => {
  const names = Object.keys(PICKS);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.match(name, /^\$(RIVAL|MEMBER)_[1-9][0-9]*$/, name);
    const p = PICKS[name];
    assert.equal(typeof p.tool, "string", name);
    assert.equal(typeof p.pick, "string", name);
    assert.equal(typeof p.what, "string", name);
    assert.ok(p.args && typeof p.args === "object", name);
    // No pick names a player or clan of its own: the read is a window.
    assert.equal(placeholdersIn(p.args).size, 0, name);
    assertNoFixtureTag(JSON.stringify(p));
  }
});

test("every placeholder the Gym runs is a kind or a pick", () => {
  const gym = JSON.parse(
    readFileSync(new URL("./gym.json", import.meta.url), "utf8"),
  );
  const seen = new Set();
  for (const b of gym)
    placeholdersIn({ a: b.args, c: b.calls, s: b.assert, w: b.when }, seen);
  assert.ok(seen.size > 0);
  for (const p of seen) {
    const base = p.replace(/\.name$/, "");
    const kind = /^\$([A-Z]+)_/.exec(base)[1];
    assert.ok(PICKS[base] || KINDS[kind], `${p} resolves by no kind or pick`);
  }
});

test("a pick reads one position of its answer; a position holding no tag is a reason", async () => {
  const spec = PICKS.$RIVAL_1;
  const standings = (n) => ({
    standings: Array.from({ length: n }, (_, i) => ({
      clan_tag: i === 1 ? RIVAL_A : RIVAL_B,
    })),
  });
  // Build an answer where the pick's path lands on RIVAL_A, whatever it is.
  const ctx = tableCtx({ [spec.tool]: standings(10) });
  const got = await resolvePlaceholder(ctx, "$RIVAL_1");
  assert.equal(got.reason, undefined, got.reason);
  assert.ok([RIVAL_A, RIVAL_B].includes(got.tag));
  assert.deepEqual(ctx.reads, [[spec.tool, spec.args ?? {}]]);
  const empty = tableCtx({ [spec.tool]: { standings: [] } });
  assert.match(
    (await resolvePlaceholder(empty, "$RIVAL_1")).reason,
    /holds no tag/,
  );
  const down = tableCtx({});
  assert.match(
    (await resolvePlaceholder(down, "$RIVAL_1")).reason,
    /did not answer/,
  );
});

// Four invented members for the where picks: tags sort A < B < C < D.
const MEMBER_A = "#0PCCRG";
const MEMBER_B = "#0PCRRY";
const MEMBER_C = "#0PGJYL";
const MEMBER_D = "#0PLV2Q";

const WEEK_PICK = {
  what: "a test week",
  tool: "war_history",
  args: { season_id: 1, section_index: 0 },
  pick: "member_weeks[1].player_tag",
  where: { decks_used: 4, points: 350 },
};
const week = (...rows) => ({
  member_weeks: rows.map(([player_tag, decks_used, points]) => ({
    player_tag,
    decks_used,
    points,
  })),
});

test("a where pick keeps its position while the row still holds the frozen values", () => {
  // MEMBER_D matches too, but the positional row is never traded away.
  const body = week(
    [MEMBER_D, 4, 350],
    [MEMBER_B, 4, 350],
    [MEMBER_A, 12, 900],
  );
  assert.deepEqual(pickRow(body, "$MEMBER_9", WEEK_PICK), { tag: MEMBER_B });
});

test("a where pick follows its row when a rename or a departure moves it", () => {
  const moved = week([MEMBER_C, 4, 350], [MEMBER_A, 12, 900]);
  assert.deepEqual(pickRow(moved, "$MEMBER_9", WEEK_PICK), { tag: MEMBER_C });
  // A nested key reads the row the way a case's path does.
  const nested = {
    members: [
      { player_tag: MEMBER_A, delta: { donations: 5 } },
      { player_tag: MEMBER_B, delta: { donations: 9 } },
    ],
  };
  const spec = {
    ...WEEK_PICK,
    pick: "members[0].player_tag",
    where: { "delta.donations": 9 },
  };
  assert.deepEqual(pickRow(nested, "$MEMBER_9", spec), { tag: MEMBER_B });
});

test("a where pick with no matching row, or several and no tie rule, is a reason", () => {
  const gone = week([MEMBER_A, 12, 900], [MEMBER_B, 8, 1600]);
  assert.match(
    pickRow(gone, "$MEMBER_9", WEEK_PICK).reason,
    /no row of member_weeks holds/,
  );
  const two = week(
    [MEMBER_A, 12, 900],
    [MEMBER_B, 8, 1600],
    [MEMBER_D, 4, 350],
    [MEMBER_C, 4, 350],
  );
  const why = pickRow(two, "$MEMBER_9", WEEK_PICK).reason;
  assert.match(why, /row 1 of member_weeks no longer holds/);
  assert.match(why, /2 rows do/);
  assert.match(pickRow({}, "$MEMBER_9", WEEK_PICK).reason, /is not a list/);
  assert.match(
    pickRow(two, "$MEMBER_9", { ...WEEK_PICK, pick: "a[0].b[1].c" }).reason,
    /needs a pick like/,
  );
});

test("ties: tag takes the lowest tag among several matching rows, whatever their order", () => {
  const spec = { ...WEEK_PICK, ties: "tag" };
  const one = week(
    [MEMBER_A, 12, 900],
    [MEMBER_B, 8, 1600],
    [MEMBER_D, 4, 350],
    [MEMBER_C, 4, 350],
  );
  const other = week(
    [MEMBER_C, 4, 350],
    [MEMBER_A, 12, 900],
    [MEMBER_D, 4, 350],
  );
  assert.deepEqual(pickRow(one, "$MEMBER_9", spec), { tag: MEMBER_C });
  assert.deepEqual(pickRow(other, "$MEMBER_9", spec), { tag: MEMBER_C });
});

test("a committed where pick resolves through its read", async () => {
  const name = Object.keys(PICKS).find((n) => PICKS[n].where);
  const spec = PICKS[name];
  const [rowsPath, field] = [
    spec.pick.split("[")[0],
    spec.pick.split(".").pop(),
  ];
  const ctx = tableCtx({
    [spec.tool]: {
      [rowsPath]: [{ [field]: MEMBER_A }, { [field]: MEMBER_B, ...spec.where }],
    },
  });
  assert.deepEqual(await resolvePlaceholder(ctx, name), { tag: MEMBER_B });
  assert.deepEqual(ctx.reads, [[spec.tool, spec.args]]);
});

test("every where value is one a Gym case asserts on that row of the same read", () => {
  const gym = JSON.parse(
    readFileSync(new URL("./gym.json", import.meta.url), "utf8"),
  );
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [name, spec] of Object.entries(PICKS)) {
    if (!spec.where) {
      assert.equal(spec.ties, undefined, `${name}: ties without where`);
      continue;
    }
    if (spec.ties !== undefined) assert.equal(spec.ties, "tag", name);
    const rowsPath = spec.pick.split("[")[0];
    const field = spec.pick.split(".").pop();
    const asserted = new Map();
    for (const c of gym) {
      if (c.tool !== spec.tool || !same(c.args, spec.args)) continue;
      for (const a of c.assert ?? []) {
        const [p, v] = a.eq ?? [];
        const prefix = `${rowsPath}[?${field}=${name}].`;
        if (typeof p !== "string" || !p.startsWith(prefix)) continue;
        const key = p.slice(prefix.length);
        if (asserted.has(key))
          assert.equal(asserted.get(key), v, `${name}.${key}: cases disagree`);
        asserted.set(key, v);
      }
    }
    for (const [key, want] of Object.entries(spec.where))
      assert.equal(
        asserted.get(key),
        want,
        `${name}.${key}: no case asserts ${want}`,
      );
  }
});

test("a placeholder inside a string is replaced whole; in a pattern it is escaped", () => {
  const map = new Map([
    ["$RIVAL_1", RIVAL_A],
    ["$RIVAL_10", RIVAL_B],
    ["$MEMBER_2.name", "a.b (c)"],
  ]);
  assert.equal(
    substitute("r.rivals[?clan_tag=$RIVAL_1].fame", map),
    `r.rivals[?clan_tag=${RIVAL_A}].fame`,
  );
  // $RIVAL_10 is its own placeholder, not $RIVAL_1 followed by a 0.
  assert.equal(substitute("$RIVAL_10|$RIVAL_1", map), `${RIVAL_B}|${RIVAL_A}`);
  assert.equal(
    substitute("^$MEMBER_2.name joined", map, { regex: true }),
    "^a\\.b \\(c\\) joined",
  );
  assert.ok(
    new RegExp(substitute("$MEMBER_2.name", map, { regex: true })).test(
      "x a.b (c) y",
    ),
  );
  // Unknown placeholders stay as written.
  assert.equal(substitute("$NOBODY_1", map), "$NOBODY_1");
  assert.deepEqual(
    [...placeholdersIn({ q: "a $RIVAL_1 b", r: ["$MEMBER_2.name"] })].sort(),
    ["$MEMBER_2.name", "$RIVAL_1"],
  );
});

test("$X_n.name is the resolved player's name, from players_names", async () => {
  const ctx = {
    ...tableCtx({
      players_names: (args) => ({
        names: args.player_tags.map((t) => ({
          player_tag: t,
          name: "Invented One",
        })),
      }),
    }),
  };
  seedSubjects(ctx, { $CLANMATE_1: FOLLOWED });
  assert.deepEqual(await resolvePlaceholder(ctx, "$CLANMATE_1.name"), {
    tag: "Invented One",
  });
  const none = tableCtx({ players_names: { names: [] } });
  seedSubjects(none, { $CLANMATE_1: FOLLOWED });
  assert.match(
    (await resolvePlaceholder(none, "$CLANMATE_1.name")).reason,
    /no name/,
  );
});

test("$FRIEND_n is a followed, recorded player outside the clan; $OTHERCLAN_n a followed player's clan that answers", async () => {
  const players = [
    { player_tag: JAMIE, clan_tag: CLAN, recording: "active" },
    { player_tag: FOLLOWED_IDLE, clan_tag: OTHER_CLAN, recording: "paused" },
    { player_tag: FOLLOWED, clan_tag: OTHER_CLAN, recording: "active" },
    { player_tag: "#00C298UC", clan_tag: CLAN, recording: "active" },
  ];
  const ctx = tableCtx({
    elixir_my_players: { players },
    clans_roster: (args) =>
      args.clan_tag === OTHER_CLAN ? { members: [] } : { error: "no" },
  });
  assert.deepEqual(await resolvePlaceholder(ctx, "$FRIEND_1"), {
    tag: FOLLOWED,
  });
  assert.match((await resolvePlaceholder(ctx, "$FRIEND_2")).reason, /1 of 2/);
  assert.deepEqual(await resolvePlaceholder(ctx, "$OTHERCLAN_1"), {
    tag: OTHER_CLAN,
  });
  // The followed list is read once for the run, whatever asks.
  const myPlayers = ctx.reads.filter(([t]) => t === "elixir_my_players");
  assert.ok(myPlayers.length <= 2, myPlayers.length);
});

test("a seeded subject reads nothing (a bite's replay)", async () => {
  const ctx = { read: async () => assert.fail("read") };
  seedSubjects(ctx, { $RIVAL_1: RIVAL_A, $CLANMATE_1: FOLLOWED });
  assert.deepEqual(await resolvePlaceholder(ctx, "$RIVAL_1"), { tag: RIVAL_A });
  assert.deepEqual(await resolveArgs(ctx, { player_tag: "$CLANMATE_1" }), {
    args: { player_tag: FOLLOWED },
  });
});

test("a Gym case: resolved inside filters and patterns, SKIPPED when it cannot be, never run when retired", async () => {
  const blocks = [
    {
      id: "9001.1",
      control: true,
      tool: "war_history",
      args: { season_id: 1 },
      assert: [
        { has: "standings[?clan_tag=$RIVAL_1].fame" },
        { notes_match: "$RIVAL_1 finished" },
      ],
      note: "prose may name $CLANMATE_9, which is never read",
    },
    {
      id: "9001.2",
      tool: "war_history",
      args: { season_id: 1 },
      assert: [{ has: "x" }],
      retired: "pinned one player",
    },
    {
      id: "9001.3",
      tool: "players_summary",
      args: { player_tag: "$NOBODY_1" },
      assert: [{ has: "x" }],
    },
  ];
  const [one, retired, unknown] = gymCases(blocks);
  const ctx = tableCtx({
    war_history: {
      standings: [{ clan_tag: RIVAL_A, fame: 10 }],
      notes: [`${RIVAL_A} finished first`],
    },
  });
  seedSubjects(ctx, { $RIVAL_1: RIVAL_A });
  const r = await one.run(ctx);
  assert.equal(r?.skip, undefined, r?.skip);
  assert.deepEqual(
    ctx.reads.map(([t]) => t),
    ["war_history"],
  );
  const other = tableCtx({
    war_history: { standings: [{ clan_tag: RIVAL_B, fame: 10 }], notes: [] },
  });
  seedSubjects(other, { $RIVAL_1: RIVAL_A });
  await assert.rejects(one.run(other));
  const quiet = { read: async () => assert.fail("read") };
  assert.match((await retired.run(quiet)).skip, /^RETIRED: pinned one player/);
  assert.match((await unknown.run(tableCtx({}))).skip, /^SUBJECT: .*NOBODY_1/);
});
