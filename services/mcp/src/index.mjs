/** Lambda entrypoint for the MCP door (elixir.poapkings.com). */

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { makeHandler } from "./handler.mjs";
import { enqueueJob } from "../../scheduler/src/ledger.mjs";
import { ownerNotifyMessage } from "../../web-api/src/notify.mjs";

const sqs = new SQSClient({});

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  issuer: process.env.OAUTH_ISSUER ?? "https://elixir.poapkings.com",
  // 0040: live jobs go straight into the Postgres job ledger; the
  // live-channel collectors lease them at the door.
  enqueueLiveJob: (db, job) => enqueueJob(db, job),
  originSecret: process.env.ORIGIN_SECRET || null,
  // Same relay, same message shape as the site API (notify.mjs).
  notifyOwner: process.env.EMAIL_QUEUE_URL
    ? (spec) =>
        sqs.send(
          new SendMessageCommand({
            QueueUrl: process.env.EMAIL_QUEUE_URL,
            MessageBody: JSON.stringify(ownerNotifyMessage(spec)),
          }),
        )
    : null,
  sendLoginEmail: ({ email, code, clientName, newsletter }) =>
    sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.EMAIL_QUEUE_URL,
        MessageBody: JSON.stringify({
          v: 1,
          kind: "login",
          to: email,
          code,
          client_name: clientName,
          newsletter,
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
