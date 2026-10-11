import {
  FEEDBACK_AREAS,
  FEEDBACK_STATUSES,
  responseMeta,
} from "@elixir-mcp/contracts";
import {
  FeedbackError,
  itemMine,
  listMine,
  markSeen,
} from "@elixir-mcp/feedback";
import {
  ToolFailure,
  VERBOSITY,
  appliedBlock,
  docsRef,
  notes,
} from "../shared.mjs";
import { FEEDBACK_PAGE_MAX_CHARS } from "./common.mjs";

/** A compact row's title: the message's first non-empty line, cut. */
const TITLE_MAX = 120;
function titleOf(message) {
  const line =
    String(message ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line.length > TITLE_MAX
    ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : line;
}

/** What a full row carries: the item as filed and as answered. */
function fullRow(r) {
  return {
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
  };
}

/** The listing (11.10.0, feedback #378): what is open and what shipped,
 *  without either body. A response is not delivered here, so it is not
 *  marked seen. */
function compactRow(r) {
  const related = r.refs.filter((x) => x.kind === "feedback").map((x) => x.ref);
  return {
    feedback_id: r.feedback_id,
    created_at: r.created_at,
    area: r.area,
    category: r.category,
    title: titleOf(r.message),
    status: r.status,
    follows_id: r.follows_id ?? null,
    ...(related.length ? { related_ids: related } : {}),
    has_response: r.response !== null && r.response !== undefined,
    responded_at: r.responded_at,
    shipped_in: r.shipped_in,
  };
}

export const elixir_my_feedback = {
  description:
    "Your feedback and what happened to it: status (new/seen/planned/needs_info/done/declined), the maintainer's response, and ship links (shipped_in contract version, related_tools). needs_info is a question for you: reply with elixir_send_feedback follows_id. Every item you filed anywhere in Elixir is here. compact lists without bodies; feedback_id reads one item whole. Pages are bounded: pass next_offset as offset until null. Only responses delivered are marked seen. Poll only when meta.feedback_responses_pending says something is new.",
  inputSchema: {
    type: "object",
    properties: {
      feedback_id: {
        type: "string",
        pattern: "^[1-9][0-9]{0,17}$",
        description:
          "Read one of your items whole (11.10.0): message, response, refs, and the items that reply to it (followed_by) or name it as related (related_by). Its response is marked seen. The list filters are ignored.",
      },
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
        description: `Only items about one part of Elixir (11.3.0): ${FEEDBACK_AREAS.join(", ")}.`,
      },
      verbosity: VERBOSITY(
        "each item's id, created_at, area, category, title (the message's first line), status, follows_id, related_ids, has_response, responded_at and shipped_in, with no message or response bodies; nothing is marked seen. Read one whole with feedback_id.",
      ),
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const asOf = new Date().toISOString();
    if (args.feedback_id !== undefined) {
      let item;
      try {
        item = await itemMine(ctx.db, ctx.account.accountId, args.feedback_id);
      } catch (err) {
        if (err instanceof FeedbackError)
          throw new ToolFailure(
            err.status === 404 ? "not_found" : "bad_request",
            err.message,
            "Pass a feedback_id from your own listing (elixir_my_feedback).",
          );
        throw err;
      }
      return {
        applied: appliedBlock({ feedback_id: args.feedback_id }),
        feedback: [
          {
            ...fullRow(item),
            followed_by: item.followed_by.map(String),
            related_by: item.related_by.map(String),
          },
        ],
        total: 1,
        next_offset: null,
        notes: notes(
          ...(item.status === "needs_info"
            ? [
                `The maintainer asked you a question: reply with elixir_send_feedback({ follows_id: ${item.feedback_id}, message }).`,
              ]
            : []),
        ),
        docs: docsRef("protocol", "feedback-and-the-changelog-over-the-wire"),
        meta: responseMeta({ as_of: asOf }),
      };
    }

    const compact = args.verbosity === "compact";
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
    const mapped = listed.items.map(compact ? compactRow : fullRow);
    const page = [];
    const askingIn = (feedback) =>
      feedback.filter((r) => r.status === "needs_info");
    const bodyFor = (feedback) => ({
      applied: appliedBlock({
        limit,
        offset,
        status: args.status,
        since: args.since,
        area: args.area,
        verbosity: compact ? "compact" : undefined,
      }),
      feedback,
      total,
      next_offset:
        offset + feedback.length < total ? offset + feedback.length : null,
      notes: notes(
        "Pages are bounded by delivered size as well as limit; pass next_offset as offset until it is null.",
        ...(compact
          ? [
              "compact: no message or response is delivered, so no response is marked seen; read one with feedback_id.",
            ]
          : []),
        ...(askingIn(feedback).length
          ? [
              `needs_info: the maintainer asked a question on ${askingIn(
                feedback,
              )
                .map((r) => `#${r.feedback_id}`)
                .join(", ")}; reply with elixir_send_feedback follows_id.`,
            ]
          : []),
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

    // A response is acknowledged only after it has made this bounded page,
    // and only when the page carried it: a compact page delivers none.
    // The old account-wide UPDATE could clear the pending hint for replies
    // omitted by limit, and even for a whole result rejected at the wire cap.
    if (!compact)
      await markSeen(
        ctx.db,
        ctx.account.accountId,
        page.map((row) => row.feedback_id),
      );
    return body;
  },
};
