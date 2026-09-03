/** Lambda entrypoint: env wiring + queue-backed email sending (§7 NAT-free:
 *  VPC Lambdas enqueue, the relay sends). Owner notifications go to
 *  elixir@poapkings.com itself — the monitored service mailbox. */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { makeHandler } from "./handler.mjs";
import { makeLive } from "../../mcp/src/live.mjs";

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

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.SESSION_SECRET,
  liveFetch: process.env.LIVE_QUEUE_URL
    ? makeLive({
        enqueue: (job) =>
          sqs.send(
            new SendMessageCommand({
              QueueUrl: process.env.LIVE_QUEUE_URL,
              MessageBody: JSON.stringify(job),
            }),
          ),
      })
    : null,
  sendLoginEmail: ({ email, code, token }) =>
    enqueueEmail({ v: 1, kind: "login", to: email, code, token }),
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
