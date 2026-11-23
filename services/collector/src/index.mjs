import { makeHttpApp, listen } from "@elixir-mcp/http/server";
/** Lambda entrypoint: env wiring for the collector door. Submissions are
 *  archived at admission (payloads/, write-once), and the one owner
 *  notice the door sends, a quarantine, leaves through the outbox like
 *  all mail: the VPC has no route to SQS or the internet. So does the
 *  wake an admission sends a cross-posted timeline (timeline-sync/). */

import { currentAndPrevious } from "@elixir-mcp/auth";
import { makeCollectorDoor } from "@elixir-mcp/collector-door";
import { processResult } from "@elixir-mcp/ingest/pipeline";
import { makeArchive } from "@elixir-mcp/ingest";
import { makeOutbox } from "@elixir-mcp/outbox";
import { ownerNotifyMessage } from "@elixir-mcp/outbox/notify";
import { wakeSyndication } from "@elixir-mcp/syndication";
import { wakeStories } from "@elixir-mcp/tools/activity/story-wake";
import { makeHandler } from "./handler.mjs";

const archive = makeArchive(process.env.ARCHIVE_BUCKET);
const outbox = makeOutbox(process.env.OUTBOX_BUCKET);

async function notifyOwner(spec) {
  if (!outbox) throw new Error("OUTBOX_BUCKET is not set");
  await outbox("email", ownerNotifyMessage(spec));
}

const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  // Current and previous, as every door: during a rotation some edges
  // still send the old origin header (docs/SECRETS.md).
  originSecret: currentAndPrevious(
    process.env.ORIGIN_SECRET,
    process.env.ORIGIN_SECRET_PREVIOUS,
  ),
  door: makeCollectorDoor({
    ingest: (db, envelope) =>
      processResult(db, envelope, {
        ...(archive ? { archive } : {}),
        ...(outbox
          ? {
              // After the commit: cross-posted timelines, then the
              // player's stored stories (stage 2, 2026-11-23). Neither
              // fails the admission; ingest logs a throw.
              wake: async (d, tag) => {
                try {
                  await wakeSyndication(d, tag, { outbox });
                } finally {
                  await wakeStories(d, tag, { outbox });
                }
              },
            }
          : {}),
      }),
    notifyOwner,
  }),
});

listen(makeHttpApp({ dispatch: handler, timeoutSeconds: 20 }), {
  close: handler.close,
});
