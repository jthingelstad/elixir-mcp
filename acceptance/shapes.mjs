/**
 * Shape baselines, the stopgap for tools with no published outputSchema
 * (README: "derive expectations; record them only as a stopgap"). A
 * baseline is the set of key PATHS a response carried, keyed by the
 * catalogue argument set, with provenance "recorded" and the reason it
 * was last updated. The rule is one-directional: a path in the baseline
 * must be on the response now (when its parent is present and
 * non-empty); a new path is information, never a failure; an absence
 * can never be baselined, because an absent path is not in the set.
 * `--update-shapes --reason "..."` rewrites; the diff is reviewed like a
 * contract change. The count of tools resting on a recorded baseline is
 * printed by every run: it is a to-do list (write the schema), not
 * coverage.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "./replay.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, "shapes");

/** Every key path of a value: `weeks[].finished_early`, `meta.as_of`.
 *  Arrays contribute their elements' keys under `[]`. */
export function shapePaths(value, prefix = "", out = new Set()) {
  if (Array.isArray(value)) {
    for (const v of value) shapePaths(v, `${prefix}[]`, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.add(p);
      shapePaths(v, p, out);
    }
  }
  return out;
}

/** The paths present in a response whose parents are absent or empty
 *  are unknowable there; a baseline path is only owed when the parent
 *  container exists with content. */
function parentPresent(pathStr, present) {
  const parent = pathStr.replace(/\.[^.]+$/, "").replace(/\[\]$/, "");
  if (parent === pathStr || parent === "") return true;
  // A `[]` parent is present when some element path exists.
  return [...present].some(
    (p) =>
      p === parent || p.startsWith(`${parent}.`) || p.startsWith(`${parent}[]`),
  );
}

export function loadShape(tool) {
  const file = path.join(DIR, `${tool}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** Compare a response with the baseline for its argument set: the paths
 *  owed and missing (a failure), and the paths new (information). */
export function compareShape(tool, args, body) {
  const baseline = loadShape(tool);
  const key = canonical(args);
  const owed = baseline?.sets?.[key];
  if (!owed) return { baselined: false, missing: [], added: [] };
  const present = shapePaths(body);
  const missing = owed.filter(
    (p) => !present.has(p) && parentPresent(p, present),
  );
  const added = [...present].filter(
    (p) => !owed.includes(p) && !p.startsWith("meta."),
  );
  return { baselined: true, missing, added };
}

/** Record this run's shapes for a tool's argument sets. */
export function writeShape(tool, sets, { reason, contract }) {
  mkdirSync(DIR, { recursive: true });
  const prior = loadShape(tool);
  const out = {
    tool,
    provenance: "recorded",
    reason,
    contract_version: contract,
    updated_at: new Date().toISOString(),
    sets: {},
  };
  for (const { args, body } of sets)
    out.sets[canonical(args)] = [...shapePaths(body)]
      .filter((p) => !p.startsWith("meta."))
      .sort();
  writeFileSync(
    path.join(DIR, `${tool}.json`),
    JSON.stringify(out, null, 2) + "\n",
  );
  return {
    tool,
    sets: Object.keys(out.sets).length,
    was: prior ? "updated" : "new",
  };
}
