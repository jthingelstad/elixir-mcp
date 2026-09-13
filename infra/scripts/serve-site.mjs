/**
 * Serve the merged tree (dist/site) the way the edge does: a path with a
 * document of its own is served as that document, anything else is the
 * app shell (app.html) - which is what the CloudFront function in
 * infra/template.yaml does for the app's paths. No API: the Playwright
 * journeys answer /api/* themselves, with fixtures, so the built app is
 * tested end to end without a database.
 *
 *   node infra/scripts/serve-site.mjs [--port 4321] [--root dist/site]
 */
import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const args = process.argv.slice(2);
const arg = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = Number(arg("--port", "4321"));
const root = path.resolve(repoRoot, arg("--root", "dist/site"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".otf": "font/otf",
  ".svg": "image/svg+xml",
  ".xml": "text/xml",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/api/")) {
      // Never answered here: a journey that forgot a route sees 599,
      // not a silent empty JSON that reads as success.
      res.statusCode = 599;
      res.end("unrouted api call in e2e");
      return;
    }
    let file = path.join(root, decodeURIComponent(pathname));
    if (existsSync(file) && statSync(file).isDirectory())
      file = path.join(file, "index.html");
    if (!existsSync(file)) file = path.join(root, "app.html");
    res.setHeader(
      "content-type",
      TYPES[path.extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  })
  .listen(port, () => {
    console.log(`serving ${path.relative(repoRoot, root)} on :${port}`);
  });
