import { makeHttpApp, listen } from "@elixir-mcp/http/server";
/** Lambda entrypoint for the MCP door (elixir.poapkings.com). */

import { currentAndPrevious } from "@elixir-mcp/auth";
import { makeHandler } from "./handler.mjs";
import { makeCaptureStore } from "@elixir-mcp/tools/capture";
import { enqueueJob } from "@elixir-mcp/ledger";
import { ownerNotifyMessage } from "@elixir-mcp/outbox/notify";
import { makeOutbox } from "@elixir-mcp/outbox";

// Mail leaves through the outbox (packages/outbox/src/outbox.mjs), as it does
// from the site API.
const outbox = makeOutbox(process.env.OUTBOX_BUCKET);

const handler = makeHandler({
  databaseUrl: process.env.DATABASE_URL,
  issuer: process.env.OAUTH_ISSUER ?? "https://elixir.poapkings.com",
  // 0040: live jobs go straight into the Postgres job ledger; the
  // live-channel collectors lease them at the door.
  enqueueLiveJob: (db, job) => enqueueJob(db, job),
  // The previous value is accepted while a rotation settles
  // (docs/SECRETS.md); only the current one is ever sent or signed with.
  originSecret: currentAndPrevious(
    process.env.ORIGIN_SECRET,
    process.env.ORIGIN_SECRET_PREVIOUS,
  ),
  // The site's session secret: /oauth/authorize honours a signed-in
  // browser and signs a consenting one in (0083). The only door route
  // CloudFront forwards the cookie to.
  sessionSecret: currentAndPrevious(
    process.env.SESSION_SECRET,
    process.env.SESSION_SECRET_PREVIOUS,
  ),
  // Call capture: on when ARCHIVE_BUCKET is set, off
  // otherwise. The bodies land beside the payload archive under calls/.
  capture: makeCaptureStore(process.env.ARCHIVE_BUCKET),
  // Same relay, same message shape as the site API (notify.mjs).
  notifyOwner: outbox
    ? (spec) => outbox("email", ownerNotifyMessage(spec))
    : null,
  sendLoginEmail: ({
    email,
    code,
    clientName,
    newsletter,
    ipAddress,
    turnstile,
  }) =>
    outbox("email", {
      v: 1,
      kind: "login",
      to: email,
      code,
      client_name: clientName,
      newsletter,
      ...(newsletter && ipAddress ? { ip_address: ipAddress } : {}),
      // The page's token, for the relay to verify (auth turnstile.mjs).
      ...(turnstile ? { turnstile } : {}),
    }),
  // The same welcome the site API queues when a code opens an account
  // (2026-10-12: this door opens accounts too).
  sendWelcomeEmail: ({ email, newsletter = false, ipAddress }) =>
    outbox("email", {
      v: 1,
      kind: "welcome",
      to: email,
      newsletter,
      ...(newsletter && ipAddress ? { ip_address: ipAddress } : {}),
    }),
});

listen(makeHttpApp({ dispatch: handler, timeoutSeconds: 25 }), {
  close: handler.close,
});
