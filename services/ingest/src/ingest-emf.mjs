/**
 * One EMF line per collector submission the door ingested (2026-09-17,
 * for the elixir-mcp dashboard's admission widget): admitted, rejected
 * or duplicate, what the fetch was worth (the projection's new_facts,
 * 0077) and the transaction's wall time. No dimensions: an endpoint
 * breakdown is a Logs Insights query over the same line, not a metric
 * per endpoint. Written to the web-api Lambda's stdout by the door
 * (the Text log format; a raw write is one verbatim log event, the
 * scheduler's metrics.mjs explains why not console.log). The replay
 * lane in the migrate Lambda does not emit it: history landing is not
 * pace.
 */

const NAMESPACE = "ElixirMCP/Ingest";

export function ingestEmf(result, now = Date.now()) {
  const outcome = result?.outcome ?? "unknown";
  const facts = Number.isInteger(result?.projection?.facts)
    ? result.projection.facts
    : 0;
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [[]],
          Metrics: [
            { Name: "Admitted", Unit: "Count" },
            { Name: "Rejected", Unit: "Count" },
            { Name: "Duplicate", Unit: "Count" },
            { Name: "NewFacts", Unit: "Count" },
            { Name: "IngestMs", Unit: "Milliseconds" },
          ],
        },
      ],
    },
    Admitted: outcome === "admitted" ? 1 : 0,
    Rejected: outcome === "rejected" ? 1 : 0,
    Duplicate: outcome === "duplicate" ? 1 : 0,
    NewFacts: facts,
    IngestMs: Number.isFinite(result?.timings?.total_ms)
      ? result.timings.total_ms
      : 0,
    outcome,
    endpoint: result?.endpoint ?? null,
  });
}
