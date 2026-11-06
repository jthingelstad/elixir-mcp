/** tracking_report, "Your friends this week": the builder is shared with
 *  Home's Friends (@elixir-mcp/tools/friends-week), so the page and the mail
 *  say the same week; the mail reads the tools the way every builder does. */
import { buildFriendsWeek } from "@elixir-mcp/tools/friends-week";
import { callTool } from "./ctx.mjs";

export const buildTracking = (args) => buildFriendsWeek({ ...args, callTool });
