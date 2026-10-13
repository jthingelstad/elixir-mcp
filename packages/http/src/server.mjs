import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";

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
      remainingMs: () =>
        Math.max(1, timeoutSeconds * 1000 - (Date.now() - start)),
    };
    let res;
    try {
      res = await dispatch(request, context);
    } finally {
      console.info({
        event: "http_request",
        http: `${request.method} ${request.path.replace(/^\/a\/[^/]+/, "/a/*").replace(/^\/api\/agent\/[^/]+/, "/api/agent/*")}`,
        status: res?.statusCode ?? 503,
        ms: Date.now() - start,
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
