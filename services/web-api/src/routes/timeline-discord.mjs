/** The console's Timeline page: the account's timeline cross-posted to
 *  a Discord webhook (0213; Jamie, 2026-10-10). A person's own, or an
 *  agent's through its owner's console (AGENT_SCOPED_ROUTES). Never
 *  served to MCP or /api/v1. The webhook URL is a credential: it comes
 *  in here, is sealed at once, goes out only shortened (settingView),
 *  and is never logged. Saving one turns cross-posting on from now and sends a hello
 *  line, so the owner sees at once that it works. */
import {
  readDiscordSetting,
  saveDiscordSetting,
} from "@elixir-mcp/syndication";
import { settingView } from "@elixir-mcp/syndication/settings";
import { json } from "../http.mjs";

const ERRORS = {
  webhook_invalid:
    "That is not a Discord webhook address. In Discord: channel settings › Integrations › Webhooks › Copy Webhook URL.",
  webhook_required: "Add the Discord webhook to post to.",
};

/** `discord`: { seal, outbox, readStatus } (syndication webhookSeal and
 *  makeStatusReader). Without the sealing secret there is no `seal`, and
 *  nothing can be saved; without the outbox no hello line is sent. */
export function timelineDiscordRoutes({ resolveAccount, discord = null }) {
  return {
    "GET /api/me/timeline/discord": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const row = await readDiscordSetting(db, account.accountId);
      let status = null;
      if (row && discord?.readStatus)
        status = await discord.readStatus(account.accountId).catch(() => null);
      return json(200, settingView(row, status));
    },

    "PUT /api/me/timeline/discord": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      if (!discord?.seal)
        return json(503, {
          error: "discord_unavailable",
          message: "Cross-posting to Discord is not available just now.",
        });
      if (typeof body?.enabled !== "boolean")
        return json(400, { error: "bad_enabled" });
      if (body.url !== undefined && typeof body.url !== "string")
        return json(400, {
          error: "webhook_invalid",
          message: ERRORS.webhook_invalid,
        });
      const out = await saveDiscordSetting(
        db,
        account.accountId,
        { url: body.url, enabled: body.enabled },
        { outbox: discord.outbox ?? null, seal: discord.seal },
      );
      if (out.error)
        return json(400, { error: out.error, message: ERRORS[out.error] });
      return json(200, {
        ...settingView(out.row),
        hello_sent: out.hello === true,
      });
    },
  };
}
