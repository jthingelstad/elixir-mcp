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
    const out = await buildTimeline(db, subjects, {
      fromMs,
      toMs,
      timezone,
      accountId: reader?.account_id ?? null,
    });
    return {
      reader,
      timezone,
      subjects: subjects.length,
      elapsed_ms: Date.now() - t0,
      ...out,
    };
  } finally {
    await db.end();
  }
}
