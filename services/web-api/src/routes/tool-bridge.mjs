import {
  TOOL_GROUPS,
  normalizeTag,
  InvalidTagError,
} from "@elixir-mcp/contracts";
import { checkRateLimit } from "@elixir-mcp/auth";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { HOURLY_RATE_LIMIT } from "@elixir-mcp/tools/quota";
import {
  renderToolResultText,
  MCP_RESULT_MAX_CHARS,
} from "@elixir-mcp/tools/result-text";

import { json } from "../http.mjs";
import { toolDeadlineMs } from "../deadline.mjs";

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
 * one it follows (a friend claim). A watched player, or anyone else, is not.
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
  /** One tool read through the bridge, for a signed-in account. */
  async function bridge(db, event, account, tool, args) {
    const registry = toolRegistry();
    if (!registry.has(tool) || !bridgeable(tool)) return notBridged(tool);
    // The hourly bucket /mcp uses (handler.mjs), the same one: a person's
    // own web reads are not a tier, but they are not unbounded either.
    // No daily tool-call quota here (Jamie, 2026-10-12, #538): the
    // app's own reads spend none of `mcpday#`. The call
    // is still written to the log (surface "web"), and Usage counts it
    // apart from the budget. Not `firstParty`: that would lift the live
    // lane too (tools/shared.mjs liveBudgetFor), which stays metered.
    const withinRate = await checkRateLimit(db, {
      bucket: `mcp#${account.accountId}`,
      max: HOURLY_RATE_LIMIT,
    });
    if (!withinRate) return json(429, { error: "rate_limited" });
    const invoke = makeInvoker({
      db,
      account,
      registry,
      surface: "web",
      // Every read-only tool races the request's deadline, as at /mcp.
      deadlineMs: toolDeadlineMs(event),
    });
    const result = await invoke(tool, args);
    // One result cap for every door: over it, the same bounded failure
    // the MCP door returns, never a body the page cannot hold.
    const { text, truncated } = renderToolResultText(
      registry,
      tool,
      result.body,
    );
    return json(200, {
      tool,
      is_error: result.isError === true || truncated,
      body: truncated ? JSON.parse(text) : result.body,
      ...(truncated ? { result_cap_chars: MCP_RESULT_MAX_CHARS } : {}),
    });
  }

  const argsOf = (body) =>
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args
      : {};

  /** The app's own tools (APP_TOOLS), for a signed-in account. */
  async function appTool(db, event, body) {
    const account = await resolveAccount(db, event, {
      requireContractHeader: true,
    });
    if (!account) return json(401, { error: "unauthenticated" });
    const tool = String(body.tool ?? "");
    if (!APP_TOOLS.has(tool)) return notBridged(tool);
    return bridge(db, event, account, tool, argsOf(body));
  }

  return {
    "POST /api/me/tool": appTool,

    // The old path, answered by the same narrowed handler for a browser
    // tab loaded before the 2026-11-14 deploy. Remove it in a later pull
    // request, once no tab can still be holding the old app (pinned by
    // services/web-api/test/tool-bridge.test.mjs).
    "POST /api/explore": appTool,

    // Stats' own door (2026-11-12): the bridge, for a player the account
    // holds or follows only. Everything from the game stays open to every
    // member on the player page; Stats, the season read back, is yours and
    // your follows'. Refused before any tool runs.
    "POST /api/me/stats": async (db, event, body) => {
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
      // An agent's end user would read past the one player.
      if ("on_behalf_of" in args)
        return json(400, {
          error: "bad_request",
          message: "Stats reads one player, named by player_tag.",
        });
      if (tool === "war_current") {
        // The clan's race, which names no player.
        if ("player_tag" in args)
          return json(400, {
            error: "bad_request",
            message: "war_current takes a clan_tag only.",
          });
        return bridge(db, event, account, tool, args);
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
      return bridge(db, event, account, tool, { ...args, player_tag: tag });
    },
  };
}
