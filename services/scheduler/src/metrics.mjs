/**
 * Ledger health as CloudWatch Embedded Metric Format (EMF) on stdout.
 *
 * Why not the CloudWatch API: the scheduler runs in a NAT-free VPC with only
 * SQS + S3 endpoints (no CloudWatch interface endpoint), so an awaited
 * PutMetricData call has no network path and hung every tick to the 50s Lambda
 * timeout (issue #1). EMF rides the Lambda log-delivery path, which is
 * out-of-band from the function's VPC ENI, so it always reaches CloudWatch and
 * cannot block the tick.
 *
 * Why process.stdout.write and not console.log: the scheduler uses the default
 * Text log format, under which console.* is prefixed with a timestamp/request
 * id that would corrupt the EMF JSON. A raw stdout write is emitted verbatim as
 * one log event. Keep this function on the Text log format; switching it to
 * JSON structured logging would wrap the line and break EMF extraction.
 *
 * Metric names, namespace, and (absent) dimensions must match the alarms in
 * infra/template.yaml (OldestQueuedAgeSeconds, DeadJobs).
 */

const NAMESPACE = "ElixirMCP/Ledger";

/** Build one EMF log line (a single JSON object, no embedded newlines) from a
 *  ledgerStats() row. Pure and synchronous. */
export function ledgerEmf(stats, now = Date.now()) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [[]],
          Metrics: [
            { Name: "OldestQueuedAgeSeconds", Unit: "Seconds" },
            { Name: "DeadJobs", Unit: "Count" },
            { Name: "QueuedJobs", Unit: "Count" },
          ],
        },
      ],
    },
    OldestQueuedAgeSeconds: stats.oldest_queued_s ?? 0,
    DeadJobs: stats.dead ?? 0,
    QueuedJobs: (stats.queued_bulk ?? 0) + (stats.queued_live ?? 0),
  });
}

/** Emit one ledger sample. Synchronous and network-free by construction, so it
 *  can never hold a scheduler tick open. `write` is injectable for tests. */
export function emitLedgerMetrics(
  stats,
  write = (line) => process.stdout.write(line),
) {
  write(`${ledgerEmf(stats)}\n`);
}
