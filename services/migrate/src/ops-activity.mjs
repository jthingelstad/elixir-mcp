import pg from "pg";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";

/**
 * {explain_timeline: spec} (3.18.0): one
 * elixir_timeline read, replayed exactly and timed per query, with the
 * plans of the clan statements an empty window's cost lives in (and
 * clan.most's, 2026-11-13).
 *
 *   spec.request_id       a captured call's id (a prefix is enough): the
 *                         audit row supplies the account and the bounded
 *                         args (from, to, kinds, verbosity)
 *   spec.account_id       or the account, with spec.from / spec.to
 *   spec.as_agent_of      or one clan entry as an agent of it would read
 *
 * Read-only: nothing marks a pointer. Returns perf_ms per query, the
 * timeline's counts (never its items) and the EXPLAIN ANALYZE plans.
 */
export async function explainTimeline(databaseUrl, spec = {}) {
  const {
    clanLearnedQuery,
    clanMemberBattlesQuery,
    clanMostQuery,
    prefetchStatements,
  } = await import("@elixir-mcp/tools/activity/entries");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = 120000");
    let accountId = spec.account_id ? String(spec.account_id) : null;
    let args = {};
    let audit = null;
    if (spec.request_id) {
      const { rows } = await db.query(
        `select request_id, account_id, surface, args, duration_ms, db_ms, db_queries, created_at
           from mcp_call_audit
          where tool = 'elixir_timeline' and request_id::text like $1
          order by created_at desc limit 1`,
        [`${String(spec.request_id)}%`],
      );
      if (!rows[0])
        return {
          error: "no audited elixir_timeline call with that request_id",
        };
      audit = rows[0];
      accountId = rows[0].account_id;
      args = rows[0].args ?? {};
    }
    const toMs = spec.to
      ? Date.parse(spec.to)
      : args.to
        ? Date.parse(args.to)
        : audit
          ? audit.created_at.getTime()
          : Date.now();
    const fromMs = spec.from
      ? Date.parse(spec.from)
      : args.from
        ? Date.parse(args.from)
        : toMs - 24 * 3600_000;
    if (Number.isNaN(toMs) || Number.isNaN(fromMs) || fromMs >= toMs)
      return { error: "from/to must be ISO instants with from < to" };
    let subjects = [];
    let timezone = spec.timezone ?? "UTC";
    if (accountId) {
      const { rows } = await db.query(
        `select account_id, kind, timezone from account where account_id = $1`,
        [accountId],
      );
      if (!rows[0]) return { error: "no such account" };
      timezone = spec.timezone ?? rows[0].timezone ?? "UTC";
      subjects = await subjectsFor(db, rows[0].account_id);
    }
    if (spec.as_agent_of) {
      const { rows } = await db.query(
        `select scope from account_clan where clan_tag = $1 order by created_at limit 1`,
        [String(spec.as_agent_of)],
      );
      subjects.push({
        kind: "clan",
        tag: String(spec.as_agent_of),
        scope: rows[0]?.scope ?? "comprehensive",
      });
    }
    if (subjects.length === 0) return { error: "no subjects" };
    // The plans of the players' batched reads (players.batch, G1), taken
    // before the read and without running them, so a read that runs past
    // the timeout still says how it was planned.
    const playerTags = subjects
      .filter((x) => x.kind !== "clan")
      .map((x) => x.tag);
    const batch_plans = {};
    if (playerTags.length > 1) {
      const q = prefetchStatements({ fromMs, toMs });
      for (const [name, text] of [
        ["wide", q.wide],
        ["late", q.late],
      ]) {
        const { rows } = await db.query(`explain (format text) ${text}`, [
          playerTags,
        ]);
        batch_plans[name] = rows.map((r) => r["QUERY PLAN"]).join("\n");
      }
    }
    const perf = {};
    const t0 = Date.now();
    let out;
    try {
      out = await buildTimeline(db, subjects, {
        fromMs,
        toMs,
        timezone,
        accountId,
        perf,
      });
    } catch (e) {
      // A read past the statement timeout still reports how it was planned.
      return { error: e.message, ms: Date.now() - t0, perf, batch_plans };
    }
    const elapsed = Date.now() - t0;
    const kinds = Array.isArray(args.kinds) ? args.kinds : null;
    const items = kinds
      ? out.timeline.filter((it) => kinds.includes(it.kind))
      : out.timeline;
    const plans = {};
    for (const s of subjects.filter((x) => x.kind === "clan")) {
      for (const [name, q] of [
        ["learned", clanLearnedQuery({ tag: s.tag, fromMs, toMs })],
        [
          "member_battles",
          clanMemberBattlesQuery({ tag: s.tag, fromMs, toMs }),
        ],
        ["most", clanMostQuery({ tag: s.tag, fromMs, toMs })],
      ]) {
        const started = Date.now();
        const { rows } = await db.query(
          `explain (analyze, buffers, format text) ${q.text}`,
          q.values,
        );
        plans[`${s.tag}.${name}`] = {
          ms: Date.now() - started,
          plan: rows.map((r) => r["QUERY PLAN"]).join("\n"),
        };
      }
    }
    return {
      batch_plans,
      request_id: audit?.request_id ?? null,
      surface: audit?.surface ?? null,
      audited: audit
        ? {
            duration_ms: audit.duration_ms,
            db_ms: audit.db_ms,
            db_queries: audit.db_queries,
            at: audit.created_at,
          }
        : null,
      account_id: accountId,
      args,
      window: out.window,
      subjects: subjects.map((s) => ({ kind: s.kind, tag: s.tag })),
      elapsed_ms: elapsed,
      db_ms: Object.values(perf).reduce((a, b) => a + b, 0),
      perf_ms: perf,
      items: items.length,
      items_unfiltered: out.timeline.length,
      entries: out.entries.length,
      quiet: out.quiet.length,
      plans,
    };
  } finally {
    await db.end();
  }
}
