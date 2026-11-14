/** Local-only fixture preview for interactive browser review. No live API. */
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homeApi } from "../apps/web/e2e/home-fixture.ts";
import { ADA } from "../apps/web/e2e/player-fixture.ts";

const port = Number(process.env.ELIXIR_DESIGN_PORT ?? 4388);
const staticPort = port + 1;
const child = spawn(
  process.execPath,
  ["infra/scripts/serve-site.mjs", "--port", String(staticPort)],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
  },
);
const routes = homeApi({ "GET /api/player": [200, ADA] });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/api/")) {
    let data = "";
    for await (const chunk of req) data += chunk;
    const key = `${req.method} ${url.pathname}`;
    const answer =
      routes[key] ??
      (key === "GET /api/me/home/feed"
        ? routes["GET /api/me/timeline"]
        : undefined);
    const [status, body] =
      typeof answer === "function"
        ? answer({
            request: () => ({
              url: () => url.href,
              postDataJSON: () => (data ? JSON.parse(data) : null),
            }),
          } as never)
        : (answer ?? [404, { error: "unmocked", key }]);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:${staticPort}${url.pathname}${url.search}`,
    );
    res.writeHead(response.status, {
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503);
    res.end("The local static preview is starting.");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Invented-player preview: http://127.0.0.1:${port}/home`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    child.kill();
    server.close();
  });
