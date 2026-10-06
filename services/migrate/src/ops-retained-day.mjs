import pg from "pg";

/** Fixed-day private fact export. Compare the frozen protected set locally;
 * neither rank nor today's tracking establishes original retention intent. */
export async function retainedDayAudit(databaseUrl, spec, client = null) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    return { error: "invalid_retained_day_audit", reason: "object_required" };
  if (Object.keys(spec).some((key) => !["day", "after", "limit"].includes(key)))
    return { error: "invalid_retained_day_audit", reason: "unknown_fields" };
  if (spec.day !== "2026-09-13")
    return { error: "invalid_retained_day_audit", reason: "fixed_day_only" };
  const after = spec.after ?? null;
  if (
    after !== null &&
    (typeof after !== "string" || !/^[a-f0-9]{64}$/.test(after))
  )
    return { error: "invalid_retained_day_audit", reason: "invalid_cursor" };
  const limit = spec.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    return { error: "invalid_retained_day_audit", reason: "invalid_limit" };
  const db =
    client ??
    new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
  let transaction = false;
  try {
    await db.connect();
    await db.query("begin isolation level repeatable read read only");
    transaction = true;
    await db.query("set local statement_timeout = '5s'");
    await db.query("set local lock_timeout = '500ms'");
    await db.query("set local idle_in_transaction_session_timeout = '10s'");
    const { rows } = await db.query(
      `with page as materialized (
         select battle_id, battle_time, created_at from battle
         where battle_time >= $1::timestamptz and battle_time < $2::timestamptz
           and ($3::text is null or battle_id > $3)
         order by battle_id limit $4
       )
       select p.battle_id,
              to_char(p.battle_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as battle_time,
              to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
              array(select bp.player_tag from battle_participant bp
                    where bp.battle_id = p.battle_id order by bp.player_tag limit 9) as player_tags
       from page p order by p.battle_id`,
      ["2026-09-13T00:00:00Z", "2026-09-14T00:00:00Z", after, limit + 1],
    );
    if (rows.some((row) => row.player_tags.length > 8))
      throw new Error("participant_bound");
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    await db.query("commit");
    transaction = false;
    return {
      day: spec.day,
      from: "2026-09-13T00:00:00Z",
      to: "2026-09-14T00:00:00Z",
      readonly: true,
      snapshot_isolation: "repeatable_read_per_page",
      limit,
      rows: page,
      next_after: more ? page.at(-1).battle_id : null,
      done: !more,
    };
  } catch {
    if (transaction) {
      try {
        await db.query("rollback");
      } catch {
        /* Connection failed; no writes were allowed. */
      }
    }
    return { error: "retained_day_audit_failed" };
  } finally {
    await db.end();
  }
}
