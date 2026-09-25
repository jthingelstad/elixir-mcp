/**
 * The tool conventions (docs/ENGINEERING.md "Tool conventions", from the
 * 2026-09-10 review), enforced where they are mechanical so a new tool
 * cannot quietly reintroduce a fifth window idiom or a sixteenth note key.
 *
 * Conventions that are about MEANING (a description says which default
 * applies; a hint names an executable next step) are checked as far as
 * text allows; the rest is review.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRegistry } from "../src/tools.mjs";
import { GROUP_ORDER, TOOL_GROUPS } from "@elixir-mcp/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(here, "../src/tools");
const declarations = makeRegistry().declarations();
const byName = new Map(declarations.map((d) => [d.name, d]));

const WINDOWED = declarations.filter((d) => {
  const p = d.inputSchema.properties ?? {};
  return "from" in p || "to" in p || "days" in p || "weeks" in p;
});

test("every windowed tool takes from and to, and the per-call timezone", () => {
  // days / weeks / seasons are sugar on top of from/to, never instead of
  // it. clans_participation is the one exception: its unit is the ISO
  // week, aligned to Monday, so an arbitrary from/to would only fall
  // between weeks.
  const exempt = new Set(["clans_participation"]);
  for (const d of WINDOWED) {
    if (exempt.has(d.name)) continue;
    const p = d.inputSchema.properties;
    assert.ok(p.from && p.to, `${d.name} takes from/to`);
    assert.ok(
      p.timezone ||
        d.name === "players_timeline" ||
        p.from.description.includes("YYYY-MM-DD"),
      `${d.name} takes a timezone`,
    );
  }
});

test("every limit has a declared maximum", () => {
  for (const d of declarations) {
    const limit = d.inputSchema.properties?.limit;
    if (!limit) continue;
    assert.equal(
      typeof limit.maximum,
      "number",
      `${d.name}.limit has a maximum`,
    );
    assert.equal(
      typeof limit.minimum,
      "number",
      `${d.name}.limit has a minimum`,
    );
  }
});

test("verbosity is the one size control, and always the same enum", () => {
  for (const d of declarations) {
    const p = d.inputSchema.properties ?? {};
    for (const retired of ["summary", "include_curve", "compact", "brief"])
      assert.ok(!(retired in p), `${d.name} uses verbosity, not ${retired}`);
    if (p.verbosity) {
      assert.deepEqual(p.verbosity.enum, ["full", "compact"], d.name);
      assert.equal(p.verbosity.default, "full", d.name);
    }
  }
});

test("every published schema declares verbosity: the two-size tools in their own words, the rest as accepted-and-ignored (6.2.0, feedback #74)", () => {
  // 6.0.0 accepted the argument server-side; the schemas still said
  // additionalProperties: false without it, so a validating client
  // refused the call before it was sent.
  const twoSize = declarations.filter((d) =>
    d.inputSchema.properties.verbosity.description.startsWith("compact:"),
  );
  const oneSize = declarations.filter(
    (d) =>
      !d.inputSchema.properties.verbosity.description.startsWith("compact:"),
  );
  assert.equal(twoSize.length + oneSize.length, declarations.length);
  assert.ok(twoSize.length >= 11, `two-size tools: ${twoSize.length}`);
  for (const name of [
    "battles_query",
    "cards_catalog",
    "rankings_players",
    "war_current",
    "clans_roster",
    "clans_participation",
    "elixir_timeline",
  ])
    assert.ok(
      twoSize.some((d) => d.name === name),
      `${name} keeps its own compact description`,
    );
  for (const d of oneSize)
    assert.match(
      d.inputSchema.properties.verbosity.description,
      /one size: compact is accepted and changes nothing/,
      d.name,
    );
  for (const d of declarations)
    assert.equal(d.inputSchema.additionalProperties, false, d.name);
});

test("segment tools take a nested segment, never a flat scope; the population is named (3.16.0)", () => {
  const SEGMENT_TOOLS = [
    "battles_meta_decks",
    "battles_meta_cards",
    "battles_trends",
    "cards_synergy",
    "cards_card",
    "badges_rarity",
    "badges_holders",
  ];
  // The list is the registry's, not a hand copy (cards_card required
  // segment for weeks while every list of "the six" left it out).
  assert.deepEqual(
    declarations
      .filter((d) => (d.inputSchema.required ?? []).includes("segment"))
      .map((d) => d.name)
      .sort(),
    [...SEGMENT_TOOLS].sort(),
  );
  for (const name of SEGMENT_TOOLS) {
    const p = byName.get(name).inputSchema.properties;
    assert.ok(p.segment, `${name} has segment`);
    // "mine" and "corpus" as strings, or the object naming one subject.
    const [strings, object] = p.segment.anyOf;
    assert.deepEqual(strings, { type: "string", enum: ["mine", "corpus"] });
    assert.equal(object.type, "object", name);
    assert.deepEqual(Object.keys(object.properties).sort(), [
      "clan_tag",
      "collection",
      "on_behalf_of",
      "player_tag",
    ]);
    assert.match(p.segment.description, /never a default/);
    for (const flat of ["player_tag", "clan_tag", "collection"])
      assert.ok(!(flat in p), `${name} has no flat ${flat}`);
  }
});

test("descriptions stay readable: at most 600 characters (ENGINEERING 'Tool conventions'), and none empty", () => {
  for (const d of declarations) {
    assert.ok(d.description.length > 40, `${d.name} is described`);
    // The convention says 600; the test allowed 1,000 and six drifted
    // over (review 2026-09-19, defect 12). The rest of a long
    // description belongs on the docs page the tool's pointer names.
    assert.ok(
      d.description.length <= 600,
      `${d.name} description is ${d.description.length} chars`,
    );
  }
  const total = declarations.reduce((n, d) => n + d.description.length, 0);
  assert.ok(
    total / declarations.length <= 600,
    `mean description ${total / declarations.length}`,
  );
});

test("every tool sits in a published group, and every group is used", () => {
  const used = new Set();
  for (const d of declarations) {
    const cls = TOOL_GROUPS[d.name];
    assert.ok(GROUP_ORDER.includes(cls.group), `${d.name}: ${cls.group}`);
    used.add(cls.group);
  }
  for (const g of GROUP_ORDER) assert.ok(used.has(g), `group ${g} has tools`);
});

test("annotations follow the rules: destructive when an action removes, open-world when a path is live", () => {
  for (const d of declarations) {
    const actions = d.inputSchema.properties?.action?.enum ?? [];
    const removes = actions.some((a) => /remove|set|delete|clear/.test(a));
    if (removes)
      assert.equal(d.annotations.destructiveHint, true, `${d.name} removes`);
    const live =
      "live" in (d.inputSchema.properties ?? {}) || d.name === "live_fetch";
    assert.equal(d.annotations.openWorldHint, live, `${d.name} open-world`);
  }
});

// Every tool source, the family subdirectories included (battles/,
// elixir/, rankings/, war/ were split out 2026-09-23 and went unscanned).
const sources = readdirSync(toolsDir, { recursive: true })
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => ({
    file: f,
    text: readFileSync(path.join(toolsDir, f), "utf8"),
  }));

test("prose rides notes[] and docs, never a bespoke *_note key", () => {
  for (const { file, text } of sources) {
    const bespoke = [
      ...text.matchAll(/^\s+([a-z_]*note[a-z_]*|card_legend|basis_note):/gm),
    ]
      .map((m) => m[1])
      .filter(
        (k) =>
          k !== "notes" && k !== "completeness_note" && k !== "curator_note",
      );
    assert.deepEqual(
      bespoke,
      [],
      `${file} has bespoke note keys: ${bespoke.join(", ")}`,
    );
    assert.doesNotMatch(
      text,
      /\bfilters_applied\b|\blimit_applied\b|\bwindow_from\b|\bwindow_days\b/,
      `${file} uses the applied block`,
    );
  }
});

test("no source names a retired tool, and every call-shaped mention is a real tool", () => {
  const known = new Set(declarations.map((d) => d.name));
  const retired =
    /\b(elixir_watch_\w+|elixir_add_\w+|elixir_remove_\w+|get_\w+_performance|query_battles|list_my_players|cr_api_live)\b/g;
  for (const { file, text } of sources) {
    const hits = [...text.matchAll(retired)].map((m) => m[1]);
    assert.deepEqual(
      hits,
      [],
      `${file} names a retired tool: ${hits.join(", ")}`,
    );
    // A hint that reads `players_profile({ ... })` must name a tool that exists.
    for (const m of text.matchAll(
      /\b((?:elixir|players|battles|clans|war|cards|badges|collections)_[a-z_]+|live_fetch|game_clock)\(\{/g,
    ))
      assert.ok(known.has(m[1]), `${file} mentions ${m[1]}({...}), not a tool`);
  }
});

test("4.0.0: no retired name survives in a declaration, a note, a docs pointer or the docs corpus", () => {
  // The names the major retired (CHANGELOG 4.0.0 `breaking`), each with
  // the shape it takes on the wire, so a description that still says
  // "days_seen" or a doc that still teaches `trophy_net` on the standings
  // fails here rather than in a consumer.
  const retired = [
    /\btrophy_net\b(?![\s\S]{0,80}(session|standout|rung))/, // sessions keep theirs
    /\bpol_league\b/,
    /\bdays_seen\b/,
    /\bnominal_period_elapsed\b/,
    /\bincomplete_days\b/,
    /\belixir_feedback\b/,
    /group_by:? ["']mode["']/,
    /\bbattleCount\b|\bthreeCrownWins\b|\bcollectionLevel\b/,
    /lifetime\.as_of\b/,
    /segment was omitted|omitted answers the corpus/,
  ];
  const declared = JSON.stringify(declarations);
  const docsDir = path.join(here, "../../../apps/site/src/docs");
  const docs = readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      file: `docs/${f}`,
      text: readFileSync(path.join(docsDir, f), "utf8"),
    }));
  for (const { file, text } of [
    { file: "tools/list", text: declared },
    ...sources,
    ...docs,
  ]) {
    // Docs may say what a name was ("trophy_net before"): a mention
    // inside a (4.0.0; ... before) aside or a "was" clause is history,
    // not a live name.
    const live = text.replace(
      /\([^()]*4\.0\.0[^()]*\)|\([^()]*\bbefore\)/g,
      "",
    );
    for (const re of retired)
      assert.doesNotMatch(
        live,
        re,
        `${file} still carries a retired name: ${re}`,
      );
  }
});

test("every tool publishes an outputSchema (6.14.0 said so; Gym #115 found nine without)", () => {
  const missing = makeRegistry()
    .declarations()
    .filter((d) => !d.outputSchema)
    .map((d) => d.name);
  assert.deepEqual(missing, []);
});

test("every output schema requires notes and docs (journey r3: two help-tool branches served neither)", () => {
  const missing = makeRegistry()
    .declarations()
    .filter(
      (d) =>
        !d.outputSchema?.required?.includes("notes") ||
        !d.outputSchema?.required?.includes("docs"),
    )
    .map((d) => d.name);
  assert.deepEqual(missing, []);
});

test("the brief names every segment tool, and every windowed tool accepts season (the stated conventions are schema)", async () => {
  const { handleMcpMessage } = await import("../src/protocol.mjs");
  const brief = (
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      {
        registry: makeRegistry(),
        kind: "person",
        spendQuota: async () => ({ allowed: true, count: 1, max: 100 }),
        invokeTool: async () => ({ body: { ok: true }, isError: false }),
      },
    )
  ).payload.result.instructions;
  for (const d of declarations)
    if ((d.inputSchema.required ?? []).includes("segment"))
      assert.ok(
        brief.includes(d.name) || /badges_/.test(d.name),
        `the brief's segment list names ${d.name}`,
      );
  for (const d of declarations)
    if ("from" in (d.inputSchema.properties ?? {}))
      assert.ok(
        "season" in d.inputSchema.properties,
        `${d.name} takes from/to, so it takes season`,
      );
});

test("9.x: the retired war day fields, the war clan_score alias and Pilot Score appear in no declaration, and in the docs only as history", () => {
  const retired =
    /\b(war_days_battled|war_days|attendance_by_war_day|scoring_decks|war_scoring_decks|training_decks|war_decks_by_day|war_battles_by_day|training_today|our_clan_score|pilot_score|clans_pilot_scores|battles_levels)\b/;
  assert.doesNotMatch(JSON.stringify(declarations), retired);
  const docsDir = path.join(here, "../../../apps/site/src/docs");
  for (const f of readdirSync(docsDir).filter((x) => x.endsWith(".md")))
    // By paragraph: a history sentence wraps across lines.
    for (const line of readFileSync(path.join(docsDir, f), "utf8").split(
      /\n\s*\n/,
    ))
      if (retired.test(line))
        assert.match(
          line,
          /\b(9\.0\.[01]|9\.1\.0|2\.0\.0|5\.0\.0|removed|retired|no longer|is gone|went)\b/i,
          `docs/${f} names a retired field outside history: ${line.trim().slice(0, 120)}`,
        );
});
