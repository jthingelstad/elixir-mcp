/**
 * The website's own reads (2026-11-28). Jamie: "API calls that are part of
 * the user USING Elixir are just part of site usage, and should not be
 * logged in the database ... it isn't a quota and is NOT part of the
 * product." So the app's tool reads (the bridge, Stats' door, Home's
 * panels) go through the record reader, which writes no call-log row, and
 * each one leaves an operational line on stdout instead. The MCP door's
 * log and quota are the product and stay where they are.
 */

import { checkRateLimit } from "@elixir-mcp/auth";
import { makeRecordReader } from "@elixir-mcp/tools/invoker";

import { toolDeadlineMs } from "./deadline.mjs";

/** The website's own hourly guard, per person: an abuse bound for someone
 *  tapping around Find, player pages and Stats, not a product quota. Its
 *  own bucket, so the site never spends what a person's MCP clients have
 *  (`mcp#`, the MCP door's) and they never spend the site's. */
export const WEB_HOURLY_RATE_LIMIT = 300;

/** One charge on the website's hourly bucket; false when it is full. */
export function webRate(db, account) {
  return checkRateLimit(db, {
    bucket: `web#${account.accountId}`,
    max: WEB_HOURLY_RATE_LIMIT,
  });
}

const SERVER_SIDE = new Set(["internal", "timeout", "query_timeout"]);

/**
 * A reader for the website's own tool reads: the same registry, tools and
 * deadline as the MCP door, no call-log row, no capture, no request id and
 * no pending hints. One line per read, `{ at: "web_read", door, tool, ms,
 * db_ms, db_queries, code? }`, with the request's id to join the handler's
 * request line. Never a tag, a name, an account id or the arguments.
 */
export function makeWebReader({
  db,
  account,
  registry,
  event,
  door,
  requestId = null,
}) {
  return makeRecordReader({
    db,
    account,
    registry,
    surface: "web",
    // Every read-only tool races the request's deadline, as at /mcp.
    deadlineMs: toolDeadlineMs(event),
    onRead: (tool, how) =>
      // A tool's own refusal (no such player, bad arguments) is an answer;
      // a timeout or an internal failure is the server's, and a warn.
      (SERVER_SIDE.has(how.code) ? console.warn : console.info)(
        JSON.stringify({
          at: "web_read",
          door,
          tool,
          ...how,
          ...(requestId ? { request_id: requestId } : {}),
        }),
      ),
  });
}
