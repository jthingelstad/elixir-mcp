import { readFile } from "node:fs/promises";

/** Server rendering (React, the router, the console's pages) is loaded
 *  on the first page, never at import: a cold start that serves a JSON
 *  route does not pay for it (docs/notes/2026-10-21-web-api-cold-start.md).
 *  The bundle carries it as a chunk of its own (infra/scripts/build.mjs). */
const renderApp = async (input) =>
  (await import("@elixir-mcp/web/server")).renderApp(input);

/** The app's own paths, as the distribution routes them. `/console`,
 *  `/ladder` and `/data/service` left on 2026-11-13: a bucket miss there
 *  fails over here and must read as the site's 404 (routes/site-miss.mjs),
 *  never the app. */
const APP_PATH = /^\/(?:clan|home|settings|signin|timeline)(?:\/|$)/;

/** Home's own address forwards to the Timeline for good (2026-11-17,
 *  DECISIONS "Timeline, Profile and Notifications"): mail already sent,
 *  Discord posts, push notifications, bookmarks and the installed app's old
 *  start URL all name `/home`. The query rides along; a browser keeps the
 *  fragment itself when the Location has none (RFC 9110 10.2.2). Only the
 *  bare address: every page under `/home/` keeps its own. The app's router
 *  forwards the same address (apps/web/src/lib/moved.js) as the fallback.
 *  Not cached, so a rollback is not stuck behind a browser's copy. */
const HOME_ROOT = /^\/home\/?$/;
const TIMELINE = "/timeline";

/** The Timeline as the site's behaviour sends it: an edge that does not yet
 *  route `/timeline` to this API (a deploy's distribution change is still
 *  propagating) asks the site bucket for `/timeline/index.html` and fails
 *  over here with no cookie. Rendering that would show a signed-in reader
 *  the signed-out page, so it gets the bare app shell with no bootstrap,
 *  and the browser reads the session itself through `/api/me`. */
const TIMELINE_VIA_SITE = /^\/timeline\/index\.html$/;
const safeJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/** HTML and client assets come from the same immutable revision. A deploy
 * publishes the assets before the revision is routed to browsers. */
export function makeAppPages({
  dispatch,
  shell = () => readFile(new URL("./app.html", import.meta.url), "utf8"),
  render = renderApp,
}) {
  let shellPromise;
  const readShell = () =>
    (shellPromise ??= shell().catch((error) => {
      shellPromise = null;
      throw error;
    }));
  return async (request, context) => {
    if (
      ["GET", "HEAD"].includes(request.method) &&
      HOME_ROOT.test(request.path)
    )
      return {
        statusCode: 301,
        headers: {
          location:
            TIMELINE +
            (request.rawQueryString ? `?${request.rawQueryString}` : ""),
          "cache-control": "no-store",
        },
        body: "",
      };
    if (
      ["GET", "HEAD"].includes(request.method) &&
      TIMELINE_VIA_SITE.test(request.path)
    )
      return {
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
        },
        body: request.method === "HEAD" ? "" : await readShell(),
      };
    if (
      !["GET", "HEAD"].includes(request.method) ||
      !APP_PATH.test(request.path)
    )
      return dispatch(request, context);
    const renderedAt = Date.now();
    let session;
    try {
      session = await dispatch(
        {
          ...request,
          path: "/api/me",
          method: "GET",
          queryStringParameters: {},
        },
        context,
      );
    } catch (error) {
      console.error({ event: "page_session_error", name: error.name });
      session = { statusCode: 503, body: '{"error":"unavailable"}' };
    }
    if (session.statusCode === 403) return session;
    const me = {
      ok: session.statusCode < 400,
      status: session.statusCode,
      data: JSON.parse(session.body),
    };
    let clanMe;
    if (/^\/clan(?:\/|$)/.test(request.path)) {
      let clanSession = session;
      if (session.statusCode < 500) {
        try {
          clanSession = await dispatch(
            {
              ...request,
              path: "/api/clan/me",
              method: "GET",
              queryStringParameters: {},
            },
            context,
          );
        } catch (error) {
          console.error({ event: "page_clan_session_error", name: error.name });
          clanSession = { statusCode: 503, body: '{"error":"unavailable"}' };
        }
      }
      clanMe = {
        ok: clanSession.statusCode < 400,
        status: clanSession.statusCode,
        data: JSON.parse(clanSession.body),
      };
    }
    const html = await readShell();
    const content = await render({
      url:
        request.path +
        (request.rawQueryString ? `?${request.rawQueryString}` : ""),
      me,
      clanMe,
      renderedAt,
    });
    return {
      statusCode:
        session.statusCode >= 500
          ? session.statusCode
          : clanMe?.status >= 500
            ? clanMe.status
            : 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        vary: "Cookie, Authorization",
      },
      body: html.replace(
        '<div id="root"></div>',
        `<div id="root">${content}</div><script type="application/json" id="elixir-bootstrap">${safeJson({ me, clanMe, renderedAt })}</script>`,
      ),
    };
  };
}
