/**
 * The Gym's block, run as written. Every finding the Elixir Gym files
 * ends with a JSON block (its prompt, 2026-09-21): a tool, arguments,
 * the request id of the answer it read, and assertions in a small
 * vocabulary. gym.json holds those blocks verbatim (an id fixed, an
 * open question answered) and this turns each into a case, so the
 * Gym's words are the test and nothing is hand-translated.
 *
 * Paths: dotted, with `[N]` (an index), `[]` (every element: `has`,
 * `count_eq`, `sum_eq` read the list), `[?key=value]` (the first
 * element where key equals value). With `calls`, the first segment is
 * an alias (`r.rivals[...]`, `w.standings[...]`).
 *
 * Verbs: has, absent, eq, neq, lt, lte, gt, gte, count_eq, sum_eq (paths
 * and literals), sorted_desc, sorted_asc, notes_match, notes_not_match,
 * every_row_has. An `eq` right-hand side that is a
 * string with a dot or a bracket is read as a path (82.4 compares two
 * calls). `notes_match` reads notes[] and, on a refusal, error.message
 * and error.hint - the Gym asserts on refusals too.
 *
 * Modifiers: `when` (a verb over the body or the row: false skips the
 * case, said aloud); `for_each` (the asserts run per row of a list);
 * `stability` frozen (closed data: exact values are fair) or live
 * (invariants); `control` (a negative control, run the same);
 * `needs_fixture` and `open_question` (not runnable live: SKIP with the
 * text, and a note that the fixture tests carry the former).
 */

import { answered, ok, fail } from "./lib.mjs";

const SEG = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[[^\]]*\])*)$/;

/** Resolve a path on a value; `[]` fans out to an array of values. */
export function resolve(value, path) {
  let current = [value];
  let fanned = false;
  for (const seg of path.split(".")) {
    const m = SEG.exec(seg);
    if (!m) throw new Error(`bad path segment ${seg}`);
    const [, name, brackets] = m;
    current = current.map((v) => (v == null ? undefined : v[name]));
    for (const b of brackets.match(/\[[^\]]*\]/g) ?? []) {
      const inner = b.slice(1, -1);
      if (inner === "") {
        fanned = true;
        current = current.flatMap((v) => (Array.isArray(v) ? v : []));
      } else if (/^\d+$/.test(inner)) {
        current = current.map((v) =>
          Array.isArray(v) ? v[Number(inner)] : undefined,
        );
      } else if (inner.startsWith("?")) {
        const [k, raw] = inner.slice(1).split("=");
        const want =
          raw === "null"
            ? null
            : /^-?\d+(\.\d+)?$/.test(raw)
              ? Number(raw)
              : raw;
        current = current.map((v) =>
          Array.isArray(v) ? v.find((x) => x?.[k] === want) : undefined,
        );
      } else throw new Error(`bad bracket ${b}`);
    }
  }
  return fanned ? current : current[0];
}

/** A right-hand side is a path when it parses as one: segments of an
 *  identifier and brackets, joined by dots ("2026-08-30T09:34:04.000Z"
 *  is a value). */
const isPath = (v) =>
  typeof v === "string" &&
  /[.[]/.test(v) &&
  v.split(".").every((seg) => SEG.test(seg));
const show = (v) => JSON.stringify(v);

/** The text a notes verb searches: the notes, and a refusal's words. */
function noteText(body) {
  const parts = [...(body?.notes ?? [])];
  if (body?.error) parts.push(body.error.message ?? "", body.error.hint ?? "");
  return parts.join("\n");
}

/** One assertion against a scope (the body, a row, or the alias map). */
export function assertOne(spec, scope, root) {
  const [verb, arg] = Object.entries(spec)[0];
  const at = (p) => resolve(scope, p);
  const rhs = (v) => (isPath(v) ? resolve(root, v) : v);
  switch (verb) {
    case "has": {
      const v = at(arg);
      if (Array.isArray(v))
        ok(
          v.length > 0 && v.every((x) => x !== undefined),
          `has ${arg}: ${v.filter((x) => x === undefined).length} of ${v.length} lack it`,
        );
      else ok(v !== undefined, `has ${arg}: absent`);
      return;
    }
    case "absent": {
      ok(at(arg) === undefined, `absent ${arg}: present`);
      return;
    }
    case "eq": {
      const [p, want] = arg;
      const v = at(p);
      const w = rhs(want);
      ok(v !== undefined, `eq ${p}: absent`);
      ok(v === w, `eq ${p}: ${show(v)} !== ${show(w)}`);
      return;
    }
    case "lt":
    case "gt":
    case "gte": {
      const [a, b] = arg;
      const va = typeof a === "number" ? a : at(a);
      const vb = typeof b === "number" ? b : at(b);
      ok(va !== undefined && vb !== undefined, `${verb}: ${a} or ${b} absent`);
      if (va === null || vb === null) return;
      const holdsV =
        verb === "lt" ? va < vb : verb === "gt" ? va > vb : va >= vb;
      ok(holdsV, `${verb}: ${a} ${show(va)} vs ${b} ${show(vb)}`);
      return;
    }
    case "neq": {
      const [p, want] = arg;
      const v = at(p);
      ok(v !== undefined && v !== rhs(want), `neq ${p}: is ${show(v)}`);
      return;
    }
    case "lte": {
      const [a, b] = arg;
      const va = typeof a === "number" ? a : at(a);
      const vb = typeof b === "number" ? b : at(b);
      ok(va !== undefined && vb !== undefined, `lte: ${a} or ${b} absent`);
      if (va === null || vb === null) return;
      ok(va <= vb, `lte: ${a} ${show(va)} > ${b} ${show(vb)}`);
      return;
    }
    case "count_eq": {
      const [p, n] = arg;
      const v = at(p);
      const count = Array.isArray(v)
        ? v.length
        : v === undefined
          ? undefined
          : 1;
      ok(count === n, `count_eq ${p}: ${count} !== ${n}`);
      return;
    }
    case "sum_eq": {
      const [parts, total] = arg;
      const vals = parts.flatMap((p) => {
        if (typeof p === "number") return [p];
        const v = at(p);
        return Array.isArray(v) ? v : [v];
      });
      ok(
        vals.every((v) => v !== undefined),
        `sum_eq: a part is absent (${parts.join(", ")})`,
      );
      if (vals.some((v) => v === null)) return;
      const sum = vals.reduce((x, y) => x + y, 0);
      const want = at(total);
      ok(want !== undefined, `sum_eq: ${total} absent`);
      if (want === null) return;
      ok(
        sum === want,
        `sum_eq: ${parts.join(" + ")} = ${sum}, ${total} = ${want}`,
      );
      return;
    }
    case "sorted_desc":
    case "sorted_asc": {
      // Each listed path keeps its own order: two halves of a
      // split-after-sort (decks[], unfieldable[]) are each sorted and
      // are not one sequence when concatenated.
      const desc = verb === "sorted_desc";
      for (const p of Array.isArray(arg[0]) ? arg[0] : arg) {
        const v = at(p);
        if (!Array.isArray(v)) fail(`${verb} ${p}: not a list`);
        for (let i = 1; i < v.length; i += 1) {
          if (v[i] == null || v[i - 1] == null) continue;
          if (desc ? v[i] > v[i - 1] : v[i] < v[i - 1])
            fail(`${verb} ${p}: breaks at ${i}`);
        }
      }
      return;
    }
    case "notes_match": {
      ok(
        new RegExp(arg, "i").test(noteText(scope.notes ? scope : root)),
        `notes_match /${arg}/: no note says it`,
      );
      return;
    }
    case "notes_not_match": {
      ok(
        !new RegExp(arg, "i").test(noteText(scope.notes ? scope : root)),
        `notes_not_match /${arg}/: a note says it`,
      );
      return;
    }
    case "every_row_has": {
      const [list, key] = arg;
      const rows = at(list);
      ok(
        Array.isArray(rows) && rows.length > 0,
        `every_row_has ${list}: no rows`,
      );
      const lacking = rows.filter((r) => !(key in r)).length;
      ok(
        lacking === 0,
        `every_row_has ${list}.${key}: ${lacking} of ${rows.length} lack it`,
      );
      return;
    }
    default:
      fail(
        `unknown verb ${verb} (add it to gym-interp.mjs, not to the filing)`,
      );
  }
}

function holds(spec, scope, root) {
  try {
    assertOne(spec, scope, root);
    return true;
  } catch {
    return false;
  }
}

/** The Gym's blocks as cases. Rejected at load: a duplicate id, and a
 *  finding (ids `<feedback>.<n>`) with no `control: true` case - a
 *  positive-only assert is satisfied by hardcoding the flag. */
export function gymCases(blocks) {
  const ids = new Set();
  const findings = new Map(); // feedback id -> has a control
  for (const b of blocks) {
    ok(
      typeof b.id === "string" && b.id.length > 0,
      "gym.json: a case without an id",
    );
    ok(!ids.has(b.id), `gym.json: duplicate id ${b.id}`);
    ids.add(b.id);
    const m = /^(\d+)\./.exec(b.id);
    if (m)
      findings.set(m[1], (findings.get(m[1]) ?? false) || b.control === true);
  }
  for (const [fid, hasControl] of findings)
    ok(hasControl, `gym.json: finding ${fid} has no control: true case`);
  return blocks.map((b) => {
    return {
      id: b.id,
      run: async (ctx) => {
        if (b.needs_fixture)
          return {
            skip: `BLOCKED (needs a fixture; the fixture tests may carry it): ${b.needs_fixture}`,
          };
        if (b.open_question)
          return { skip: `UNSPEC (an open question): ${b.open_question}` };
        // The reads: one tool, or aliased calls.
        let root;
        let ms = null;
        if (b.calls) {
          root = {};
          for (const [alias, c] of Object.entries(b.calls)) {
            const r = await ctx.read(c.tool, c.args ?? {});
            root[alias] = r.body; // a refusal is a body too (nc.errors.*)
            ms = (ms ?? 0) + (r.ms ?? 0);
          }
        } else {
          const r = await ctx.read(b.tool, b.args ?? {});
          root = r.body;
          ms = r.ms;
          // A block asserting on error.* reads a refusal on purpose.
          if (
            r.isError &&
            !b.assert?.some((a) => JSON.stringify(a).includes("error."))
          )
            answered(r, `${b.tool} ${JSON.stringify(b.args)}`);
        }
        const targets = b.for_each ? (resolve(root, b.for_each) ?? []) : [root];
        let applied = 0;
        for (const t of targets) {
          if (b.when && !holds(b.when, t, root)) continue;
          applied += 1;
          for (const a of b.assert ?? []) assertOne(a, t, root);
        }
        if (b.when && applied === 0)
          return {
            skip: `SKIPPED: when ${JSON.stringify(b.when)} did not hold`,
          };
        return { ms };
      },
    };
  });
}
