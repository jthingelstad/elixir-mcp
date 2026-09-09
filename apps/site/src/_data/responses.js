// A real, validated envelope keeps the guide and the producer in agreement.
import { responseMeta } from "@elixir-mcp/contracts";
export default {
  example: responseMeta({
    as_of: "2026-09-08T12:34:56.000Z",
    recorded_since: "2026-03-07T00:00:00.000Z",
    recording_active_since: "2026-09-01T00:00:00.000Z",
    freshness_seconds: 61,
    source_polls: {
      player_battlelog: {
        observed_at: "2026-09-08T12:33:55.000Z",
        freshness_seconds: 61,
      },
    },
    timezone_applied: "America/Chicago",
    events_pending: 2,
    request_id: "4c641bc4-0000-4000-8000-000000000001",
  }),
};
