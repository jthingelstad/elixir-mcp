/** Lambda entrypoint: EventBridge tick -> plan -> SQS bulk lane. */

import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { makeHandler } from "./handler.mjs";

const sqs = new SQSClient({});

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  // SQS returns HTTP 200 with per-entry Failed results - a batch that
  // "succeeded" can still have dropped jobs (sol-6 F5). Return the
  // failures so the handler can un-plan them.
  sendJobs: async (jobs) => {
    const failed = [];
    for (let i = 0; i < jobs.length; i += 10) {
      const batch = jobs.slice(i, i + 10);
      const res = await sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: process.env.BULK_QUEUE_URL,
          Entries: batch.map((job, n) => ({
            Id: String(n),
            MessageBody: JSON.stringify(job),
          })),
        }),
      );
      for (const f of res.Failed ?? []) {
        const job = batch[Number(f.Id)];
        if (job) failed.push(job);
        console.error("send_failed", f.Code, f.Message, job?.entity_key);
      }
    }
    return failed;
  },
});
