import { makeInvoker } from "../../../mcp/src/invoker.mjs";

import { json } from "../http.mjs";

export function exploreRoutes({ resolveAccount, exploreRegistry, track }) {
  return {
    "POST /api/explore": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const tool = String(body.tool ?? "");
      const registry = exploreRegistry();
      if (!registry.has(tool) || tool === "live_fetch") {
        return json(400, {
          error: "bad_request",
          message: `Unknown or non-explorable tool: ${tool}`,
        });
      }
      const invoke = makeInvoker({
        db,
        account,
        registry,
        surface: "web",
        track,
      });
      const args = body.args && typeof body.args === "object" ? body.args : {};
      const result = await invoke(tool, args);
      return json(200, {
        tool,
        is_error: result.isError === true,
        body: result.body,
      });
    },
  };
}
