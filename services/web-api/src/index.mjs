/** Lambda entrypoint: env wiring + queue-backed email sending (§7 NAT-free:
 *  VPC Lambdas enqueue, the relay sends). Owner notifications go to
 *  elixir@poapkings.com itself — the monitored service mailbox. */

import {
  SQSClient,
  SendMessageCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { makeHandler } from "./handler.mjs";

const sqs = new SQSClient({});
const queueUrl = process.env.EMAIL_QUEUE_URL;

async function enqueueEmail(msg) {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(msg),
    }),
  );
}

const STATUS_QUEUES = [
  ["live", "elixir-mcp-cr-requests-live"],
  ["bulk", "elixir-mcp-cr-requests-bulk"],
  ["results", "elixir-mcp-cr-results"],
  ["live_dlq", "elixir-mcp-cr-requests-live-dlq"],
  ["bulk_dlq", "elixir-mcp-cr-requests-bulk-dlq"],
  ["results_dlq", "elixir-mcp-cr-results-dlq"],
  ["email_dlq", "elixir-mcp-email-dlq"],
];
const queueUrlCache = new Map();

/** Depth + oldest-message age per pipeline queue. Any failure yields
 *  null for that queue - the status page renders honesty, not errors. */
async function queueStats() {
  const out = {};
  await Promise.all(
    STATUS_QUEUES.map(async ([key, name]) => {
      try {
        if (!queueUrlCache.has(name)) {
          const { QueueUrl } = await sqs.send(
            new GetQueueUrlCommand({ QueueName: name }),
          );
          queueUrlCache.set(name, QueueUrl);
        }
        const { Attributes } = await sqs.send(
          new GetQueueAttributesCommand({
            QueueUrl: queueUrlCache.get(name),
            AttributeNames: [
              "ApproximateNumberOfMessages",
              "ApproximateNumberOfMessagesNotVisible",
              "ApproximateAgeOfOldestMessage",
            ],
          }),
        );
        out[key] = {
          depth: Number(Attributes.ApproximateNumberOfMessages ?? 0),
          in_flight: Number(
            Attributes.ApproximateNumberOfMessagesNotVisible ?? 0,
          ),
          oldest_seconds: Number(Attributes.ApproximateAgeOfOldestMessage ?? 0),
        };
      } catch (err) {
        console.error(`queueStats ${name}: ${err.name}: ${err.message}`);
        out[key] = null;
      }
    }),
  );
  return out;
}

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.SESSION_SECRET,
  sendLoginEmail: ({ email, code, token }) =>
    enqueueEmail({ v: 1, kind: "login", to: email, code, token }),
  queueStats,
  notifyOwner: ({ kind, playerTag, emailHash }) =>
    enqueueEmail({
      v: 1,
      kind: "owner_notify",
      to: "elixir@poapkings.com",
      note:
        kind === "access_request"
          ? `New access request${playerTag ? ` from ${playerTag}` : ""}.`
          : kind === "gateway_request"
            ? `Gateway raise-hand: "${playerTag}". Issue an IP-bound CR key + IAM user (docs/OPERATORS.md).`
            : `Account approved (${emailHash}).`,
    }),
});
