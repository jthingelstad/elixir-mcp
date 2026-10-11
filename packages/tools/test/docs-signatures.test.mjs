/**
 * The public docs against the served schemas (11.10.0, feedback #377).
 *
 * The docs name tool calls in prose as `tool({ a, b?, c: 1 })`. The tool
 * reference (/docs/tools) is generated from the registry and cannot drift;
 * these sentences can, and did: protocol.md listed `on_behalf_of?` on
 * elixir_send_feedback, an argument a personal connection is never served
 * (AGENT_ARGS in tools.mjs), so an agent on one read the docs, tried it,
 * and met additionalProperties: false.
 *
 * Two rules, checked against the schema each kind of connection is
 * actually served (`declarations(kind)`), not the whole catalogue:
 *
 *   1. Every argument a signature names exists for every kind that can
 *      call the tool. An agent-only argument is described in prose
 *      ("Agent connections only: ..."), never put in a signature.
 *   2. A full signature (one marking optional arguments with `?`) names
 *      every argument a personal connection is served, so a new argument
 *      cannot ship with the docs' list of them left short.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRegistry } from "../src/tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, "../../../apps/site/src/docs");
const KINDS = ["person", "agent", "integration"];

const registry = makeRegistry();
const served = new Map(
  KINDS.map((kind) => [
    kind,
    new Map(
      registry
        .declarations(kind)
        .map((d) => [d.name, new Set(Object.keys(d.inputSchema.properties))]),
    ),
  ]),
);
const toolNames = new Set(registry.declarations().map((d) => d.name));

/** The top-level argument names of `{ a, b?, c: { d }, e: "x" }`. */
function argumentNames(inner) {
  const parts = [];
  let depth = 0;
  let current = "";
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^([a-z][a-z0-9_]*)(\?)?\s*(?::|$)/.exec(p);
      return m ? { name: m[1], optional: Boolean(m[2]) } : null;
    })
    .filter(Boolean);
}

/** Every `tool({ ... })` the docs write, with where it was written. */
function signatures() {
  const out = [];
  for (const file of readdirSync(DOCS).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(path.join(DOCS, file), "utf8");
    // A signature is inline code: `name({ ... })`, braces balanced by the
    // argument parser; it may wrap across lines in a list item.
    const re = /`([a-z]+_[a-z_]+)\(\{([^`]*)\}\)`/g;
    for (const m of text.matchAll(re)) {
      if (!toolNames.has(m[1])) continue;
      const line = text.slice(0, m.index).split("\n").length;
      out.push({
        where: `${file}:${line}`,
        tool: m[1],
        args: argumentNames(m[2].replace(/\s+/g, " ")),
      });
    }
  }
  return out;
}

test("the argument parser reads names, optional marks and nested values", () => {
  assert.deepEqual(
    argumentNames(' a, b?, c: { d, e }, f: "x, y", g: [1, 2] '),
    [
      { name: "a", optional: false },
      { name: "b", optional: true },
      { name: "c", optional: false },
      { name: "f", optional: false },
      { name: "g", optional: false },
    ],
  );
});

test("the docs write tool signatures, and this test reads them", () => {
  const all = signatures();
  assert.ok(all.length >= 30, `found ${all.length} signatures`);
  assert.ok(all.some((s) => s.tool === "elixir_send_feedback"));
});

test("every argument a docs signature names is served to every kind that can call the tool (#377)", () => {
  const wrong = [];
  for (const sig of signatures())
    for (const kind of KINDS) {
      const props = served.get(kind).get(sig.tool);
      if (!props) continue; // hidden from this kind
      for (const { name } of sig.args)
        if (!props.has(name))
          wrong.push(
            `${sig.where}: ${sig.tool} names '${name}', which a ${kind} connection is not served`,
          );
    }
  assert.deepEqual(
    wrong,
    [],
    "Name an agent-only argument in prose ('Agent connections only: ...'), never in a signature; fix a misspelt one.",
  );
});

test("a full signature (with ? marks) names every argument a personal connection is served", () => {
  const short = [];
  for (const sig of signatures()) {
    if (!sig.args.some((a) => a.optional)) continue;
    const props =
      served.get("person").get(sig.tool) ?? served.get("agent").get(sig.tool);
    const named = new Set(sig.args.map((a) => a.name));
    // A one-size tool's verbosity is the registry's, said once in the
    // protocol docs, not each tool's.
    const oneSize = !registry.accepts(sig.tool, "verbosity");
    const missing = [...props].filter(
      (p) => !named.has(p) && !(oneSize && p === "verbosity"),
    );
    if (missing.length)
      short.push(`${sig.where}: ${sig.tool} omits ${missing.join(", ")}`);
  }
  assert.deepEqual(short, []);
});
