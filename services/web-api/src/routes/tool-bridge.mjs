import {
  TOOL_GROUPS,
  normalizeTag,
  InvalidTagError,
} from "@elixir-mcp/contracts";
import {
  renderToolResultText,
  MCP_RESULT_MAX_CHARS,
} from "@elixir-mcp/tools/result-text";

import { withPlayerConnections } from "../connections.mjs";
import { json } from "../http.mjs";
import { makeWebReader, webRate } from "../web-reads.mjs";

/**
 * The app's own tool calls through the bridge, by name (2026-11-14). The
 * bridge used to open every read-only tool to the browser, a leftover of
 * the Console's Explore page; the app now calls these and nothing else:
 * the player page's Record tab (players_summary, players_profile), Find
 * and the search sheet (players_summary, clans_roster, players_search),
 * and the nickname editor. Any other tool is refused before it runs, as
 * an unknown one is. Stats has its own door and list (STATS_TOOLS).
 */
const APP_READS = new Set([
  "players_summary",
  "players_profile",
  "players_search",
  "clans_roster",
]);

/**
 * The one write the app makes through the bridge: the nickname editor, on
 * a cookie-authenticated, CSRF-checked session, the person's own
 * account:write. Everything else that changes state has its own route or
 * belongs at the MCP door under its OAuth capability.
 */
const APP_WRITES = new Set(["elixir_nickname"]);

const APP_TOOLS = new Set([...APP_READS, ...APP_WRITES]);

/** What the bridge runs for any door: a read-only tool, or the app's one
 *  write. Never the live lane. Each door narrows it with its own list. */
function bridgeable(tool) {
  const cls = TOOL_GROUPS[tool];
  if (!cls || tool === "live_fetch") return false;
  return cls.readOnly || APP_WRITES.has(tool);
}

const notBridged = (tool) =>
  json(400, {
    error: "bad_request",
    message: `Unknown or non-explorable tool: ${tool}`,
  });

/**
 * Stats (You's last tab) reads its season through these tools only, each
 * for one player (Jamie, 2026-11-12: "Stats opens for the players you
 * follow"). war_current names the player's clan and no player.
 */
const STATS_TOOLS = new Set([
  "players_summary",
  "battles_performance",
  "battles_decks",
  "battles_cards",
  "battles_opponents",
  "battles_query",
  "elixir_coverage",
  "war_current",
  "war_history",
]);

/**
 * Whether Stats may open `tag` for this account: one of its own players or
 * one it follows (a friend claim). A followed player, or anyone else, is not.
 * One tag per read, by equality; never a list.
 */
async function statsOpens(db, accountId, tag) {
  const { rows } = await db.query(
    `select 1 from claim
      where account_id = $1 and player_tag = $2
        and (is_primary or relationship in ('primary', 'alt', 'friend'))`,
    [accountId, tag],
  );
  return rows.length > 0;
}

export function toolBridgeRoutes({ resolveAccount, toolRegistry }) {
  /** One tool read through the bridge, for a signed-in account. `door`
   *  names it on the log line: "tool" (the app's) or "stats". */
  async function bridge(db, event, context, account, tool, args, door) {
    const registry = toolRegistry();
    if (!registry.has(tool) || !bridgeable(tool)) return notBridged(tool);
    // The website's own hourly guard (web-reads.mjs), never the bucket a
    // person's MCP clients spend: the site's reads are site usage, not a
    // tool call (Jamie, 2026-11-28). No daily tool-call quota either, and
    // no call-log row. Not `firstParty`: that would lift the live lane too
    // (tools/shared.mjs liveBudgetFor), and the bridge never runs it.
    if (!(await webRate(db, account)))
      return json(429, { error: "rate_limited" });
    const invoke = makeWebReader({
      db,
      account,
      registry,
      event,
      door,
      requestId: context?.requestId ?? null,
    });
    const result = await invoke(tool, args);
    // One result cap for every door: over it, the same bounded failure
    // the MCP door returns, never a body the page cannot hold.
    const { text, truncated } = renderToolResultText(
      registry,
      tool,
      result.body,
    );
    const body =
      !truncated && !result.isError && tool === "players_search"
        ? await withPlayerConnections(db, account.accountId, result.body)
        : truncated
          ? JSON.parse(text)
          : result.body;
    return json(200, {
      tool,
      is_error: result.isError === true || truncated,
      body,
      ...(truncated ? { result_cap_chars: MCP_RESULT_MAX_CHARS } : {}),
    });
  }

  const argsOf = (body) =>
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args
      : {};

  /** The app's own tools (APP_TOOLS), for a signed-in account. */
  async function appTool(db, event, body, context) {
    const account = await resolveAccount(db, event, {
      requireContractHeader: true,
    });
    if (!account) return json(401, { error: "unauthenticated" });
    const tool = String(body.tool ?? "");
    if (!APP_TOOLS.has(tool)) return notBridged(tool);
    return bridge(db, event, context, account, tool, argsOf(body), "tool");
  }

  return {
    "POST /api/me/tool": appTool,

    // Stats' own door (2026-11-12): the bridge, for a player the account
    // holds or follows only. Everything from the game stays open to every
    // member on the player page; Stats, the season read back, is yours and
    // your follows'. Refused before any tool runs.
    "POST /api/me/stats": async (db, event, body, context) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const tool = String(body.tool ?? "");
      const args = argsOf(body);
      if (!STATS_TOOLS.has(tool))
        return json(400, {
          error: "bad_request",
          message: `Stats does not read ${tool || "that"}.`,
        });
      if (tool === "war_current") {
        // The clan's race, which names no player.
        if ("player_tag" in args)
          return json(400, {
            error: "bad_request",
            message: "war_current takes a clan_tag only.",
          });
        return bridge(db, event, context, account, tool, args, "stats");
      }
      let tag;
      try {
        tag = normalizeTag(String(args.player_tag ?? ""));
      } catch (err) {
        if (err instanceof InvalidTagError)
          return json(400, { error: "invalid_tag" });
        throw err;
      }
      if (!(await statsOpens(db, account.accountId, tag)))
        return json(403, {
          error: "not_followed",
          message:
            "Stats opens for your own players and the players you follow.",
        });
      return bridge(
        db,
        event,
        context,
        account,
        tool,
        { ...args, player_tag: tag },
        "stats",
      );
    },
  };
}
