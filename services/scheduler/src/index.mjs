/** Lambda entrypoint: EventBridge tick -> plan -> SQS bulk lane. */

import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { makeHandler } from './handler.mjs';

const sqs = new SQSClient({});

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  sendJobs: async (jobs) => {
    for (let i = 0; i < jobs.length; i += 10) {
      const batch = jobs.slice(i, i + 10);
      await sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: process.env.BULK_QUEUE_URL,
          Entries: batch.map((job, n) => ({ Id: String(n), MessageBody: JSON.stringify(job) })),
        }),
      );
    }
  },
});
