/** Lambda entrypoint: EventBridge tick -> plan -> job ledger. */

import { makeHandler } from "./handler.mjs";
import { emitLedgerMetrics } from "./metrics.mjs";

// Ledger health goes out as CloudWatch EMF on stdout, never the CloudWatch API:
// the NAT-free VPC has no CloudWatch endpoint, so an awaited PutMetricData call
// hung every tick to the 50s timeout (issue #1). See metrics.mjs.
export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  emitMetrics: (stats) => emitLedgerMetrics(stats),
});
