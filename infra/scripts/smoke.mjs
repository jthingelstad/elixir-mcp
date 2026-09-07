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

// Site: the shell must serve.
const site = await fetch(`https://${outputs.SiteDistributionDomain}/`);
check("site shell", site.ok, String(site.status));
const html = site.ok ? await site.text() : "";
check("site is the app", html.includes("Elixir MCP"));

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
