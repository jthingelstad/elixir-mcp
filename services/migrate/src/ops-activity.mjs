import pg from "pg";
import { buildTimeline, subjectsFor } from "../../mcp/src/activity/entries.mjs";

/**
 * Read-only preview of the timeline ({activity_preview: spec}) —
 * review 2026-09-13 §15: synthesize entries from the live record for a
 * reader BEFORE the 2.0.0 tool shape lands, so Jamie can read them as a
 * person and say whether they are valuable. No writes.
 *
 *   spec.owner: true            the owner account's own subjects
 *   spec.account_id: uuid       that account's subjects
 *   spec.as_agent_of: "#CLAN"   one clan entry, as an agent of it would see
 *   spec.subjects: [{kind, tag, relationship?, scope?}]
 *   spec.from / spec.to         ISO instants; default to = now, from = to - 24h
 *   spec.timezone               for the summary's "since" label
 */
export async function activityPreview(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const toMs = spec.to ? Date.parse(spec.to) : Date.now();
    const fromMs = spec.from ? Date.parse(spec.from) : toMs - 24 * 3600_000;
    if (Number.isNaN(toMs) || Number.isNaN(fromMs) || fromMs >= toMs)
      return { error: "from/to must be ISO instants with from < to" };
    let subjects = [];
    let timezone = spec.timezone ?? "UTC";
    let reader = null;
    if (spec.owner || spec.account_id) {
      const { rows } = await db.query(
        spec.owner
          ? `select account_id, kind, timezone from account where is_owner order by created_at limit 1`
          : `select account_id, kind, timezone from account where account_id = $1`,
        spec.owner ? [] : [String(spec.account_id)],
      );
      if (!rows[0]) return { error: "no such account" };
      reader = { account_id: rows[0].account_id, kind: rows[0].kind };
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
      reader ??= { kind: "agent", clan_tag: String(spec.as_agent_of) };
    }
    if (Array.isArray(spec.subjects)) subjects.push(...spec.subjects);
    if (subjects.length === 0) return { error: "no subjects" };
    const t0 = Date.now();
    const perf = {};
    const out = await buildTimeline(db, subjects, {
      fromMs,
      toMs,
      timezone,
      accountId: reader?.account_id ?? null,
      perf,
    });
    return {
      reader,
      timezone,
      subjects: subjects.length,
      elapsed_ms: Date.now() - t0,
      perf_ms: perf,
      ...out,
    };
  } finally {
    await db.end();
  }
}

/**
 * {explain_timeline: spec} (review 2026-09-19 Part 7.6; 3.18.0): one
 * elixir_timeline read, replayed exactly and timed per query, with the
 * plans of the two statements an empty window's cost lives in.
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
  const { clanLearnedQuery, clanMemberBattlesQuery } =
    await import("../../mcp/src/activity/entries.mjs");
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
    const perf = {};
    const t0 = Date.now();
    const out = await buildTimeline(db, subjects, {
      fromMs,
      toMs,
      timezone,
      accountId,
      perf,
    });
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
