/** catalogue: the generic rules over what agents actually call
 *  (catalogue.json, refreshed from the audit by catalogue.mjs). One case
 *  per (tool, argument set):
 *
 *   answers      - the call answers (it answered for the agent who made it)
 *   notes        - every field its notes name is on the response
 *   schema       - the published outputSchema, when the tool has one
 *   shape        - else the recorded baseline (shapes/), one-directional
 *   budget       - under a ceiling from the tool's own p95 this week
 *   compact      - a two-size tool's compact answer is a subset, smaller
 *
 *  and one per tool:
 *
 *   docs         - every field the response's docs section names, in
 *                  backticks, is on some response of the tool this run
 *                  (the Gym's I7: documented but not served)
 *
 *  Allowances (tokens a note or a doc uses as prose, or a field that is
 *  conditional by design) live in catalogue-allow.json with a reason
 *  each, so a reviewer sees every exception in one place. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArgs } from "../../services/mcp/src/validate.mjs";
import { loadCatalogue } from "../catalogue.mjs";
import { compareShape } from "../shapes.mjs";
import { answered, ok, deepKeys, noteTokens, VOCABULARY } from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOW = JSON.parse(
  readFileSync(path.join(here, "../catalogue-allow.json"), "utf8"),
);
const allowFor = (tool) => Object.keys({ ...ALLOW["*"], ...ALLOW[tool] });

/** Ceiling from the week's p95: 1.5x plus the door's own overhead, never
 *  under 2 s (a fast tool's jitter is not a regression), never over
 *  15 s (three under the 18 s budget is the whole point). */
export function ceilingMs(p95) {
  if (!Number.isInteger(p95)) return 15_000;
  return Math.min(15_000, Math.max(2_000, Math.round(p95 * 1.5) + 500));
}

const IDENT = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;

function docsTokens(markdown) {
  const out = new Set();
  for (const m of String(markdown ?? "").matchAll(IDENT)) out.add(m[1]);
  return out;
}

/** Every enum value any argument of a tool declares (metrics names,
 *  kinds, boards): a note or a doc naming one is naming vocabulary. */
export function enumValues(schema, out = new Set()) {
  if (!schema || typeof schema !== "object") return out;
  if (Array.isArray(schema.enum))
    for (const v of schema.enum) if (typeof v === "string") out.add(v);
  for (const k of ["properties", "items", "anyOf", "oneOf"]) {
    const v = schema[k];
    if (Array.isArray(v)) for (const x of v) enumValues(x, out);
    else if (v && typeof v === "object")
      for (const x of k === "properties" ? Object.values(v) : [v])
        enumValues(x, out);
  }
  return out;
}

export function buildCatalogueCases(catalogue = loadCatalogue()) {
  const cases = [];
  const bodies = new Map(); // tool -> [{ args, body }]
  const everyKey = new Set(); // keys on any response this run
  for (const [tool, entry] of Object.entries(catalogue.tools)) {
    entry.sets.forEach((set, i) => {
      cases.push({
        id: `${tool}#${i}`,
        run: async (ctx) => {
          const r = await ctx.read(tool, set.args);
          const body = answered(r, `${tool} ${JSON.stringify(set.args)}`);
          if (!bodies.has(tool)) bodies.set(tool, []);
          bodies.get(tool).push({ args: set.args, body });
          for (const k of deepKeys(body)) everyKey.add(k);
          const schema = ctx.tools.get(tool)?.outputSchema;
          if (schema) {
            const mismatch = validateArgs(schema, body, `${tool} result`);
            ok(!mismatch, `outputSchema: ${mismatch}`);
          } else {
            const shape = compareShape(tool, set.args, body);
            ok(
              shape.missing.length === 0,
              `recorded shape: ${shape.missing.join(", ")} missing (baseline shapes/${tool}.json)`,
            );
          }
          const ceiling = ceilingMs(entry.p95_ms);
          ok(
            r.ms <= ceiling,
            `${r.ms} ms over the ceiling ${ceiling} (p95 this week ${entry.p95_ms})`,
          );
          const desc =
            ctx.tools.get(tool)?.inputSchema?.properties?.verbosity
              ?.description ?? "";
          if (desc.startsWith("compact:") && set.args.verbosity !== "compact") {
            const c = await ctx.read(tool, {
              ...set.args,
              verbosity: "compact",
            });
            const cb = answered(c, `${tool} compact`);
            ok(
              JSON.stringify(cb).length <= JSON.stringify(body).length,
              "compact is not larger than full",
            );
            ok(
              !cb.notes?.some((n) => /has one size/.test(n)),
              "a two-size tool does not claim one size",
            );
          }
          return { ms: r.ms };
        },
      });
    });
    // Phase 2, once per tool: the notes of every set against the keys any
    // of its sets carried (a compact answer's notes describe the full
    // one; a row field is absent from an empty list), then the docs
    // section against the keys any tool carried this run - documented
    // somewhere and served nowhere is the finding (the Gym's I7).
    cases.push({
      id: `${tool}#notes`,
      phase: 2,
      run: async (ctx) => {
        const seen = bodies.get(tool) ?? [];
        if (seen.length === 0) return;
        const union = new Set();
        for (const { body } of seen)
          for (const k of deepKeys(body)) union.add(k);
        const args = new Set(
          Object.keys(ctx.tools.get(tool)?.inputSchema?.properties ?? {}),
        );
        const enums = enumValues(ctx.tools.get(tool)?.inputSchema);
        const allow = new Set(allowFor(tool));
        const toolNames = new Set(ctx.tools.keys());
        for (const { args: a, body } of seen) {
          const missing = [
            ...noteTokens(body.notes, { tools: toolNames }),
          ].filter(
            (t) =>
              !union.has(t) &&
              !args.has(t) &&
              !enums.has(t) &&
              !toolNames.has(t) &&
              !VOCABULARY.has(t) &&
              !allow.has(t),
          );
          ok(
            missing.length === 0,
            `${tool} ${JSON.stringify(a)}: notes name ${missing.join(", ")} and no response of ${tool} this run carried it`,
          );
        }
      },
    });
    cases.push({
      id: `${tool}#docs`,
      phase: 2,
      run: async (ctx) => {
        const pointer = (bodies.get(tool) ?? []).find(
          (s) => typeof s.body.docs === "string",
        )?.body.docs;
        if (!pointer) return; // no docs on the response: nothing promised
        const [page, section] = pointer.split("#");
        const d = await ctx.read(
          "elixir_docs",
          section ? { page, section } : { page },
        );
        const doc = answered(d, `elixir_docs ${pointer}`);
        const allEnums = new Set();
        for (const t of ctx.tools.values()) enumValues(t.inputSchema, allEnums);
        const allArgs = new Set();
        for (const t of ctx.tools.values())
          for (const k of Object.keys(t.inputSchema?.properties ?? {}))
            allArgs.add(k);
        const allow = new Set([
          ...allowFor(tool),
          ...Object.keys(ALLOW.docs ?? {}),
        ]);
        const missing = [...docsTokens(doc.markdown)].filter(
          (t) =>
            !everyKey.has(t) &&
            !allArgs.has(t) &&
            !allEnums.has(t) &&
            !ctx.tools.has(t) &&
            !VOCABULARY.has(t) &&
            !allow.has(t),
        );
        ok(
          missing.length === 0,
          `${pointer} documents ${missing.join(", ")} and no response this run carried it`,
        );
      },
    });
  }
  return cases;
}

function loadOrEmpty() {
  try {
    return loadCatalogue();
  } catch {
    // Before the first `catalogue.mjs --refresh` there is nothing to run.
    return { tools: {} };
  }
}

export const catalogue = buildCatalogueCases(loadOrEmpty());
