/** Lambda entrypoint: EventBridge tick -> plan -> job ledger. */

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { makeHandler } from "./handler.mjs";

const cw = new CloudWatchClient({});

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  putMetrics: async (stats) => {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: "ElixirMCP/Ledger",
        MetricData: [
          {
            MetricName: "OldestQueuedAgeSeconds",
            Value: stats.oldest_queued_s,
            Unit: "Seconds",
          },
          { MetricName: "DeadJobs", Value: stats.dead, Unit: "Count" },
          {
            MetricName: "QueuedJobs",
            Value: stats.queued_bulk + stats.queued_live,
            Unit: "Count",
          },
        ],
      }),
    );
  },
});
