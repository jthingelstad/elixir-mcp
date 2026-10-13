import { readFile } from "node:fs/promises";
import { renderApp } from "@elixir-mcp/web/server";

const APP_PATH = /^\/(?:console|clan|ladder)(?:\/|$)/;
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
  return async (request, context) => {
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
    if (session.statusCode < 500 && /^\/clan(?:\/|$)/.test(request.path)) {
      const clanSession = await dispatch(
        {
          ...request,
          path: "/api/clan/me",
          method: "GET",
          queryStringParameters: {},
        },
        context,
      );
      clanMe = {
        ok: clanSession.statusCode < 400,
        status: clanSession.statusCode,
        data: JSON.parse(clanSession.body),
      };
    }
    const html = await (shellPromise ??= shell().catch((error) => {
      shellPromise = null;
      throw error;
    }));
    const content = await render({
      url:
        request.path +
        (request.rawQueryString ? `?${request.rawQueryString}` : ""),
      me,
      clanMe,
      renderedAt,
    });
    return {
      statusCode: session.statusCode >= 500 ? session.statusCode : 200,
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
