#!/usr/bin/env node
/**
 * Read-only smoke checks (house rule: reads and refusal paths only).
 * Run with AWS_PROFILE=jamie after any deploy.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const cfn = new CloudFormationClient({ region: REGION });
const { Stacks } = await cfn.send(
  new DescribeStacksCommand({ StackName: "elixir-mcp" }),
);
const outputs = Object.fromEntries(
  Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);
let failures = 0;

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures += 1;
};

check(
  "stack status",
  ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(Stacks[0].StackStatus),
  Stacks[0].StackStatus,
);

// MCP door (path-split on the one distribution): discovery must be
// served; /mcp must REFUSE without a bearer.
const mcpBase = `https://${outputs.SiteDistributionDomain}`;
const discovery = await fetch(
  `${mcpBase}/.well-known/oauth-authorization-server`,
);
check("oauth discovery", discovery.ok, String(discovery.status));
const meta = discovery.ok ? await discovery.json() : {};
check("issuer", meta.issuer === "https://elixir.poapkings.com", meta.issuer);
const bare = await fetch(`${mcpBase}/mcp`, { method: "POST", body: "{}" });
check("mcp refuses without bearer", bare.status === 401, String(bare.status));
check(
  "www-authenticate present",
  (bare.headers.get("www-authenticate") ?? "").includes("resource_metadata"),
);

// Site: two builds behind one router (2026-09-07 split). The check
// that matters is that the halves are TELLING APART - before the split
// every URL served the same shell, and a check for "Elixir MCP appears
// somewhere" passed the whole time.
const site = await fetch(`${mcpBase}/`);
check("site root serves", site.ok, String(site.status));
const home = site.ok ? await site.text() : "";
check(
  "home is a real document",
  home.includes("<main") && !home.includes('<div id="root"></div>'),
);
check("home carries the live corpus", /battles recorded/.test(home));

// Browser security headers (#25). Checked on a real response because
// a ResponseHeadersPolicy that is defined but not ATTACHED to the
// behaviour looks identical in the template and does nothing here.
const csp = site.headers.get("content-security-policy") ?? "";
check("CSP present", csp.includes("default-src 'self'"));
check(
  "CSP forbids inline script",
  csp.includes("script-src") && !/script-src[^;]*unsafe-inline/.test(csp),
);
check(
  "clickjacking blocked",
  csp.includes("frame-ancestors 'none'") &&
    site.headers.get("x-frame-options") === "DENY",
);
check(
  "nosniff",
  site.headers.get("x-content-type-options") === "nosniff",
  site.headers.get("x-content-type-options") ?? "absent",
);
check(
  "referrer policy",
  (site.headers.get("referrer-policy") ?? "").length > 0,
  site.headers.get("referrer-policy") ?? "absent",
);
check(
  "permissions policy",
  (site.headers.get("permissions-policy") ?? "").includes("camera=()"),
);
check(
  "hsts",
  (site.headers.get("strict-transport-security") ?? "").includes("max-age="),
  site.headers.get("strict-transport-security") ?? "absent",
);

// The public reads must actually CACHE now (#23): they run real
// aggregation, and under CachingDisabled every hit recomputed them.
// Two requests, and the second has to be a hit - a cache behaviour
// that is present but ineffective looks exactly like one that works.
const statusOnce = await fetch(`${mcpBase}/api/public/status`);
check("public status serves", statusOnce.ok, String(statusOnce.status));
const statusTwice = await fetch(`${mcpBase}/api/public/status`);
const hit = (statusTwice.headers.get("x-cache") ?? "").toLowerCase();
check("public status caches at the edge", hit.includes("hit"), hit || "absent");
check(
  "public status still declares its own freshness",
  (statusTwice.headers.get("cache-control") ?? "").includes("max-age="),
  statusTwice.headers.get("cache-control") ?? "absent",
);

// The app shell is the privileged surface: it must carry the headers
// too, and load no third-party script.
const appShell = await fetch(`${mcpBase}/account/overview`);
const appShellHtml = appShell.ok ? await appShell.text() : "";
check(
  "app shell carries CSP",
  (appShell.headers.get("content-security-policy") ?? "").includes(
    "default-src",
  ),
);
check(
  "app shell loads no third-party script",
  appShell.ok && !appShellHtml.includes("tinylytics.app"),
);

const docs = await fetch(`${mcpBase}/docs/tools`);
const docsHtml = docs.ok ? await docs.text() : "";
check(
  "docs page serves a document",
  docs.ok && docsHtml.includes("<main"),
  String(docs.status),
);
check(
  "the tool reference is the real registry",
  docsHtml.includes("players_profile") && docsHtml.includes("live_fetch"),
);
check(
  "docs pages have their own titles",
  /<title>Tools - Elixir MCP<\/title>/.test(docsHtml),
);

const appRoute = await fetch(`${mcpBase}/account/overview`);
const appHtml = appRoute.ok ? await appRoute.text() : "";
check(
  "an app route gets the app shell",
  appRoute.ok && appHtml.includes('<div id="root"></div>'),
  String(appRoute.status),
);

for (const [name, path, test] of [
  ["llms.txt", "/llms.txt", (t) => t.includes("## MCP connection")],
  ["tools.json", "/tools.json", (t) => JSON.parse(t).tool_count > 0],
  ["sitemap.xml", "/sitemap.xml", (t) => t.includes("/docs/tools")],
  ["robots.txt", "/robots.txt", (t) => t.includes("Sitemap:")],
]) {
  const res = await fetch(`${mcpBase}${path}`);
  let ok = res.ok;
  try {
    ok = ok && test(await res.text());
  } catch {
    ok = false;
  }
  check(`${name} serves`, ok, String(res.status));
}

// The edge must not rewrite the API's own answers. Distribution-wide
// CustomErrorResponses used to turn every 403/404 into a 200 app shell,
// including the API's refusals: an unauthenticated /api/admin/requests
// came back 200 text/html and the web client read it as success.
const refused = await fetch(`${mcpBase}/api/admin/requests`);
check(
  "api refusal keeps its status",
  refused.status === 403,
  String(refused.status),
);
check(
  "api refusal keeps its json",
  (refused.headers.get("content-type") ?? "").includes("application/json"),
  refused.headers.get("content-type") ?? "none",
);
const missing = await fetch(`${mcpBase}/api/definitely-not-a-route`);
check("api 404 stays a 404", missing.status === 404, String(missing.status));

// SPA deep links still land on the shell, which is what the removed
// error mapping was actually there for.
const deep = await fetch(`${mcpBase}/account/overview`);
const deepHtml = deep.ok ? await deep.text() : "";
check(
  "spa deep link serves the shell",
  deep.status === 200 && deepHtml.includes("Elixir MCP"),
  String(deep.status),
);
// A missing static asset is honestly missing, not a 200 of HTML.
const asset = await fetch(`${mcpBase}/assets/not-a-real-file.js`);
check(
  "missing asset is not the shell",
  asset.status === 403 || asset.status === 404,
  String(asset.status),
);

process.exit(failures === 0 ? 0 : 1);
