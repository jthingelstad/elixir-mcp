import {
  FEEDBACK_AREAS,
  FEEDBACK_STATUSES,
  responseMeta,
} from "@elixir-mcp/contracts";
import { FeedbackError, listMine, markSeen } from "@elixir-mcp/feedback";
import { ToolFailure, appliedBlock, docsRef, notes } from "../shared.mjs";
import { FEEDBACK_PAGE_MAX_CHARS } from "./common.mjs";

export const elixir_my_feedback = {
  description:
    "Your feedback and what happened to it: status (new/seen/planned/done/declined), the maintainer's response, and ship links (shipped_in contract version, related_tools). Every item you filed anywhere in Elixir is here, wherever you filed it (area). Results are bounded pages: pass next_offset as offset until null. Only responses delivered on this page are marked seen. Poll only when meta.feedback_responses_pending says something is new.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      offset: {
        type: "integer",
        minimum: 0,
        default: 0,
        description: "Pass the previous page's next_offset.",
      },
      status: {
        type: "string",
        enum: [...FEEDBACK_STATUSES],
      },
      since: {
        type: "string",
        description: "ISO instant; only items filed after this.",
      },
      area: {
        type: "string",
        enum: [...FEEDBACK_AREAS],
        description:
          "Only items about one part of Elixir (11.3.0): mcp, api, console, ladder, clan, mail, docs.",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
    const offset = Math.max(Number(args.offset ?? 0), 0);
    let listed;
    try {
      listed = await listMine(ctx.db, ctx.account.accountId, {
        limit,
        offset,
        status: args.status ?? null,
        since: args.since ?? null,
        area: args.area ?? null,
      });
    } catch (err) {
      if (err instanceof FeedbackError)
        throw new ToolFailure("bad_request", err.message, err.hint);
      throw err;
    }
    const { total } = listed;
    const mapped = listed.items.map((r) => ({
      feedback_id: r.feedback_id,
      created_at: r.created_at,
      surface: r.surface,
      area: r.area,
      category: r.category,
      message: r.message,
      ...(r.refs.length ? { refs: r.refs } : {}),
      ...(r.follows_id ? { follows_id: r.follows_id } : {}),
      status: r.status,
      response: r.response,
      responded_at: r.responded_at,
      shipped_in: r.shipped_in,
      related_tools: r.related_tools,
    }));
    const asOf = new Date().toISOString();
    const page = [];
    const bodyFor = (feedback) => ({
      applied: appliedBlock({
        limit,
        offset,
        status: args.status,
        since: args.since,
        area: args.area,
      }),
      feedback,
      total,
      next_offset:
        offset + feedback.length < total ? offset + feedback.length : null,
      notes: notes(
        "Pages are bounded by delivered size as well as limit; pass next_offset as offset until it is null.",
      ),
      docs: docsRef("protocol", "feedback-and-the-changelog-over-the-wire"),
      meta: responseMeta({ as_of: asOf }),
    });
    for (const row of mapped) {
      const candidate = bodyFor([...page, row]);
      if (
        page.length > 0 &&
        JSON.stringify(candidate).length > FEEDBACK_PAGE_MAX_CHARS
      )
        break;
      page.push(row);
    }
    const body = bodyFor(page);

    // A response is acknowledged only after it has made this bounded page.
    // The old account-wide UPDATE could clear the pending hint for replies
    // omitted by limit, and even for a whole result rejected at the wire cap.
    await markSeen(
      ctx.db,
      ctx.account.accountId,
      page.map((row) => row.feedback_id),
    );
    return body;
  },
};
