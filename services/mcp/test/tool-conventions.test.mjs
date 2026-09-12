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
  // it. The two Pilot Score tools are the deliberate exception: their curve
  // is fit over a trailing window ending now, so they take days only.
  // clans_participation is the third: its unit is the ISO week, aligned to
  // Monday, so an arbitrary from/to would only fall between weeks.
  const exempt = new Set([
    "battles_levels",
    "clans_pilot_scores",
    "clans_participation",
  ]);
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

test("segment tools take a nested segment, never a flat scope", () => {
  for (const name of [
    "battles_meta_decks",
    "battles_meta_cards",
    "battles_trends",
    "cards_synergy",
    "badges_rarity",
    "badges_holders",
  ]) {
    const p = byName.get(name).inputSchema.properties;
    assert.ok(p.segment, `${name} has segment`);
    assert.equal(p.segment.type, "object", name);
    for (const flat of ["player_tag", "clan_tag", "collection"])
      assert.ok(!(flat in p), `${name} has no flat ${flat}`);
  }
});

test("descriptions stay readable: at most 1,000 characters, and none empty", () => {
  for (const d of declarations) {
    assert.ok(d.description.length > 40, `${d.name} is described`);
    assert.ok(
      d.description.length <= 1000,
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

const sources = readdirSync(toolsDir)
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
