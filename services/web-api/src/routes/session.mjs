/** A session's public page, picture and JSON (2026-11-17), as a battle's
 *  are (routes/battle.mjs): `/session/<tag>/<id>/<start>` is the app shell
 *  with the session's preview tags written into it, `.png` on the same
 *  address is its share picture, and `/api/public/sessions/...` is what the
 *  page reads. All three are PUBLIC, class "record" in the public-boundary
 *  test. The gate is session-page.mjs's; the edge keeps each answer by its
 *  path alone, so no cookie and no query string ever reach this route. */
import { json } from "../http.mjs";
import { namedShell } from "./battle.mjs";
import {
  parseSessionRef,
  readPublicSession,
  sessionMaxAge,
  sessionPreview,
} from "../session-page.mjs";

const page = (statusCode, body, maxAge) => ({
  statusCode,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}`,
  },
  body,
});

const restOf = (event, prefix) => String(event.path ?? "").slice(prefix.length);

/** The share picture: a PNG, base64 for the gateway. A minute at the edge
 *  while the session is open, so its later battles reach the picture; a
 *  day once it has ended, as a battle's. */
async function picture(db, ref, shareImage) {
  const text = (statusCode, body, maxAge) => ({
    statusCode,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
    },
    body,
  });
  if (!shareImage) return text(503, "The share picture is not set up.", 0);
  const read = await readPublicSession(db, ref);
  if (read.status !== 200) return text(404, "No session at this address.", 60);
  const png = await shareImage(read);
  return {
    statusCode: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${sessionMaxAge(read, 86400)}`,
    },
    body: Buffer.from(png).toString("base64"),
    isBase64Encoded: true,
  };
}

export function sessionRoutes({ siteShell, shareImage }) {
  return {
    "GET /session/**": async (db, event) => {
      const rest = restOf(event, "/session/");
      if (rest.endsWith(".png"))
        return picture(db, parseSessionRef(rest.slice(0, -4)), shareImage);
      if (!siteShell)
        return page(503, "<!doctype html><title>Elixir</title>", 0);
      const shell = await siteShell();
      const read = await readPublicSession(db, parseSessionRef(rest));
      // Not a session this address names: the app says so in its own
      // words, and the edge forgets the answer soon.
      if (read.status !== 200) return page(404, shell, 60);
      return page(
        200,
        namedShell(shell, read, {
          ...sessionPreview(read),
          url: read.url,
          image: read.image,
        }),
        sessionMaxAge(read, 3600),
      );
    },

    // The page's JSON: the sitting as its signed-in page reads it, read as
    // nobody. An older page of its battles is `/<offset>/<version>` on the
    // same address.
    "GET /api/public/sessions/**": async (db, event) => {
      const ref = parseSessionRef(restOf(event, "/api/public/sessions/"), {
        paging: true,
      });
      const read = await readPublicSession(db, ref);
      if (read.status === 409)
        return json(
          409,
          { error: "evidence_changed" },
          { "cache-control": "public, max-age=60" },
        );
      if (read.status !== 200)
        return json(
          404,
          { error: "not_found" },
          { "cache-control": "public, max-age=60" },
        );
      const body = { ...read };
      delete body.status;
      delete body.session;
      return json(200, body, {
        "cache-control": `public, max-age=${sessionMaxAge(read, 3600)}`,
      });
    },
  };
}
