import { json } from "../http.mjs";

// The collector door has its own Lambda (services/collector) since
// 2026-09-29, and the site API routes /api/collector/* to it. These stay
// only until that route has carried the fleet through a deploy, so no
// request falls between the two; then they and the web-api role's
// payloads/ grant go.
export function collectorRoutes({ collectorDoor }) {
  return {
    "GET /api/collector/config": async (db, event) => {
      if (!collectorDoor) return json(503, { error: "unavailable" });
      const r = await collectorDoor.config(db, event);
      return json(r.status, r.body, r.headers ?? {});
    },

    "POST /api/collector/lease": async (db, event, body) => {
      if (!collectorDoor) return json(503, { error: "unavailable" });
      const r = await collectorDoor.lease(db, event, body);
      return json(r.status, r.body, r.headers ?? {});
    },

    "POST /api/collector/submit": async (db, event, body) => {
      if (!collectorDoor) return json(503, { error: "unavailable" });
      const r = await collectorDoor.submit(db, event, body);
      return json(r.status, r.body, r.headers ?? {});
    },
  };
}
