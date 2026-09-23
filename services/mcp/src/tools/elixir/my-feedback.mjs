import { responseMeta } from "@elixir-mcp/contracts";
import { appliedBlock, docsRef, notes } from "../shared.mjs";
import { FEEDBACK_PAGE_MAX_CHARS } from "./common.mjs";

export const elixir_my_feedback = {
  description:
    "Your feedback and what happened to it: status (new/seen/planned/done/declined), the maintainer's response, and ship links (shipped_in contract version, related_tools). Results are bounded pages: pass next_offset as offset until null. Only responses delivered on this page are marked seen. Poll only when meta.feedback_responses_pending says something is new.",
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
        enum: ["new", "seen", "planned", "done", "declined"],
      },
      since: {
        type: "string",
        description: "ISO instant; only items filed after this.",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
    const offset = Math.max(Number(args.offset ?? 0), 0);
    const params = [ctx.account.accountId];
    const where = ["account_id = $1"];
    if (args.status) {
      params.push(args.status);
      where.push(`status = $${params.length}`);
    }
    if (args.since) {
      params.push(args.since);
      where.push(`created_at > $${params.length}`);
    }
    const {
      rows: [{ total }],
    } = await ctx.db.query(
      `select count(*)::int as total from feedback where ${where.join(" and ")}`,
      params,
    );
    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;
    const { rows } = await ctx.db.query(
      `select feedback_id, surface, category, message, status,
                response, responded_at, created_at, shipped_in, related_tools,
                request_id
         from feedback where ${where.join(" and ")}
         order by feedback_id desc limit $${limitParam} offset $${offsetParam}`,
      params,
    );
    const mapped = rows.map((r) => ({
      feedback_id: r.feedback_id,
      created_at: r.created_at.toISOString(),
      surface: r.surface,
      category: r.category,
      message: r.message,
      status: r.status,
      response: r.response,
      responded_at: r.responded_at?.toISOString() ?? null,
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
    const deliveredIds = page.map((row) => row.feedback_id);
    if (deliveredIds.length > 0) {
      await ctx.db.query(
        `update feedback set response_seen_at = now()
           where account_id = $1 and feedback_id = any($2::bigint[])
             and responded_at is not null and response_seen_at is null`,
        [ctx.account.accountId, deliveredIds],
      );
    }
    return body;
  },
};
