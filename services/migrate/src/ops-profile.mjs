/**
 * {profile_tool: {tool, args, principal?, explain?}} - one real tool call
 * against production, with every query it sends timed and, on request,
 * EXPLAINed.
 *
 * Why this and not another explain_<tool>: each of those carries its own
 * copy of a tool's SQL, and copies drift. On 2026-09-23 {explain_meta}
 * was still profiling an excluded-breakdown join to `battle` that the
 * tool had dropped at 0095/0099, so it could not say where the live read
 * spent its time. This runs the registry's own handler, exactly as the
 * door would for that principal, through a recording db: the SQL is the
 * SQL that ships, and nothing here has to change when a tool does.
 *
 * Read-only by construction:
 * - only tools classified readOnly and not openWorld (no live lane),
 * - `live` is null,
 * - the session is `default_transaction_read_only`, so even a mistaken
 *   write is refused by Postgres.
 * The principal is a service token NAME (default "acceptance": an agent
 * for #J2RGCRVG with no player of its own, so name the player in args);
 * nothing secret is read.
 *
 * `explain: true` runs EXPLAIN (ANALYZE, BUFFERS) BEFORE each read, so
 * the plan sees the cache as the call would have (the real query then
 * runs warm; its ms is the lower bound). Explaining stops once the op
 * has spent EXPLAIN_BUDGET_MS, to stay clear of the migrate-duration
 * alarm (90 s).
 */

import pg from "pg";

const STATEMENT_TIMEOUT_MS = 30_000;
const EXPLAIN_BUDGET_MS = 40_000;

const isRead = (text) =>
  typeof text === "string" &&
  /^\s*(with|select)\b/i.test(text) &&
  !/\bset_config\s*\(/i.test(text);

/** The plan nodes that touched a relation, with what each read. */
function planSummary(explained) {
  const top = explained?.[0] ?? {};
  const nodes = [];
  const walk = (n) => {
    if (!n) return;
    if (n["Relation Name"] || n["Index Name"])
      nodes.push({
        node: n["Node Type"],
        relation: n["Relation Name"] ?? null,
        index: n["Index Name"] ?? null,
        rows: n["Actual Rows"] ?? null,
        loops: n["Actual Loops"] ?? null,
        ms: n["Actual Total Time"] ?? null,
        hit: n["Shared Hit Blocks"] ?? 0,
        read: n["Shared Read Blocks"] ?? 0,
        io_ms: n["I/O Read Time"] ?? null,
        heap_fetches: n["Heap Fetches"] ?? null,
      });
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(top.Plan);
  nodes.sort((a, b) => b.read - a.read || (b.ms ?? 0) - (a.ms ?? 0));
  return {
    exec_ms: top["Execution Time"] ?? null,
    hit: top.Plan?.["Shared Hit Blocks"] ?? null,
    read: top.Plan?.["Shared Read Blocks"] ?? null,
    io_ms: top.Plan?.["I/O Read Time"] ?? null,
    temp_written: top.Plan?.["Temp Written Blocks"] ?? null,
    nodes: nodes.slice(0, 6),
  };
}

function recordingDb(db, { explain, log }) {
  const started = performance.now();
  let explainMs = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== "query") {
        const v = target[prop];
        return typeof v === "function" ? v.bind(target) : v;
      }
      return async (text, values) => {
        const entry = {
          i: log.length,
          sql:
            typeof text === "string"
              ? text.replace(/\s+/g, " ").trim().slice(0, 240)
              : "(config)",
        };
        log.push(entry);
        if (explain && isRead(text) && explainMs < EXPLAIN_BUDGET_MS) {
          const e0 = performance.now();
          try {
            const { rows } = await target.query(
              `explain (analyze, buffers, format json) ${text}`,
              values,
            );
            entry.plan = planSummary(rows[0]?.["QUERY PLAN"]);
          } catch (err) {
            entry.plan_error = err.message;
          }
          explainMs += performance.now() - e0;
        }
        const t0 = performance.now();
        try {
          const result = await target.query(text, values);
          entry.rows = result?.rowCount ?? result?.rows?.length ?? null;
          return result;
        } catch (err) {
          entry.error = err.message;
          throw err;
        } finally {
          entry.ms = Math.round(performance.now() - t0);
          entry.at_ms = Math.round(t0 - started);
        }
      };
    },
  });
}

export async function profileTool(databaseUrl, spec = {}) {
  const tool = String(spec.tool ?? "");
  const args = spec.args && typeof spec.args === "object" ? spec.args : {};
  const principal = String(spec.principal ?? "acceptance");
  const explain = spec.explain === true;
  const [{ makeRegistry }, { TOOL_GROUPS }, { serviceTokenAccountByName }] =
    await Promise.all([
      import("../../mcp/src/tools.mjs"),
      import("@elixir-mcp/contracts"),
      import("@elixir-mcp/auth"),
    ]);
  const registry = makeRegistry();
  if (!registry.has(tool)) return { error: "unknown_tool", tool };
  const cls = TOOL_GROUPS[tool];
  if (!cls?.readOnly || cls.openWorld)
    return {
      error: "not_profilable",
      tool,
      reason: "read-only, recorded-only tools: no writes, no live lane",
    };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(`set statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await db.query("set default_transaction_read_only = on");
    const account = await serviceTokenAccountByName(db, principal);
    if (!account) return { error: "principal_not_found", principal };
    if (!registry.availableTo(tool, account.kind))
      return { error: "not_available_to_principal", tool, kind: account.kind };
    const log = [];
    const ctx = {
      db: recordingDb(db, { explain, log }),
      account,
      live: null,
      notifyOwner: null,
    };
    const t0 = performance.now();
    let error = null;
    let resultBytes = null;
    let window = null;
    try {
      const body = await registry.invoke(tool, ctx, args);
      resultBytes = JSON.stringify(body).length;
      window = body?.applied?.window ?? null;
    } catch (err) {
      error = { code: err?.code ?? null, message: err?.message ?? String(err) };
    }
    const totalMs = Math.round(performance.now() - t0);
    const dbMs = log.reduce((a, q) => a + (q.ms ?? 0), 0);
    return {
      tool,
      args,
      principal,
      kind: account.kind,
      explain,
      total_ms: totalMs,
      db_ms: dbMs,
      queries: log.length,
      result_bytes: resultBytes,
      window,
      error,
      // Slowest first; the order they ran in is `i` and `at_ms`.
      slowest: [...log].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 12),
    };
  } finally {
    await db.end();
  }
}
