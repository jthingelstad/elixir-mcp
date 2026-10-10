import pg from "pg";
import {
  answerFeedback,
  feedbackItem,
  feedbackPending as pendingOf,
} from "@elixir-mcp/feedback";

export { normalizeRelatedTools } from "@elixir-mcp/feedback";

/** The ops lanes over the one feedback record (0204): the same service
 *  the admin queue uses, so an answer sent through the op is the admin
 *  page's answer (news again when the words change, mailed to a person). */
async function withDb(databaseUrl, run) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/** Unanswered feedback ({feedback_pending: true} or {area}): the full
 *  backlog counted, by area, and its oldest 25. A status-only
 *  acknowledgment is still unanswered. */
export async function feedbackPending(databaseUrl, spec) {
  const area =
    spec && typeof spec === "object" && spec.area ? String(spec.area) : null;
  return withDb(databaseUrl, (db) => pendingOf(db, { area }));
}

/** IAM-only read-back, without changing the filer's read pointer. */
export async function feedbackRead(databaseUrl, spec) {
  if (!/^[1-9]\d*$/.test(String(spec?.feedback_id ?? "")))
    throw new Error("feedback_read needs a positive feedback_id");
  return withDb(databaseUrl, async (db) => {
    try {
      return { feedback: await feedbackItem(db, spec.feedback_id) };
    } catch (err) {
      if (err?.code === "no_feedback") return { feedback: null };
      throw err;
    }
  });
}

/** Maintainer answer ({feedback_respond: {feedback_id, status, response,
 *  shipped_in, related_tools, expected}}): the ops-side path to close an
 *  item so the filer sees the status and the reply (0026). The admin
 *  queue is the interactive equivalent. related_tools takes a list or a
 *  comma-separated string (typed by hand: "malformed array literal",
 *  2026-09-09). */
export async function feedbackRespond(databaseUrl, spec) {
  if (!spec?.feedback_id)
    throw new Error("feedback_respond needs feedback_id and a valid status");
  return withDb(databaseUrl, async (db) => {
    try {
      const out = await answerFeedback(db, {
        feedbackId: spec.feedback_id,
        status: spec.status,
        response: spec.response ?? null,
        shippedIn: spec.shipped_in,
        relatedTools: spec.related_tools,
        expected: spec.expected,
      });
      return out.updated
        ? { updated: 1, status: out.status, answered: out.answered }
        : { updated: 0 };
    } catch (err) {
      if (err?.code === "bad_status")
        throw new Error(
          "feedback_respond needs feedback_id and a valid status",
        );
      throw err;
    }
  });
}
