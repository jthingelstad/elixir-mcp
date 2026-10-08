import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_REF_KINDS,
  responseMeta,
} from "@elixir-mcp/contracts";
import { FeedbackError, fileFeedback } from "@elixir-mcp/feedback";
import { senderRef } from "@elixir-mcp/outbox/notify";
import { identityFor } from "../../entitlements.mjs";
import {
  ON_BEHALF_OF_SCHEMA,
  ToolFailure,
  appliedBlock,
  docsRef,
  notes,
} from "../shared.mjs";

/** The door a call came through, as feedback names it: the JSON API
 *  runs this tool for POST /api/v1/feedback (0204). */
const DOOR = {
  mcp: { surface: "mcp", area: "mcp" },
  rest: { surface: "api", area: "api" },
};

const DROP_REASON = {
  not_yours: "not one of yours",
  too_many: "past the 20 a report keeps",
  unknown_kind: "unknown kind",
};

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
        enum: [...FEEDBACK_CATEGORIES],
        default: "general",
        description:
          "data_quality: a fact looks wrong. judgment: Elixir judged someone wrongly (a standing, an award).",
      },
      context: {
        type: "string",
        description:
          "Which tool or question prompted this (e.g. 'battles_query pagination').",
      },
      request_id: {
        type: "string",
        description:
          "The meta.request_id of the call this is about. Every response carries one; passing it here attaches the exact request, its arguments and its answer to the report, so the maintainer can see what you saw. Prefer this over describing the call in words. Only your own calls attach.",
      },
      request_ids: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
        description:
          "Beside request_id (3.18.0): every call this is about when a turn made several; the first becomes request_id when that was omitted, and all of them are kept with the report.",
      },
      refs: {
        type: "array",
        maxItems: 20,
        description:
          "Beside the calls (11.3.0): what else this is about. kind email (a send id from a mail's footer), player or clan (a tag), clan_action, award or policy (Elixir Clan ids). A pointer that is malformed or not yours is dropped and named in notes; the report is kept.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...FEEDBACK_REF_KINDS] },
            ref: { type: "string", maxLength: 120 },
          },
          required: ["kind", "ref"],
          additionalProperties: false,
        },
      },
      follows_id: {
        type: "integer",
        minimum: 1,
        description:
          "Replying to an answer (11.3.0): the feedback_id of your own item this follows, so the thread reads as one.",
      },
      on_behalf_of: {
        ...ON_BEHALF_OF_SCHEMA,
        description:
          "Agent connections: the person on your surface this feedback came from (e.g. discord:1234), when you relay theirs. Kept with the report so the maintainer sees it was theirs; the answer still comes to you.",
      },
    },
    required: ["message"],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    if (
      args.category !== undefined &&
      !FEEDBACK_CATEGORIES.includes(args.category)
    )
      throw new ToolFailure(
        "bad_request",
        `Unknown category '${args.category}'.`,
        `Valid categories: ${FEEDBACK_CATEGORIES.join(", ")}.`,
      );
    // A malformed or foreign id loses the attachment, never the report:
    // the words are the valuable half and an agent that guessed the
    // shape of an id should still be heard.
    const requestIds = [
      ...(args.request_id ? [args.request_id] : []),
      ...(Array.isArray(args.request_ids) ? args.request_ids : []),
    ].map((v) => String(v));
    const refs = [
      ...requestIds.map((ref) => ({ kind: "call", ref })),
      ...(Array.isArray(args.refs) ? args.refs : []),
    ];
    const a = ctx.account;
    const door = DOOR[ctx.surface] ?? DOOR.mcp;
    const onBehalfOf =
      a.kind === "agent" && typeof args.on_behalf_of === "string"
        ? args.on_behalf_of.trim().slice(0, 200) || null
        : null;
    // The relayed person's player, when the agent has mapped them: the
    // maintainer reads who it was without asking the agent.
    const relayedPlayer = onBehalfOf
      ? await identityFor(ctx.db, a.accountId, onBehalfOf).catch(() => null)
      : null;
    let filed;
    try {
      filed = await fileFeedback(ctx.db, {
        account: a,
        surface: door.surface,
        area: door.area,
        category: args.category ?? "general",
        message: args.message,
        context: args.context ? String(args.context) : null,
        refs,
        followsId: args.follows_id ?? null,
        via: {
          principal_kind: a.kind ?? "person",
          client_name: ctx.clientName ?? null,
          request_id: ctx.requestId ?? null,
          on_behalf_of: onBehalfOf,
          player_tag: relayedPlayer,
        },
        from: senderRef(a),
        // Jamie hears about it (2026-09-09): best-effort, after the row is
        // durable, never for the owner's own or an agent the owner runs.
        notifyOwner: ctx.notifyOwner ?? null,
      });
    } catch (err) {
      if (err instanceof FeedbackError)
        throw new ToolFailure("bad_request", err.message, err.hint);
      throw err;
    }
    const calls = filed.refs.filter((r) => r.kind === "call").map((r) => r.ref);
    const others = filed.refs.filter((r) => r.kind !== "call");
    const said = [
      "Received; feedback is reviewed and drives the roadmap. elixir_my_feedback shows the response when it lands, and meta.feedback_responses_pending on any call says when.",
    ];
    if (filed.dropped.length)
      said.push(
        `Not attached: ${filed.dropped
          .map(
            (d) =>
              `${d.kind} ${d.ref || "(empty)"} (${DROP_REASON[d.reason] ?? "not a valid id"})`,
          )
          .join("; ")}. The report itself was kept.`,
      );
    return {
      ok: true,
      feedback_id: filed.feedback_id,
      applied: appliedBlock({
        category: filed.category,
        request_id: calls[0] ?? undefined,
        request_ids: calls.length ? calls : undefined,
        refs: others.length ? others : undefined,
        follows_id: filed.follows_id ?? undefined,
        on_behalf_of: onBehalfOf ?? undefined,
      }),
      notes: notes(...said),
      docs: docsRef("protocol", "feedback-and-the-changelog-over-the-wire"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
