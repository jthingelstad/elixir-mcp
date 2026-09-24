/**
 * Ledger health as CloudWatch Embedded Metric Format (EMF) on stdout.
 *
 * Why not the CloudWatch API: the scheduler runs in a NAT-free VPC with only
 * an S3 endpoint (no CloudWatch interface endpoint), so an awaited
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
 * infra/template.yaml (OldestQueuedAgeSeconds, DeadJobs). Those two are the
 * only declared metrics: a custom metric is billed per hour it reports, and
 * the rest of the line has no alarm, so it rides as plain properties that
 * Logs Insights can still read (2026-09-24, "every custom metric has a
 * reader").
 */

const NAMESPACE = "ElixirMCP/Ledger";

/** Build one EMF log line (a single JSON object, no embedded newlines) from a
 *  ledgerStats() row. Pure and synchronous. */
export function ledgerEmf(stats, now = Date.now(), plan = {}) {
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
          ],
        },
      ],
    },
    OldestQueuedAgeSeconds: stats.oldest_queued_s ?? 0,
    DeadJobs: stats.dead ?? 0,
    QueuedJobs: (stats.queued_bulk ?? 0) + (stats.queued_live ?? 0),
    // Planner counters: what the tick planned; how many battlelog reads
    // were the session clock's 30-minute follow-up (the player was
    // playing at the last read; 2026-09-19); how many were due ONLY
    // because of the reader cap.
    PlannedJobs: plan.planned ?? 0,
    SessionFollowupJobs: plan.followup ?? 0,
    ReadCappedJobs: plan.read_capped ?? 0,
    RequestedProfileJobs: plan.requested ?? 0,
    // Subjects held back because the API's last word was 404
    // (2026-09-19): the fetches the backoff is not spending. A log
    // property, not a metric: no panel, alarm or runbook read it.
    NotFoundHeld: plan.not_found_held ?? 0,
    FetchesHour: stats.fetches_hour ?? 0,
    FetchErrorsHour: stats.fetch_errors_hour ?? 0,
    CeilingHour: stats.ceiling_hour ?? 0,
    Tokens: stats.tokens ?? 0,
    CollectorsActive: stats.collectors_active ?? 0,
    CollectorsDraining: stats.collectors_draining ?? 0,
  });
}

/** Emit one ledger sample. Synchronous and network-free by construction, so it
 *  can never hold a scheduler tick open. `write` is injectable for tests. */
export function emitLedgerMetrics(
  stats,
  write = (line) => process.stdout.write(line),
  plan = {},
) {
  write(`${ledgerEmf(stats, Date.now(), plan)}\n`);
}
