import pg from "pg";

const FEEDBACK_FIELDS = `f.feedback_id, f.surface, f.category, f.message, f.request_id,
  f.created_at, f.status, f.response, f.responded_at, f.shipped_in, f.related_tools,
  (select c.player_tag from claim c where c.account_id = f.account_id and c.is_primary) as from_player`;

/** Unanswered feedback: count the full backlog, return its oldest 25.
 * A status-only acknowledgment is still unanswered. */
export async function feedbackPending(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [counts],
    } = await db.query(
      `select count(*)::int as pending, min(created_at) as oldest_created_at,
        extract(epoch from now() - min(created_at))::int as oldest_age_seconds,
        count(*) filter (where created_at < now() - interval '1 day')::int as overdue
       from feedback where response is null or btrim(response) = ''`,
    );
    const { rows } = await db.query(
      `select ${FEEDBACK_FIELDS} from feedback f
       where f.response is null or btrim(f.response) = ''
       order by f.created_at, f.feedback_id limit 25`,
    );
    return { ...counts, items: rows };
  } finally {
    await db.end();
  }
}

/** IAM-only read-back, without changing the requester's read pointer. */
export async function feedbackRead(databaseUrl, spec) {
  if (!/^[1-9]\d*$/.test(String(spec?.feedback_id ?? "")))
    throw new Error("feedback_read needs a positive feedback_id");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select ${FEEDBACK_FIELDS} from feedback f where f.feedback_id = $1`,
      [spec.feedback_id],
    );
    return { feedback: rows[0] ?? null };
  } finally {
    await db.end();
  }
}

/** Maintainer feedback response ({feedback_respond: {feedback_id,
 *  status, response}}): the ops-side path to close a feedback item so
 *  the requester sees status + reply (0026). The admin web panel is the
 *  interactive equivalent. */
/** related_tools is a text[] column, and the ops lane is typed by hand:
 *  a comma-separated string is the natural thing to send and it threw
 *  ("malformed array literal", seen in prod 2026-09-09 09:17Z). Accept
 *  either shape, trim, drop empties, and keep null meaning "unchanged"
 *  so coalesce still works. An empty list clears the column. */
export function normalizeRelatedTools(value) {
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((t) => String(t).trim()).filter(Boolean);
}

export async function feedbackRespond(databaseUrl, spec) {
  const status = ["seen", "planned", "done", "declined"].includes(spec?.status)
    ? spec.status
    : null;
  if (!status || !spec?.feedback_id)
    throw new Error("feedback_respond needs feedback_id and a valid status");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    const { rows: updated } = await db.query(
      `update feedback set status = $2,
              response = coalesce($3, response),
              responded_at = case when $3 is not null then now() else responded_at end,
              shipped_in = coalesce($4, shipped_in),
              related_tools = coalesce($5, related_tools)
       where feedback_id = $1
         and ($6::boolean = false or (
           status = $7 and response is not distinct from $8::text
           and responded_at is not distinct from $9::timestamptz))
       returning account_id`,
      [
        spec.feedback_id,
        status,
        spec.response ? String(spec.response).slice(0, 4000) : null,
        spec.shipped_in ?? null,
        normalizeRelatedTools(spec.related_tools),
        spec.expected !== undefined,
        spec.expected?.status ?? null,
        spec.expected?.response ?? null,
        spec.expected?.responded_at ?? null,
      ],
    );
    if (updated[0] && spec.response) {
      await db.query(
        `insert into account_event (account_id, kind, detail) values ($1, 'feedback_responded', $2)`,
        [
          updated[0].account_id,
          JSON.stringify({ feedback_id: Number(spec.feedback_id), status }),
        ],
      );
    }
    await db.query("commit");
    return { updated: updated.length };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}
