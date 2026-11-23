import { makeAppPages } from "./app-pages.mjs";
import { makeHttpApp, listen } from "@elixir-mcp/http/server";
import { modelStorage } from "@elixir-mcp/clan/model-storage.mjs";
import { createModelBridge } from "@elixir-mcp/clan/model-bridge.mjs";
/** Lambda entrypoint: env wiring + outbox mail. The VPC has no route to
 *  SQS or the internet, so mail leaves as an object in the outbox bucket
 *  and the relay sends it (outbox.mjs). Owner notifications go to
 *  elixir@poapkings.com itself — the monitored service mailbox. */

import { currentAndPrevious } from "@elixir-mcp/auth";
import { makeHandler } from "./handler.mjs";
import { MODERATION_WAIT_MS } from "./comment-check.mjs";
import { makeCaptureStore } from "@elixir-mcp/tools/capture";
import { makeOutbox, countStuck } from "@elixir-mcp/outbox";
import { homeWeekWake } from "@elixir-mcp/tools/activity/home-feed";
import { makeCardArt, makeSiteShell, shareAssetsIn } from "./routes/battle.mjs";
import { makeSiteMiss } from "./routes/site-miss.mjs";
import { makeShareImage } from "./share-image.mjs";
import { createClanRequest } from "./clan.mjs";
import { createBox } from "@elixir-mcp/clan/sealed.mjs";
import {
  createDiscordLoginBridge,
  DISCORD_LOGIN_PURPOSE,
} from "@elixir-mcp/auth/discord";
import {
  makeHistoryReader,
  makeStatusReader,
  webhookSeal,
  WEBHOOK_PURPOSE,
} from "@elixir-mcp/syndication";

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
import { readProductUpdates } from "./product-updates.mjs";

function notifyOwner(spec) {
  return enqueueEmail(ownerNotifyMessage(spec));
}

/** Elixir's one public origin, for Clan's links and the write check. */
const SITE_ORIGIN = "https://elixir.poapkings.com";

const handler = makeHandler({
  siteOrigin: SITE_ORIGIN,
  clan: createClanRequest({
    origin: SITE_ORIGIN,
    modelSecret: process.env.CLAN_MODEL_SECRET,
    modelStorage: modelStorage(process.env.OUTBOX_BUCKET),
    outbox,
    readStatus: makeStatusReader(process.env.OUTBOX_BUCKET),
    readHistory: makeHistoryReader(process.env.OUTBOX_BUCKET),
    notifyOwner,
    // Clan's Feed holds members' posts about battles always, and their
    // other posts while posts and comments are on; their comments while
    // comments are on (the same test the handler's comments make).
    posts:
      process.env.POSTS_ENABLED === "true" &&
      process.env.COMMENTS_ENABLED === "true" &&
      Boolean(process.env.CLAN_MODEL_SECRET && process.env.OUTBOX_BUCKET),
    comments:
      process.env.COMMENTS_ENABLED === "true" &&
      Boolean(process.env.CLAN_MODEL_SECRET && process.env.OUTBOX_BUCKET),
  }),
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
  // Web push (2026-11-16): the public key alone; set only when WebPush is on.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  sendLoginEmail: ({ email, code, token, newsletter, ipAddress, turnstile }) =>
    enqueueEmail({
      v: 1,
      kind: "login",
      to: email,
      code,
      token,
      newsletter,
      ...(newsletter && ipAddress ? { ip_address: ipAddress } : {}),
      // The page's token, for the relay to verify (auth turnstile.mjs).
      ...(turnstile ? { turnstile } : {}),
    }),
  // The template has existed since the gate shipped and nothing ever
  // queued it; approval mailed the owner instead.
  sendWelcomeEmail: ({ email, newsletter = false, ipAddress }) =>
    enqueueEmail({
      v: 1,
      kind: "welcome",
      to: email,
      newsletter,
      ...(newsletter && ipAddress ? { ip_address: ipAddress } : {}),
    }),
  deadLetters,
  notifyOwner,
  // Home's stored week, rebuilt by the timeline-sync lane (0245, #649).
  homeWake: homeWeekWake(outbox),
  // The timeline's Discord cross-post: the webhook sealed as it is saved
  // (under the sealing secret Clan's webhooks use, for this use only),
  // the hello line a save sends, and the relay's last word on it.
  discord: process.env.CLAN_MODEL_SECRET
    ? {
        seal: webhookSeal(
          createBox(process.env.CLAN_MODEL_SECRET, WEBHOOK_PURPOSE),
        ).seal,
        outbox,
        readStatus: makeStatusReader(process.env.OUTBOX_BUCKET),
        readHistory: makeHistoryReader(process.env.OUTBOX_BUCKET),
      }
    : null,
  // Linking and signing in with Discord (#531): the code goes to the
  // relay sealed (the VPC has no route to Discord) and the user comes
  // back the same way. Off until the Discord app's id is configured.
  discordLogin:
    process.env.DISCORD_CLIENT_ID && process.env.CLAN_MODEL_SECRET
      ? {
          clientId: process.env.DISCORD_CLIENT_ID,
          bridge: createDiscordLoginBridge({
            box: createBox(
              process.env.CLAN_MODEL_SECRET,
              DISCORD_LOGIN_PURPOSE,
            ),
            storage: modelStorage(process.env.OUTBOX_BUCKET),
          }),
        }
      : null,
  // Captured tool calls are read back for the console's call record;
  // absent bucket = the record carries the row only.
  capture: makeCaptureStore(process.env.ARCHIVE_BUCKET),
  // A battle's page is the app shell with the battle's preview tags.
  siteShell: makeSiteShell(process.env.SITE_BUCKET),
  // A mail's turn-off link is answered in the site's own page.
  emailShell: makeSiteShell(process.env.SITE_BUCKET, {
    key: "email-page.html",
  }),
  // An address the site does not build: its 404 page, with a true 404.
  siteMiss: makeSiteMiss(
    makeSiteShell(process.env.SITE_BUCKET, { key: "404.html" }),
  ),
  // Its share picture: resvg and the fonts ride in the bundle's share/
  // (infra/scripts/build.mjs), the card art in the site bucket.
  shareImage: makeShareImage({
    assets: shareAssetsIn(new URL("./share/", import.meta.url)),
    cardArt: makeCardArt(process.env.SITE_BUCKET),
  }),
  // Comments (2026-11-16): on only with the stack's CommentsEnabled. The
  // check rides the clan model bridge to the relay, which alone holds
  // Elixir's moderation key; this function never sees it.
  // Posts (2026-11-17): the stack's PostsEnabled, effective only while
  // comments are on (the handler checks): they share comments' check,
  // cap and log.
  posts: process.env.POSTS_ENABLED === "true",
  // The stored-story shadow on the player page (2026-11-23): the stack's
  // TimelineStoryShadow, on unless switched off.
  storyShadow: process.env.TIMELINE_STORY_SHADOW === "on",
  // Product updates in Home's Timeline (2026-11-23): the What's new
  // entries marked for everyone, carried in this bundle from the build.
  productUpdates: readProductUpdates,
  comments:
    process.env.COMMENTS_ENABLED === "true" &&
    process.env.CLAN_MODEL_SECRET &&
    process.env.OUTBOX_BUCKET
      ? {
          enabled: true,
          capUsd: Number(process.env.COMMENTS_CAP_USD ?? 0),
          moderate: createModelBridge({
            secret: process.env.CLAN_MODEL_SECRET,
            storage: modelStorage(process.env.OUTBOX_BUCKET),
            // This bridge carries comment and post checks alone.
            timeoutMs: MODERATION_WAIT_MS,
          }).moderate,
        }
      : null,
});

listen(
  makeHttpApp({
    dispatch: makeAppPages({ dispatch: handler }),
    timeoutSeconds: 30,
  }),
  {
    close: handler.close,
  },
);
