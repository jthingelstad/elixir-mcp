/** Local-only design preview. Never put this server or its sample state in production. */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Lucide from "lucide-react";
import { DISCLAIMER } from "@elixir-mcp/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const assets = path.join(root, "dist/site/assets");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8851;
try {
  await stat(path.join(assets, "site.css"));
} catch {
  throw new Error(
    "Build the local site first: node infra/scripts/build-site.mjs --skip-stats",
  );
}
const names = {
  swords: "Swords",
  fingerprint: "Fingerprint",
  image: "Image",
  "map-pin": "MapPin",
  "users-round": "UsersRound",
  "link-2": "Link2",
  "book-open": "BookOpen",
  users: "Users",
  repeat: "Repeat",
  "gamepad-2": "Gamepad2",
  "heart-pulse": "HeartPulse",
  "message-square": "MessageSquare",
  house: "House",
  castle: "Castle",
  "user-round": "UserRound",
  bell: "Bell",
  x: "X",
  "arrow-right": "ArrowRight",
  "arrow-left": "ArrowLeft",
  check: "Check",
  copy: "Copy",
  "circle-help": "CircleHelp",
  settings: "Settings",
  "chevron-right": "ChevronRight",
  search: "Search",
};
const icons = Object.fromEntries(
  Object.entries(names).map(([name, component]) => [
    name,
    renderToStaticMarkup(
      React.createElement(Lucide[component], {
        width: 24,
        height: 24,
        strokeWidth: 1.9,
        "aria-hidden": true,
      }),
    ),
  ]),
);
const mark = JSON.parse(
  await readFile(
    path.join(root, "packages/ui/src/verification-mark.json"),
    "utf8",
  ),
);
const types = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".html": "text/html",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  // The prototype has no write door, database, analytics or live API proxy.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end("This is a local design preview.");
    return;
  }
  try {
    const uri = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
    );
    if (uri === "/icons.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ icons, mark, disclaimer: DISCLAIMER }));
      return;
    }
    let file;
    if (["/", "/index.html"].includes(uri))
      file = path.join(here, "index.html");
    else if (["/prototype.js", "/prototype.css", "/catalog.json"].includes(uri))
      file = path.join(here, uri.slice(1));
    else if (uri.startsWith("/assets/")) {
      file = path.resolve(assets, uri.slice(8));
      if (!file.startsWith(assets + path.sep)) {
        res.writeHead(403).end();
        return;
      }
    } else {
      res.writeHead(404).end("No live API or product route is served here.");
      return;
    }
    const bytes = await readFile(file);
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream",
    );
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(404).end("Preview file not found.");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log("Local passport design preview: http://127.0.0.1:" + port),
);
