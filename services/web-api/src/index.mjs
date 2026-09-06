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
import { makeCollectorDoor } from "./collector-door.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { makeArchive } from "../../ingest/src/handler.mjs";

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

// Only the email queue remains (0040 retired the collector queues for
// the Postgres job ledger). The status page reads job health from the
// ledger now; this covers the email DLQ.
const STATUS_QUEUES = [["email_dlq", "elixir-mcp-email-dlq"]];
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
            ],
          }),
        );
        out[key] = {
          depth: Number(Attributes.ApproximateNumberOfMessages ?? 0),
          in_flight: Number(
            Attributes.ApproximateNumberOfMessagesNotVisible ?? 0,
          ),
        };
      } catch (err) {
        console.error(`queueStats ${name}: ${err.name}: ${err.message}`);
        out[key] = null;
      }
    }),
  );
  return out;
}

function notifyOwner({ kind, playerTag, emailHash }) {
  return enqueueEmail({
    v: 1,
    kind: "owner_notify",
    to: "elixir@poapkings.com",
    note:
      kind === "access_request"
        ? `New access request${playerTag ? ` from ${playerTag}` : ""}.`
        : kind === "gateway_request"
          ? `Gateway raise-hand: "${playerTag}". Provision a collector token in Admin (docs/OPERATORS.md).`
          : kind === "gateway_quarantined"
            ? `Collector "${playerTag}" QUARANTINED: too many leases expired unsubmitted; now draining.`
            : `Account approved (${emailHash}).`,
  });
}

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.SESSION_SECRET,
  sendLoginEmail: ({ email, code, token }) =>
    enqueueEmail({ v: 1, kind: "login", to: email, code, token }),
  // The template has existed since the gate shipped and nothing ever
  // queued it; approval mailed the owner instead.
  sendWelcomeEmail: ({ email }) =>
    enqueueEmail({ v: 1, kind: "welcome", to: email }),
  queueStats,
  // Tinylytics ping via the relay queue (best-effort by contract).
  track: queueUrl
    ? (eventName, value) =>
        enqueueEmail({
          v: 1,
          kind: "tinylytics_event",
          event: eventName,
          ...(value ? { value } : {}),
        })
    : null,
  notifyOwner,
  collectorDoor: makeCollectorDoor({
    ingest: (db, envelope) => {
      const archive = makeArchive(process.env.ARCHIVE_BUCKET);
      return processResult(db, envelope, archive ? { archive } : {});
    },
    notifyOwner,
  }),
});
