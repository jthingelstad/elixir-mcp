/**
 * The site API's two deadlines, one inside the other.
 *
 * The handler's soft deadline sits under the Lambda timeout by a margin
 * that covers writing the log line and ending the client; past it the
 * handler answers 504 itself. Outside Lambda (tests, no context) there is
 * no deadline unless the caller supplies one.
 *
 * A route that runs a tool (Explore, the /api/v1 person and integration
 * operations) hands the invoker a deadline a reply margin inside the soft
 * one, so every read-only tool races it as it does at /mcp and answers
 * query_timeout with a request id and an audit row, instead of running on
 * unbounded until the handler gives up on it (review 2026-09-27 §3.2).
 */

const DEADLINE_MARGIN_MS = 1500;
/** Time the tool path keeps back for the invoker's restore, the audit
 *  row and rendering, so its answer beats the handler's 504. */
const TOOL_REPLY_MARGIN_MS = 1500;

export function deadlineMs(context, event = null) {
  if (typeof context?.getRemainingTimeInMillis !== "function") return null;
  const model =
    /^\/api\/clan\/clans\/[0-9A-Za-z]{3,12}\/(?:model|.*\/draft)$/.test(
      event?.rawPath ?? event?.path ?? "",
    ) && (event?.requestContext?.http?.method ?? event?.httpMethod) !== "GET";
  const remaining = context.getRemainingTimeInMillis();
  return Math.max(
    (model ? remaining : Math.min(remaining, 20_000)) - DEADLINE_MARGIN_MS,
    1,
  );
}

/** The invoker's deadlineMs for a tool run inside this request, or null
 *  when the request has no soft deadline (the handler sets
 *  event.softDeadlineAt from the Lambda context). */
export function toolDeadlineMs(event) {
  const at = event?.softDeadlineAt;
  if (typeof at !== "number") return null;
  return Math.max(1, at - Date.now() - TOOL_REPLY_MARGIN_MS);
}
