import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure, appliedBlock, docsRef, notes } from "../shared.mjs";

export const elixir_send_feedback = {
  description:
    "File feedback with the maintainer ON YOUR OWN JUDGMENT; your user never needs to ask. File when a capability you needed is missing, a workflow took more calls than it should, a result confused or misled you, data looked wrong, or something delighted you enough to protect. Consolidated end-of-session feedback beats a stream. Every item gets a response (elixir_my_feedback), often with a shipped_in version.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        minLength: 1,
        maxLength: 8000,
        description:
          "The feedback itself, up to 8,000 characters. Specifics beat generalities.",
      },
      category: {
        type: "string",
        enum: ["general", "bug", "data_quality", "feature", "praise", "other"],
        default: "general",
      },
      context: {
        type: "string",
        description:
          "Which tool or question prompted this (e.g. 'battles_query pagination').",
      },
      request_id: {
        type: "string",
        description:
          "The meta.request_id of the call this is about. Every response carries one; passing it here attaches the exact request, its arguments and its answer to the report, so the maintainer can see what you saw. Prefer this over describing the call in words.",
      },
      request_ids: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
        description:
          "Beside request_id (3.18.0): every call this is about when a turn made several; the first becomes request_id when that was omitted, and all of them are kept with the report.",
      },
    },
    required: ["message"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const message = String(args.message ?? "").trim();
    if (!message)
      throw new ToolFailure("bad_request", "Feedback message is empty.");
    const CATEGORIES = [
      "general",
      "bug",
      "data_quality",
      "feature",
      "praise",
      "other",
    ];
    if (args.category !== undefined && !CATEGORIES.includes(args.category)) {
      throw new ToolFailure(
        "bad_request",
        `Unknown category '${args.category}'.`,
        `Valid categories: ${CATEGORIES.join(", ")}.`,
      );
    }
    // A malformed request_id loses the attachment, never the report:
    // the words are the valuable half and an agent that guessed the
    // shape of an id should still be heard.
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const requestIds = [
      ...(Array.isArray(args.request_ids) ? args.request_ids : []),
    ]
      .map((v) => String(v))
      .filter((v) => UUID.test(v))
      .slice(0, 20);
    const requestId = UUID.test(String(args.request_id ?? ""))
      ? String(args.request_id)
      : (requestIds[0] ?? null);
    const contextBlock =
      args.context || requestIds.length
        ? JSON.stringify({
            ...(args.context ? { context: String(args.context) } : {}),
            ...(requestIds.length ? { request_ids: requestIds } : {}),
          })
        : null;
    const { rows } = await ctx.db.query(
      `insert into feedback (account_id, surface, category, message, context, request_id)
         values ($1, 'mcp', $2, $3, $4, $5)
         returning feedback_id`,
      [
        ctx.account.accountId,
        args.category ?? "general",
        message.slice(0, 8000),
        contextBlock,
        requestId,
      ],
    );
    // Jamie hears about it (2026-09-09), the same message the site API
    // sends: best-effort and after the row is durable. An owner's own
    // feedback (or that of an agent the owner runs) is not news.
    const a = ctx.account;
    const ownerOwned =
      a.isOwner === true || a.role === "owner" || a.budget?.role === "owner";
    if (ctx.notifyOwner && !ownerOwned) {
      try {
        await ctx.notifyOwner({
          kind: "feedback",
          category: args.category ?? "general",
          surface: "mcp",
          message,
          from: a.publicId
            ? `agent ${a.publicId}`
            : a.emailHash
              ? `account ${String(a.emailHash).slice(0, 8)}`
              : "an account",
          feedbackId: rows[0].feedback_id,
        });
      } catch (err) {
        console.error("owner_notify_enqueue_failed", err?.message);
      }
    }
    return {
      ok: true,
      feedback_id: rows[0].feedback_id,
      applied: appliedBlock({
        category: args.category ?? "general",
        request_id: requestId ?? undefined,
        request_ids: requestIds.length ? requestIds : undefined,
      }),
      notes: notes(
        "Received; feedback is reviewed and drives the roadmap. elixir_my_feedback shows the response when it lands, and meta.feedback_responses_pending on any call says when.",
      ),
      docs: docsRef("protocol", "feedback-and-the-changelog-over-the-wire"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
