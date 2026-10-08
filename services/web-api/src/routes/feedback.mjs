import {
  FeedbackError,
  answerFeedback,
  feedbackItem,
  feedbackQueue,
  fileFeedback,
  itemMine,
  listMine,
  markSeen,
} from "@elixir-mcp/feedback";
import { senderRef } from "@elixir-mcp/outbox/notify";
import { json } from "../http.mjs";

/** The parts of Elixir a signed-in page can file about (0204). mcp, api
 *  and recorder are the doors' own: a page never claims them. */
const PAGE_AREAS = new Set(["console", "ladder", "clan", "mail", "docs"]);

function refused(err) {
  if (!(err instanceof FeedbackError)) throw err;
  return json(err.status, {
    error: err.code,
    message: err.message,
    ...(err.hint ? { hint: err.hint } : {}),
  });
}

/** The first call and email, as the pages read them before refs (0204):
 *  kept on each item for one release. */
function withLegacy(item) {
  return {
    ...item,
    request_id: item.refs.find((r) => r.kind === "call")?.ref ?? null,
    send_id: item.refs.find((r) => r.kind === "email")?.ref ?? null,
  };
}

export function feedbackRoutes({
  resolveAccount,
  notifyOwner = async () => {},
}) {
  return {
    // A filer's own items, wherever they were filed. A person's own page
    // shows each answer in full, so the answers on it are read; an owner
    // on their agent's page reads them for it, and the agent's pending
    // hint stays up.
    "GET /api/me/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const q = event.queryStringParameters ?? {};
      try {
        const page = await listMine(db, account.accountId, {
          limit: q.limit ?? 50,
          offset: q.offset ?? 0,
          status: q.status || null,
          area: q.area || null,
        });
        if (!event.scopedAccount)
          await markSeen(
            db,
            account.accountId,
            page.items.map((i) => i.feedback_id),
          );
        return json(200, {
          feedback: page.items.map(withLegacy),
          total: page.total,
          unseen: page.unseen,
        });
      } catch (err) {
        return refused(err);
      }
    },

    "GET /api/me/feedback/*": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      try {
        const item = await itemMine(db, account.accountId, event.pathParam, {
          seen: !event.scopedAccount,
        });
        return json(200, { feedback: withLegacy(item) });
      } catch (err) {
        return refused(err);
      }
    },

    // Every signed-in page files here: the Console, Ladder, Elixir Clan,
    // the docs and the email record. `area` is the part of Elixir it is
    // about; `refs` what it points at (a call, an email, a player, a
    // clan action...). request_id and send_id are the pages' older
    // fields for the first two, still taken.
    "POST /api/feedback": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const refs = [
        ...(body.request_id ? [{ kind: "call", ref: body.request_id }] : []),
        ...(body.send_id ? [{ kind: "email", ref: body.send_id }] : []),
        ...(Array.isArray(body.refs) ? body.refs : []),
      ];
      const area = body.area ?? (body.send_id ? "mail" : "console");
      if (!PAGE_AREAS.has(area))
        return json(400, {
          error: "bad_area",
          message: `A page files about ${[...PAGE_AREAS].join(", ")}; '${area}' is not one.`,
        });
      try {
        const filed = await fileFeedback(db, {
          account,
          surface: "web",
          area,
          category: body.category ?? "general",
          message: body.message,
          context: body.context ?? null,
          refs,
          followsId: body.follows_id ?? null,
          via: { principal_kind: account.kind ?? "person" },
          from: senderRef(account),
          // Jamie hears about it (2026-09-09): best-effort, never in the
          // way of the row that was just written.
          notifyOwner,
        });
        return json(200, {
          ok: true,
          feedback_id: filed.feedback_id,
          area: filed.area,
          refs: filed.refs,
          dropped: filed.dropped,
        });
      } catch (err) {
        return refused(err);
      }
    },

    // The one queue (0204): every area, newest first or the backlog
    // oldest first, paged by id, with per-area counts.
    "GET /api/admin/feedback": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      const q = event.queryStringParameters ?? {};
      try {
        const page = await feedbackQueue(db, {
          area: q.area || null,
          status: q.status || null,
          category: q.category || null,
          unanswered: q.unanswered === "1" || q.unanswered === "true",
          before: q.before ?? null,
          after: q.after ?? null,
          oldestFirst: q.order === "oldest",
          limit: q.limit ?? 100,
        });
        return json(200, {
          feedback: page.items,
          areas: page.areas,
          next: page.next,
        });
      } catch (err) {
        return refused(err);
      }
    },

    "GET /api/admin/feedback/*": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      try {
        return json(200, { feedback: await feedbackItem(db, event.pathParam) });
      } catch (err) {
        return refused(err);
      }
    },

    // An answer: a status, usually words, and what shipped. New words are
    // news to the filer again (their pending hint, a timeline event, and
    // for a person the feedback_answer email); a status alone is not.
    "POST /api/admin/feedback": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account?.isAdmin) return json(403, { error: "not_entitled" });
      try {
        const out = await answerFeedback(db, {
          feedbackId: body.feedback_id,
          status: body.status,
          response: body.response ?? null,
          shippedIn: body.shipped_in,
          relatedTools: body.related_tools,
          expected: body.expected ?? undefined,
        });
        if (!out.updated)
          return body.expected
            ? json(409, {
                error: "changed",
                message:
                  "The item is not as you last read it; reload it and answer again.",
              })
            : json(404, { error: "no_feedback" });
        return json(200, { ok: true, answered: out.answered });
      } catch (err) {
        return refused(err);
      }
    },
  };
}
