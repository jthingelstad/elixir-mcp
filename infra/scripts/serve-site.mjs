/**
 * Serve the merged tree (dist/site) the way the edge does - the same rule
 * as the CloudFront function in infra/template.yaml: a file is itself,
 * /console and /ladder and everything under them is the app shell
 * (app.html), and any
 * other path is the site's document or an honest 404. No API: the
 * Playwright journeys answer /api/* themselves, with fixtures, so the
 * built app is tested end to end without a database.
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

/** The edge's rule (SpaRouter in infra/template.yaml): path to object. */
function route(pathname) {
  // A last segment with an extension asks for a real file.
  if (pathname.slice(pathname.lastIndexOf("/") + 1).includes("."))
    return pathname;
  if (pathname === "/") return "/index.html";
  const key = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (key === "/console" || key.startsWith("/console/")) return "/app.html";
  // A battle's page is the app shell too: at the edge the API serves it
  // (the /battle/* behavior), with the battle's preview tags written in.
  if (/^\/battle\/[0-9a-f]{12,64}$/.test(key)) return "/app.html";
  if (key === "/clan" || key.startsWith("/clan/")) return "/app.html";
  if (key === "/ladder" || key.startsWith("/ladder/")) return "/app.html";
  return `${key}/index.html`;
}

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
    const file = path.join(root, decodeURIComponent(route(pathname)));
    if (
      !file.startsWith(root) ||
      !existsSync(file) ||
      statSync(file).isDirectory()
    ) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader(
      "content-type",
      TYPES[path.extname(file)] ?? "application/octet-stream",
    );
    res.end(readFileSync(file));
  })
  .listen(port, () => {
    console.log(`serving ${path.relative(repoRoot, root)} on :${port}`);
  });
