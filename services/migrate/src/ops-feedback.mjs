import pg from "pg";

/** Pending feedback ({feedback_pending: true}): every status='new' item
 *  across all accounts - the loop's standing check (Jamie, 2026-09-05:
 *  "make checking for new feedback part of your regular check"). */
export async function feedbackPending(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select f.feedback_id, f.surface, f.category, f.message, f.created_at,
              (select c.player_tag from claim c
               where c.account_id = f.account_id and c.is_primary) as from_player
       from feedback f where f.status = 'new'
       order by f.feedback_id`,
    );
    return { pending: rows.length, items: rows };
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
    const { rows: updated } = await db.query(
      `update feedback set status = $2,
              response = coalesce($3, response),
              responded_at = case when $3 is not null then now() else responded_at end,
              shipped_in = coalesce($4, shipped_in),
              related_tools = coalesce($5, related_tools)
       where feedback_id = $1
       returning account_id`,
      [
        spec.feedback_id,
        status,
        spec.response ? String(spec.response).slice(0, 4000) : null,
        spec.shipped_in ?? null,
        normalizeRelatedTools(spec.related_tools),
      ],
    );
    if (updated[0] && spec.response) {
      const { emitFeedEvent } = await import("../../mcp/src/feed.mjs");
      await emitFeedEvent(
        db,
        updated[0].account_id,
        "feedback_responded",
        null,
        {
          feedback_id: Number(spec.feedback_id),
          status,
        },
      );
    }
    return { updated: updated.length };
  } finally {
    await db.end();
  }
}
