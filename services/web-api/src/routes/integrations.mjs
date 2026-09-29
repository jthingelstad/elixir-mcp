import {
  administerIntegration,
  listIntegrations,
} from "@elixir-mcp/auth/integrations";
import { json } from "../http.mjs";

/** The admin door onto integration accounts; what the actions do is
 *  @elixir-mcp/auth's, shared with the migrate Lambda's ops. */
export function integrationsRoutes({ resolveAccount, logEvent, mintToken }) {
  const authorized = async (db, event) => {
    const a = await resolveAccount(db, event, {
      requireContractHeader: event.requestContext?.http?.method !== "GET",
    });
    return a?.isAdmin && a.kind === "person" ? a : null;
  };
  return {
    "GET /api/admin/integrations": async (db, event) => {
      if (!(await authorized(db, event)))
        return json(403, { error: "admin_required" });
      return json(200, { integrations: await listIntegrations(db) });
    },
    "POST /api/admin/integrations": async (db, event, body) => {
      const admin = await authorized(db, event);
      if (!admin) return json(403, { error: "admin_required" });
      const { status, body: answer } = await administerIntegration(
        db,
        admin.accountId,
        body,
        { mintToken, logEvent },
      );
      return json(status, answer);
    },
  };
}
