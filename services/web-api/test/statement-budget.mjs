/**
 * Counting what a web request asks of the database (2026-11-13): every
 * statement a request makes through the web API's own handler, and each
 * read statement's plan run again with EXPLAIN (ANALYZE, BUFFERS). The
 * budget tests hold counts and plan shapes from these, never
 * milliseconds.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

/** The tables a signed-in page must read by range, never whole. */
export const LARGE = [
  "battle",
  "battle_participant",
  "player",
  "player_snapshot_daily",
  "player_daily_battle_rollup",
];

const als = new AsyncLocalStorage();
let original = null;

/** Start recording every statement made inside `record()`. */
export function captureStatements() {
  if (original) return;
  original = pg.Client.prototype.query;
  const base = original;
  pg.Client.prototype.query = function (config, values, cb) {
    const seen = als.getStore();
    const text = typeof config === "string" ? config : config?.text;
    if (seen && typeof text === "string")
      seen.push({
        text,
        values: Array.isArray(values) ? values : config?.values,
      });
    return base.call(this, config, values, cb);
  };
}

export function releaseStatements() {
  if (original) pg.Client.prototype.query = original;
  original = null;
}

/** Run `fn`, answering its result and the statements it made. */
export async function record(fn) {
  const seen = [];
  const result = await als.run(seen, fn);
  return { result, seen };
}

/** One request through a handler, signed in with `cookie`. */
export async function request(
  handler,
  cookie,
  path,
  { method = "GET", query = {}, body } = {},
) {
  const { result, seen } = await record(() =>
    handler({
      path,
      method,
      headers: {
        cookie,
        "x-elixir-client": "web",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      queryStringParameters: query,
      rawQueryString: new URLSearchParams(query).toString(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  let json = null;
  try {
    json = JSON.parse(result.body ?? "null");
  } catch {
    json = null;
  }
  return { status: result.statusCode, body: json, seen };
}

/** Every scanned table in a plan, with what it read over all its loops. */
function scans(plan) {
  const out = [];
  const walk = (n) => {
    if (n["Relation Name"])
      out.push({
        node: n["Node Type"],
        table: n["Relation Name"],
        index: n["Index Name"] ?? null,
        loops: n["Actual Loops"] ?? 1,
        read:
          ((n["Actual Rows"] ?? 0) + (n["Rows Removed by Filter"] ?? 0)) *
          (n["Actual Loops"] ?? 1),
      });
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(plan);
  return out;
}

/** The plan of every read statement, run again as it was run, with its
 *  shared buffers (hit and read). */
export async function plans(db, seen) {
  const out = [];
  for (const s of seen) {
    if (!/^\s*(with|select)\b/i.test(s.text)) continue;
    // A data-modifying CTE is a write; explaining it would run it.
    if (
      /\b(insert|update|delete)\b/i.test(s.text) &&
      /^\s*with\b/i.test(s.text)
    )
      continue;
    const r = await db.query(
      `explain (analyze, buffers, format json) ${s.text}`,
      s.values,
    );
    const top = r.rows[0]["QUERY PLAN"][0].Plan;
    out.push({
      text: s.text.replace(/\s+/g, " ").trim().slice(0, 120),
      full: s.text,
      buffers:
        (top["Shared Hit Blocks"] ?? 0) + (top["Shared Read Blocks"] ?? 0),
      scans: scans(top),
    });
  }
  return out;
}

/** The plans' Seq Scans of a large table. */
export const wholeScans = (planned) =>
  planned.flatMap((p) =>
    p.scans
      .filter((s) => LARGE.includes(s.table) && s.node === "Seq Scan")
      .map((s) => `${s.table}: ${p.text}`),
  );
