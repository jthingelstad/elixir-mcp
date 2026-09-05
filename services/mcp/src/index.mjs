/** Lambda entrypoint for the MCP door (elixir.poapkings.com). */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { makeHandler } from "./handler.mjs";

const sqs = new SQSClient({});

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  issuer: process.env.OAUTH_ISSUER ?? "https://elixir.poapkings.com",
  enqueueLiveJob: process.env.LIVE_QUEUE_URL
    ? (job) =>
        sqs.send(
          new SendMessageCommand({
            QueueUrl: process.env.LIVE_QUEUE_URL,
            MessageBody: JSON.stringify(job),
          }),
        )
    : null,
  sendLoginEmail: ({ email, code, clientName }) =>
    sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.EMAIL_QUEUE_URL,
        MessageBody: JSON.stringify({
          v: 1,
          kind: "login",
          to: email,
          code,
          client_name: clientName,
        }),
      }),
    ),
  // Tinylytics ping via the relay queue (best-effort by contract).
  track: process.env.EMAIL_QUEUE_URL
    ? (eventName, value) =>
        sqs.send(
          new SendMessageCommand({
            QueueUrl: process.env.EMAIL_QUEUE_URL,
            MessageBody: JSON.stringify({
              v: 1,
              kind: "tinylytics_event",
              event: eventName,
              ...(value ? { value } : {}),
            }),
          }),
        )
    : null,
});
