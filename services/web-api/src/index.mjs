import { modelStorage } from "@elixir-mcp/clan/model-storage.mjs";
/** Lambda entrypoint: env wiring + outbox mail. The VPC has no route to
 *  SQS or the internet, so mail leaves as an object in the outbox bucket
 *  and the relay sends it (outbox.mjs). Owner notifications go to
 *  elixir@poapkings.com itself — the monitored service mailbox. */

import { currentAndPrevious } from "@elixir-mcp/auth";
import { makeHandler } from "./handler.mjs";
import { makeCaptureStore } from "@elixir-mcp/tools/capture";
import { makeOutbox, countStuck } from "@elixir-mcp/outbox";
import { makeCardArt, makeSiteShell, shareAssetsIn } from "./routes/battle.mjs";
import { makeShareImage } from "./share-image.mjs";
import { createClanRequest } from "./clan.mjs";

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

import { ownerNotifyMessage } from "@elixir-mcp/outbox/notify";

function notifyOwner(spec) {
  return enqueueEmail(ownerNotifyMessage(spec));
}

export const handler = makeHandler({
  clan:
    process.env.CLAN_INTERNAL === "true"
      ? createClanRequest({
          origin: "https://elixir.poapkings.com",
          modelSecret: process.env.CLAN_MODEL_SECRET,
          modelStorage: modelStorage(process.env.OUTBOX_BUCKET),
          maintainerTags: String(process.env.CLAN_MAINTAINER_TAGS ?? "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          notify: (spec) =>
            enqueueEmail({
              ...ownerNotifyMessage({
                kind: "feedback",
                message: spec.excerpt,
                category: spec.category,
                surface: "clan",
                feedbackId: spec.feedback_id,
                from: spec.from,
              }),
              link: `https://elixir.poapkings.com/clan/maintain/feedback/${spec.feedback_id}`,
            }),
        })
      : null,
  databaseUrl: process.env.DATABASE_URL,
  // Current and previous: a rotation signs nobody out, and a request
  // from an edge still sending the old origin header is served
  // (docs/SECRETS.md).
  secret: currentAndPrevious(
    process.env.SESSION_SECRET,
    process.env.SESSION_SECRET_PREVIOUS,
  ),
  originSecret: currentAndPrevious(
    process.env.ORIGIN_SECRET,
    process.env.ORIGIN_SECRET_PREVIOUS,
  ),
  // Unsubscribe links' own key, once the app secret carries it; until
  // then they are signed with the session secret (packages/mail).
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || null,
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
  // A family app's mail (JSON API 2.4.0) leaves through the same outbox
  // and is archived like every send.
  mail: {
    enqueue: enqueueEmail,
    archive: makeCaptureStore(process.env.ARCHIVE_BUCKET),
  },
  // A battle's page is the app shell with the battle's preview tags.
  siteShell: makeSiteShell(process.env.SITE_BUCKET),
  // Its share picture: resvg and the fonts ride in the bundle's share/
  // (infra/scripts/build.mjs), the card art in the site bucket.
  shareImage: makeShareImage({
    assets: shareAssetsIn(new URL("./share/", import.meta.url)),
    cardArt: makeCardArt(process.env.SITE_BUCKET),
  }),
});
