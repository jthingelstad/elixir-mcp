import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { logPath } from "./log-path.mjs";

/** A native HTTP request becomes the route layer's small request record.
 * No API Gateway event, Lambda adapter or invocation context is created. */
export function makeHttpApp({ dispatch, timeoutSeconds = 30 }) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 6 * 1024 * 1024 }));
  app.all("*", async (c) => {
    const start = Date.now();
    const url = new URL(c.req.url);
    const request = {
      method: c.req.method,
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      rawQueryString: url.search.slice(1),
      headers: Object.fromEntries(c.req.raw.headers),
      body: ["GET", "HEAD"].includes(c.req.method) ? "" : await c.req.text(),
    };
    const context = {
      requestId: randomUUID(),
      // The matched route's shape, set by a door that has one
      // (`/api/rss/*`): what the request line names instead of the path.
      route: null,
      remainingMs: () =>
        Math.max(1, timeoutSeconds * 1000 - (Date.now() - start)),
    };
    let res;
    try {
      res = await dispatch(request, context);
    } finally {
      console.info({
        event: "http_request",
        // Never the raw path: a wildcard segment can be a credential
        // (log-path.mjs). The door's route shape, else the masked path.
        http: `${request.method} ${context.route ?? logPath(request.path)}`,
        status: res?.statusCode ?? 503,
        ms: Date.now() - start,
        // Whether the caller asked conditionally, never the tag it sent:
        // how an operator tells a reader that holds a feed from one that
        // does not, and whether the edge passed the header on. The feed
        // is kept at the edge (2026-11-23), so this is seen only on what
        // reaches the origin: misses, and the edge's own revalidation,
        // which sends the tag it holds.
        ...(request.headers["if-none-match"] ? { conditional: true } : {}),
        request_id: context.requestId,
        build: process.env.APP_BUILD,
      });
    }
    const headers = new Headers(res.headers ?? {});
    // A private response may never be cached, including refusals and redirects.
    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
    for (const cookie of res.cookies ?? [])
      headers.append("set-cookie", cookie);
    return new Response(
      c.req.method === "HEAD" || [204, 304].includes(res.statusCode)
        ? null
        : res.isBase64Encoded
          ? Buffer.from(res.body, "base64")
          : (res.body ?? ""),
      { status: res.statusCode ?? 200, headers },
    );
  });
  app.onError((error, c) => {
    console.error({
      event: "http_error",
      name: error.name,
      build: process.env.APP_BUILD,
    });
    c.header("cache-control", "no-store");
    return c.json({ error: "unavailable" }, 503);
  });
  return app;
}

export function listen(app, { close = async () => {} } = {}) {
  const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
  const address = endpoint
    ? new URL(endpoint.includes("://") ? endpoint : `http://${endpoint}`)
    : new URL("http://0.0.0.0:4319");
  const server = serve({
    fetch: app.fetch,
    hostname: address.hostname,
    port: Number(address.port || 80),
  });
  server.on("listening", () =>
    console.info({ event: "http_listening", build: process.env.APP_BUILD }),
  );
  process.once("SIGTERM", () => {
    // Web Functions allow one second, so do not promise a long drain.
    server.close();
    void close();
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 800).unref();
  });
  return server;
}
