import { json } from "../http.mjs";

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
