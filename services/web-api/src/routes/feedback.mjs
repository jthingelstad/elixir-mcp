import { emitFeedEvent } from "../../../mcp/src/feed.mjs";

import { json, ID_RE } from "../http.mjs";
import { senderRef } from "../notify.mjs";

export function feedbackRoutes({
  resolveAccount,
  ping,
  notifyOwner = async () => {},
}) {
  return {
    "GET /api/me/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select feedback_id, surface, category, message, status,
                response, responded_at, created_at, shipped_in
         from feedback where account_id = $1
         order by feedback_id desc limit 50`,
        [account.accountId],
      );
      return json(200, { feedback: rows });
    },

    "POST /api/feedback": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const message = String(body.message ?? "").trim();
      if (!message || message.length > 4000)
        return json(400, { error: "bad_request", message: "1-4000 chars." });
      const category = [
        "general",
        "bug",
        "data_quality",
        "feature",
        "praise",
      ].includes(body.category)
        ? body.category
        : "general";
      const { rows: filed } = await db.query(
        `insert into feedback (account_id, surface, category, message, context)
         values ($1, 'web', $2, $3, $4) returning feedback_id`,
        [
          account.accountId,
          category,
          message,
          body.context
            ? JSON.stringify({ context: String(body.context) })
            : null,
        ],
      );
      await ping("site.feedback", category);
      // Jamie hears about it (2026-09-09): best-effort, never in the way
      // of the row that was just written. The owner's own feedback is not
      // news to the owner.
      if (!account.isOwner) {
        try {
          await notifyOwner({
            kind: "feedback",
            category,
            surface: "web",
            message,
            from: senderRef(account),
            feedbackId: filed[0].feedback_id,
          });
        } catch (err) {
          console.error("owner_notify_enqueue_failed", err?.message);
        }
      }
      return json(200, { ok: true });
    },

    "GET /api/admin/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const { rows } = await db.query(
        `select f.feedback_id, f.surface, f.category, f.message, f.context,
                f.status, f.response, f.responded_at, f.created_at,
                (select c.player_tag from claim c
                 where c.account_id = f.account_id and c.is_primary) as from_player
         from feedback f order by f.feedback_id desc limit 100`,
      );
      return json(200, { feedback: rows });
    },

    "POST /api/admin/feedback": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const status = ["seen", "planned", "done", "declined"].includes(
        body.status,
      )
        ? body.status
        : null;
      if (!status || !ID_RE.test(String(body.feedback_id ?? "")))
        return json(400, { error: "bad_request" });
      const response = body.response
        ? String(body.response).slice(0, 4000)
        : null;
      const { rows: updated } = await db.query(
        `update feedback set status = $2,
                response = coalesce($3, response),
                responded_at = case when $3 is not null then now() else responded_at end
         where feedback_id = $1
         returning account_id`,
        [body.feedback_id, status, response],
      );
      if (updated[0] && response) {
        await emitFeedEvent(
          db,
          updated[0].account_id,
          "feedback_responded",
          null,
          {
            feedback_id: Number(body.feedback_id),
            status,
          },
        );
      }
      return json(200, { ok: true });
    },
  };
}
