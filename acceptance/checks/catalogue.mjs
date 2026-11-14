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
 *                  (the Gym's I7: documented but not served), or is
 *                  declared vocabulary (an enum, a word or an `x_*`
 *                  family an argument describes); and, for a tool that
 *                  filters by `kinds`, every kind its responses carried
 *                  is documented. Never that every documented kind
 *                  appeared this run: that is the day's data.
 *
 *  A field that is optional by the day's data (a timeline item's
 *  `crossed_by` exists only when a followed player crossed a band in the
 *  window) passes notes and docs when a committed bite of the same tool
 *  carries it as a key: the product served it, on the record, so the
 *  docs name a field the tool can emit. Those fields are listed after
 *  the run ("docs provenance"), as shape baselines are: evidence from a
 *  capture, not from today.
 *
 *  Allowances (tokens a note or a doc uses as prose, or a field that is
 *  conditional by design) live in catalogue-allow.json with a reason
 *  each, so a reviewer sees every exception in one place. */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArgs } from "../../packages/tools/src/validate.mjs";
import { loadCatalogue } from "../catalogue.mjs";
import { calledAs } from "../replay.mjs";
import { compareShape } from "../shapes.mjs";
import { resolveArgs } from "../subjects.mjs";
import {
  answered,
  ok,
  deepKeys,
  deepValues,
  noteTokens,
  pricedRefusal,
  VOCABULARY,
} from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOW = JSON.parse(
  readFileSync(path.join(here, "../catalogue-allow.json"), "utf8"),
);
const allowFor = (tool) => Object.keys({ ...ALLOW["*"], ...ALLOW[tool] });

/** Ceiling from the week's p95: 1.5x plus the door's own overhead, never
 *  under 4 s (a fast tool's jitter is not a regression), never over
 *  15 s (three under the 18 s budget is the whole point). One or two
 *  calls are a sample, not a p95, so they get twice the margin. */
export function ceilingMs(p95, calls) {
  if (!Number.isInteger(p95)) return 15_000;
  const factor = Number.isInteger(calls) && calls < 3 ? 3 : 1.5;
  return Math.min(15_000, Math.max(4_000, Math.round(p95 * factor) + 500));
}

const IDENT = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g;

function docsTokens(markdown) {
  const out = new Set();
  for (const m of String(markdown ?? "").matchAll(IDENT)) out.add(m[1]);
  return out;
}

/** Every snake_case word an argument's description uses: the timeline's
 *  kinds are listed there rather than as an enum (an account_* kind is
 *  an open set), and a doc naming one names vocabulary. */
export function describedWords(schema, out = new Set()) {
  if (!schema || typeof schema !== "object") return out;
  if (typeof schema.description === "string")
    for (const m of schema.description.matchAll(
      /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g,
    ))
      out.add(m[0]);
  for (const k of ["properties", "items", "anyOf", "oneOf"]) {
    const v = schema[k];
    if (Array.isArray(v)) for (const x of v) describedWords(x, out);
    else if (v && typeof v === "object")
      for (const x of k === "properties" ? Object.values(v) : [v])
        describedWords(x, out);
  }
  return out;
}

/** The open families an argument's description declares: "or an
 *  account_* kind" gives the prefix `account_`. A doc naming
 *  `account_feedback_responded` names a member of a declared family,
 *  whether or not this run's account had one in its window. */
export function declaredFamilies(schema, out = new Set()) {
  if (!schema || typeof schema !== "object") return out;
  if (typeof schema.description === "string")
    for (const m of schema.description.matchAll(
      /(?<![a-z0-9_])([a-z][a-z0-9]*(?:_[a-z0-9]+)*)_\*/g,
    ))
      out.add(`${m[1]}_`);
  for (const k of ["properties", "items", "anyOf", "oneOf"]) {
    const v = schema[k];
    if (Array.isArray(v)) for (const x of v) declaredFamilies(x, out);
    else if (v && typeof v === "object")
      for (const x of k === "properties" ? Object.values(v) : [v])
        declaredFamilies(x, out);
  }
  return out;
}

const inFamily = (families, t) =>
  [...families].some((p) => t.length > p.length && t.startsWith(p));

/** The kinds a response's items carry: an item names its `kind` and the
 *  shape its facts follow, `schema` as `<kind>/<version>`. */
export function carriedKinds(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) carriedKinds(v, out);
  else if (value && typeof value === "object") {
    if (
      typeof value.kind === "string" &&
      typeof value.schema === "string" &&
      value.schema.startsWith(`${value.kind}/`)
    )
      out.add(value.kind);
    for (const v of Object.values(value)) carriedKinds(v, out);
  }
  return out;
}

/** Every name a docs page sets in backticks, single words included
 *  (`returned`), and the families it names with a trailing `_*`. */
export function docsNames(markdown) {
  const names = new Set();
  const families = new Set();
  for (const m of String(markdown ?? "").matchAll(
    /`([a-z][a-z0-9_]*?)(_\*)?`/g,
  )) {
    if (m[2]) families.add(`${m[1]}_`);
    else names.add(m[1]);
  }
  return { names, families };
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

/** Every tool the product publishes, not only the ones this connection
 *  is offered (an agent sees 44 of 55): a doc naming elixir_follow_player
 *  names a tool. Fetched once from the public tools.json. */
async function allToolNames(ctx) {
  if (ctx.allTools) return ctx.allTools;
  const names = new Set(ctx.tools.keys());
  try {
    const res = await fetch("https://elixir.poapkings.com/tools.json");
    const j = await res.json();
    for (const g of j.groups ?? [])
      for (const t of g.tools ?? [])
        names.add(typeof t === "string" ? t : t.name);
  } catch {
    // offline: the connection's list is what there is
  }
  ctx.allTools = names;
  return names;
}

/** Keys and values on every response the run has made so far. */
function seenSoFar(ctx) {
  const keys = new Set();
  const values = new Set();
  for (const r of ctx.cache.values()) {
    if (!r?.body || r.isError) continue;
    deepKeys(r.body, keys);
    deepValues(r.body, values);
    // A table's column names (#124) are values of what the door sent.
    if (r.raw) deepValues(r.raw, values);
  }
  return { keys, values };
}

/** The keys every committed bite of a tool carries (`acceptance/bites`,
 *  each a captured answer of the deployed product): tool, under the name
 *  it is called by now (replay.mjs), -> key -> the first capture holding
 *  it. Keys only, never values (a value in a capture is a day's data),
 *  and never from a refusal. Read once per process. */
let biteIndex = null;
export function biteKeys(dir = path.join(here, "../bites")) {
  if (biteIndex && dir === biteIndex.dir) return biteIndex.keys;
  const keys = new Map();
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "manifest.json")
      .sort();
  } catch {
    // no bites directory: nothing on the record
  }
  for (const f of files) {
    const c = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    if (!c?.request?.tool || !c.response) continue;
    if (c.response.error && !c.response.notes) continue;
    const tool = calledAs(c);
    if (!keys.has(tool)) keys.set(tool, new Map());
    const held = keys.get(tool);
    for (const k of deepKeys(c.response)) if (!held.has(k)) held.set(k, f);
  }
  biteIndex = { dir, keys };
  return keys;
}

/** Splits the tokens nothing this run accounted for into those a bite
 *  of the tool carries (recorded on ctx.docsProvenance, printed after
 *  the run) and those served nowhere (the finding). */
function heldByBite(ctx, tool, tokens, where) {
  const held = (ctx.biteKeys ?? biteKeys()).get(tool) ?? new Map();
  const missing = [];
  for (const t of tokens) {
    const file = held.get(t);
    if (!file) {
      missing.push(t);
      continue;
    }
    if (!ctx.docsProvenance) ctx.docsProvenance = new Map();
    ctx.docsProvenance.set(`${tool}#${where} ${t}`, file);
  }
  return missing;
}

export function buildCatalogueCases(catalogue = loadCatalogue()) {
  const cases = [];
  const bodies = new Map(); // tool -> [{ args, body }]
  for (const [tool, entry] of Object.entries(catalogue.tools)) {
    entry.sets.forEach((set, i) => {
      cases.push({
        id: `${tool}#${i}`,
        run: async (ctx) => {
          // A placeholder (`$CLANMATE_1`, subjects.mjs) is a recorded
          // player the repo may not name: resolved from the roster this
          // run, or the case skips with the reason. Messages keep the
          // placeholder, never the tag it stood for.
          const resolved = await resolveArgs(ctx, set.args);
          if (resolved.skip) return { skip: resolved.skip };
          const args = resolved.args;
          const r = await ctx.read(tool, args);
          const body = answered(r, `${tool} ${JSON.stringify(set.args)}`);
          if (!bodies.has(tool)) bodies.set(tool, []);
          bodies.get(tool).push({ args: set.args, body, raw: r.raw });
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
          // A seeded set was not called this week: the tool's p95 is
          // another set's, often a far lighter one (2026-10-10:
          // cards_card's clan segment against a player's 171 ms).
          const ceiling = set.seed
            ? ceilingMs(null)
            : ceilingMs(entry.p95_ms, entry.calls);
          ok(
            r.ms <= ceiling,
            `${r.ms} ms over the ceiling ${ceiling} (p95 this week ${entry.p95_ms})`,
          );
          const desc =
            ctx.tools.get(tool)?.inputSchema?.properties?.verbosity
              ?.description ?? "";
          if (desc.startsWith("compact:")) {
            // Both sizes are read: the compact one is a subset and not
            // larger, and the full one's keys are what the compact one's
            // notes may name.
            const compactArgs = { ...args, verbosity: "compact" };
            const fullArgs = { ...args, verbosity: "full" };
            const c = await ctx.read(tool, compactArgs);
            const f = await ctx.read(tool, fullArgs);
            const cb = answered(c, `${tool} compact`);
            // The full twin of a compact call the caller made compact may
            // be a page nobody asked for: a refusal that prices the retry
            // is the documented answer, and there is nothing to compare.
            if (pricedRefusal(f)) return { ms: r.ms };
            const fb = answered(f, `${tool} full`);
            bodies.get(tool).push({
              args: { ...set.args, verbosity: "full" },
              body: fb,
              raw: f.raw,
            });
            // An empty answer is the same both ways but for the echo. A
            // page cut by size is the exception: compact drops what full
            // spends its budget on, so the same budget holds MORE of the
            // window compact (elixir_timeline, 6.34.2), and the two are not
            // the same window to compare.
            const sizeCut = cb?.has_more === true || fb?.has_more === true;
            ok(
              sizeCut ||
                JSON.stringify(cb).length <= JSON.stringify(fb).length + 64,
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
        const values = new Set();
        for (const { body, raw } of seen) {
          deepKeys(body, union);
          deepValues(body, values);
          // What the door sent: a table names its fields in its columns
          // (clans_participation, #124), which the decoded rows lack.
          if (raw) deepValues(raw, values);
        }
        const args = new Set(
          Object.keys(ctx.tools.get(tool)?.inputSchema?.properties ?? {}),
        );
        const enums = enumValues(ctx.tools.get(tool)?.inputSchema);
        enumValues(ctx.tools.get(tool)?.outputSchema, enums);
        describedWords(ctx.tools.get(tool)?.inputSchema, enums);
        const allow = new Set(allowFor(tool));
        const toolNames = await allToolNames(ctx);
        for (const { args: a, body } of seen) {
          const missing = heldByBite(
            ctx,
            tool,
            [...noteTokens(body.notes, { tools: toolNames })].filter(
              (t) =>
                !union.has(t) &&
                !values.has(t) &&
                !args.has(t) &&
                !enums.has(t) &&
                !toolNames.has(t) &&
                !VOCABULARY.has(t) &&
                !allow.has(t),
            ),
            "notes",
          );
          ok(
            missing.length === 0,
            `${tool} ${JSON.stringify(a)}: notes name ${missing.join(", ")} and no response of ${tool} this run, nor any bite of it, carried it`,
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
        for (const t of ctx.tools.values()) {
          enumValues(t.inputSchema, allEnums);
          enumValues(t.outputSchema, allEnums);
          describedWords(t.inputSchema, allEnums);
        }
        const allArgs = new Set();
        for (const t of ctx.tools.values())
          for (const k of Object.keys(t.inputSchema?.properties ?? {}))
            allArgs.add(k);
        const allow = new Set([
          ...allowFor(tool),
          ...Object.keys(ALLOW.docs ?? {}),
        ]);
        const toolNames = await allToolNames(ctx);
        const families = declaredFamilies(ctx.tools.get(tool)?.inputSchema);
        const { keys: everyKey, values: everyValue } = seenSoFar(ctx);
        // Data of the day: an optional field no window this run held
        // still counts when a bite of this tool carried it.
        const missing = heldByBite(
          ctx,
          tool,
          [...docsTokens(doc.markdown)].filter(
            (t) =>
              !everyKey.has(t) &&
              !everyValue.has(t) &&
              !allArgs.has(t) &&
              !allEnums.has(t) &&
              !inFamily(families, t) &&
              !toolNames.has(t) &&
              !VOCABULARY.has(t) &&
              !allow.has(t),
          ),
          "docs",
        );
        ok(
          missing.length === 0,
          `${pointer} documents ${missing.join(", ")} and no response this run, nor any bite of ${tool}, carried it`,
        );
        // The other direction, for a tool that filters by kind: every
        // kind a response carried is one its docs name, by itself or by
        // a family (`account_*`). Never that every documented kind
        // appeared: which kinds a window holds is the day's data.
        if (ctx.tools.get(tool)?.inputSchema?.properties?.kinds) {
          const docs = docsNames(doc.markdown);
          const carried = new Set();
          for (const { body } of bodies.get(tool) ?? [])
            carriedKinds(body, carried);
          const undocumented = [...carried].filter(
            (k) => !docs.names.has(k) && !inFamily(docs.families, k),
          );
          ok(
            undocumented.length === 0,
            `${tool} carried kind ${undocumented.join(", ")} and ${pointer} does not document it`,
          );
        }
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
