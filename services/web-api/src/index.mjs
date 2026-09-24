/** Lambda entrypoint: env wiring + outbox mail. The VPC has no route to
 *  SQS or the internet, so mail leaves as an object in the outbox bucket
 *  and the relay sends it (outbox.mjs). Owner notifications go to
 *  elixir@poapkings.com itself — the monitored service mailbox. */

import { makeHandler } from "./handler.mjs";
import { makeCollectorDoor } from "./collector-door.mjs";
import { processResult } from "../../ingest/src/pipeline.mjs";
import { makeArchive } from "../../ingest/src/handler.mjs";
import { makeCaptureStore } from "../../mcp/src/capture.mjs";
import { makeOutbox, countStuck } from "./outbox.mjs";

const outbox = makeOutbox(process.env.OUTBOX_BUCKET);

async function enqueueEmail(msg) {
  if (!outbox) throw new Error("OUTBOX_BUCKET is not set");
  await outbox("email", msg);
}

/** Messages that ran out of retries, for the status page. Any failure
 *  yields null - the status page renders honesty, not errors. */
async function deadLetters() {
  try {
    return await countStuck(process.env.OUTBOX_BUCKET);
  } catch (err) {
    console.error(`deadLetters: ${err.name}: ${err.message}`);
    return null;
  }
}

import { ownerNotifyMessage } from "./notify.mjs";

function notifyOwner(spec) {
  return enqueueEmail(ownerNotifyMessage(spec));
}

export const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.SESSION_SECRET,
  originSecret: process.env.ORIGIN_SECRET || null,
  sendLoginEmail: ({ email, code, token, newsletter }) =>
    enqueueEmail({ v: 1, kind: "login", to: email, code, token, newsletter }),
  // The template has existed since the gate shipped and nothing ever
  // queued it; approval mailed the owner instead.
  sendWelcomeEmail: ({ email }) =>
    enqueueEmail({ v: 1, kind: "welcome", to: email }),
  deadLetters,
  notifyOwner,
  // Captured tool calls are read back for the console's call record;
  // absent bucket = the record carries the row only.
  capture: makeCaptureStore(process.env.ARCHIVE_BUCKET),
  collectorDoor: makeCollectorDoor({
    ingest: async (db, envelope) => {
      const archive = makeArchive(process.env.ARCHIVE_BUCKET);
      return processResult(db, envelope, archive ? { archive } : {});
    },
    notifyOwner,
  }),
});
