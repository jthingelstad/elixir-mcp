/**
 * The identity DSL: a cross-tool invariant as one declaration. The
 * hand-written identities encode meaning and stay hand-written; what
 * grows by the line is the number of pairs, so a pair is a line:
 *
 *   same("decks used in the running race",
 *     rows("war_current", {}, "participants", "player_tag", "decks_used"),
 *     rows("clans_participation", { weeks: 1 }, "members", "player_tag", warDecksThisWeek))
 *   ordered("a rival's counts nest", "war_rivals", {}, "rivals",
 *     ["zero_fame_races", "finished_races", "races_observed"])
 *   sums("considered = exclusions + decided", "battles_meta_decks", { segment: "corpus", limit: 5 },
 *     "excluded.considered", [...parts])
 *
 * Every rule compiles to a case `{ id, run(ctx) }` whose failure names
 * the rows that disagree. Paths are dotted (`snapshot.entries`); a
 * value may be a function `(row, body, other) => value` where a path
 * will not do (`other` is the left side's body when reading the right). Arguments may be a function of ctx (a closed week found at run
 * time). A null on either side of a comparison is "unknown" and skips
 * the row, so a rule never fails on an honest null - `nonNull` pins the
 * ones that must not be.
 */

import { answered, ok, fail } from "./lib.mjs";

export const get = (obj, path) =>
  path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);
const valueOf = (spec, row, body, other = null) =>
  typeof spec === "function" ? spec(row, body, other) : get(row, spec);
const resolveArgs = async (args, ctx) =>
  typeof args === "function" ? await args(ctx) : (args ?? {});
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** A value a rule names must EXIST: undefined is a field the row lacks
 *  and fails the rule (the finished_races class); null is an honest
 *  unknown and skips the row. */
const lacks = (vals) => vals.some((v) => v === undefined);
const unknown = (vals) => vals.some((v) => v === null);

/** A side of a comparison: the rows of `list` on a tool's answer, keyed
 *  by `key`, each reduced to `value`. `list` null means the body itself
 *  is the one row (a scalar side). */
export function rows(tool, args, list, key, value) {
  return { tool, args, list, key, value };
}
export function scalar(tool, args, value) {
  return { tool, args, list: null, key: null, value };
}

/** `other` is the left side's body when reading the right: a value that
 *  depends on what the other tool said (which week is running). */
async function readSide(ctx, side, other = null) {
  const args = await resolveArgs(side.args, ctx);
  const body = answered(
    await ctx.read(side.tool, args),
    `${side.tool} ${JSON.stringify(args)}`,
  );
  if (side.list === null)
    return {
      body,
      map: new Map([["", valueOf(side.value, body, body, other)]]),
    };
  const list = get(body, side.list) ?? [];
  const map = new Map();
  for (const row of list)
    map.set(String(get(row, side.key)), valueOf(side.value, row, body, other));
  return { body, map };
}

/** The same number on two tools, row by row where both sides have the
 *  key. Requires at least one row compared, unless `allowEmpty`. */
export function same(
  label,
  left,
  right,
  { allowEmpty = false, tolerance = 0 } = {},
) {
  return {
    id: `same:${label.replace(/\s+/g, "-")}`,
    run: async (ctx) => {
      const a = await readSide(ctx, left);
      const b = await readSide(ctx, right, a.body);
      let compared = 0;
      const off = [];
      for (const [k, va] of a.map) {
        if (!b.map.has(k)) continue;
        const vb = b.map.get(k);
        if (va === undefined || vb === undefined) {
          off.push(
            `${k || "value"}: a side lacks the field (${left.tool} ${JSON.stringify(va)} vs ${right.tool} ${JSON.stringify(vb)})`,
          );
          continue;
        }
        if (va === null || vb === null) continue;
        compared += 1;
        const equal =
          isNum(va) && isNum(vb) ? Math.abs(va - vb) <= tolerance : va === vb;
        if (!equal)
          off.push(
            `${k || "value"}: ${left.tool} ${JSON.stringify(va)} vs ${right.tool} ${JSON.stringify(vb)}`,
          );
      }
      ok(compared > 0 || allowEmpty, `${label}: no row on both sides`);
      ok(
        off.length === 0,
        `${label}: ${off.slice(0, 5).join("; ")}${off.length > 5 ? ` (+${off.length - 5})` : ""}`,
      );
    },
  };
}

/** Each row's values along `chain` are non-decreasing (a ≤ b ≤ c). */
export function ordered(label, tool, args, list, chain) {
  return {
    id: `ordered:${label.replace(/\s+/g, "-")}`,
    run: async (ctx) => {
      const a = await resolveArgs(args, ctx);
      const body = answered(await ctx.read(tool, a), tool);
      const off = [];
      for (const row of get(body, list) ?? []) {
        const vals = chain.map((c) => valueOf(c, row, body));
        if (lacks(vals)) {
          off.push(
            `a row lacks ${chain.filter((c, i) => vals[i] === undefined).join(", ")}`,
          );
          continue;
        }
        if (unknown(vals)) continue;
        for (let i = 1; i < vals.length; i += 1)
          if (vals[i - 1] > vals[i])
            off.push(
              `${JSON.stringify(row[Object.keys(row)[0]])}: ${chain.join(" ≤ ")} is ${vals.join(", ")}`,
            );
      }
      ok(off.length === 0, `${label}: ${off.slice(0, 5).join("; ")}`);
    },
  };
}

/** A total equals the sum of its parts, on the body (`list` null) or on
 *  every row of `list`. */
export function sums(
  label,
  tool,
  args,
  total,
  parts,
  { list = null, tolerance = 0 } = {},
) {
  return {
    id: `sums:${label.replace(/\s+/g, "-")}`,
    run: async (ctx) => {
      const a = await resolveArgs(args, ctx);
      const body = answered(await ctx.read(tool, a), tool);
      const targets = list === null ? [body] : (get(body, list) ?? []);
      const off = [];
      for (const t of targets) {
        const whole = valueOf(total, t, body);
        const vals = parts.map((p) => valueOf(p, t, body));
        if (lacks([whole, ...vals])) {
          off.push(
            `a row lacks ${[total, ...parts].filter((x, i) => [whole, ...vals][i] === undefined).join(", ")}`,
          );
          continue;
        }
        if (unknown([whole, ...vals])) continue;
        const sum = vals.reduce((x, y) => x + y, 0);
        if (Math.abs(sum - whole) > tolerance)
          off.push(
            `${typeof total === "string" ? total : "total"} ${whole} vs parts ${sum}`,
          );
      }
      ok(off.length === 0, `${label}: ${off.slice(0, 5).join("; ")}`);
    },
  };
}

/** Every row of `list` (or the body) where `when` holds satisfies `then`. */
export function implies(label, tool, args, list, when, then) {
  return {
    id: `implies:${label.replace(/\s+/g, "-")}`,
    run: async (ctx) => {
      const a = await resolveArgs(args, ctx);
      const body = answered(await ctx.read(tool, a), tool);
      const targets = list === null ? [body] : (get(body, list) ?? []);
      const off = [];
      let applied = 0;
      for (const t of targets) {
        if (!when(t, body)) continue;
        applied += 1;
        if (!then(t, body)) off.push(JSON.stringify(t).slice(0, 120));
      }
      ok(
        off.length === 0,
        `${label}: ${off.length} of ${applied} rows break it: ${off.slice(0, 3).join("; ")}`,
      );
    },
  };
}

/** Every row's `value` lies in [low, high], each a number or a path/function. */
export function bounded(label, tool, args, list, value, low, high) {
  return implies(
    label,
    tool,
    args,
    list,
    (row, body) => valueOf(value, row, body) !== null,
    (row, body) => {
      const v = valueOf(value, row, body);
      if (v === undefined) return false; // the row lacks the field
      const lo = isNum(low) ? low : valueOf(low, row, body);
      const hi = isNum(high) ? high : valueOf(high, row, body);
      return (lo == null || v >= lo) && (hi == null || v <= hi);
    },
  );
}

/** A sum over rows stays under a cap (usage shares ≤ 1). */
export function sumAtMost(label, tool, args, list, value, cap) {
  return {
    id: `sum-at-most:${label.replace(/\s+/g, "-")}`,
    run: async (ctx) => {
      const a = await resolveArgs(args, ctx);
      const body = answered(await ctx.read(tool, a), tool);
      const total = (get(body, list) ?? []).reduce(
        (s, r) => s + (valueOf(value, r, body) ?? 0),
        0,
      );
      ok(total <= cap, `${label}: ${total} over ${cap}`);
    },
  };
}

export function nonNull(label, tool, args, list, value) {
  return implies(
    label,
    tool,
    args,
    list,
    () => true,
    (row, body) => valueOf(value, row, body) != null,
  );
}

/** Something that must be true of a body, said in code. */
export function check(label, tool, args, fn) {
  return {
    id: `check:${label.replace(/\s+/g, "-")}`,
    run: async (ctx) => {
      const a = await resolveArgs(args, ctx);
      const body = answered(await ctx.read(tool, a), tool);
      const problem = fn(body, ctx);
      if (problem) fail(`${label}: ${problem}`);
    },
  };
}
