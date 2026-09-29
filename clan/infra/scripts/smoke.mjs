#!/usr/bin/env node
/**
 * Read-only checks against the deployed app where Elixir serves it: the
 * app at ElixirUrl/clan, this API at ElixirUrl/api/clan (one origin,
 * 2026-09-28). Runs after every deploy; no sign-in, no spend, no writes.
 * /api/clan/auth/login is deliberately excluded: even its GET creates a
 * pending-login item. The injected handler tests cover the OAuth
 * redirect, cr:read, PKCE and login cookie offline.
 *
 *   node infra/scripts/smoke.mjs            the stack's ElixirUrl
 *   SMOKE_ORIGIN=https://... node infra/scripts/smoke.mjs
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { REGION, STACK } from "./stack.mjs";

async function origin() {
  if (process.env.SMOKE_ORIGIN)
    return process.env.SMOKE_ORIGIN.replace(/\/$/, "");
  const cfn = new CloudFormationClient({ region: REGION });
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: STACK }),
  );
  const elixirUrl = Stacks[0].Parameters?.find(
    (p) => p.ParameterKey === "ElixirUrl",
  )?.ParameterValue;
  if (!elixirUrl) throw new Error("the stack carries no ElixirUrl");
  return elixirUrl.replace(/\/$/, "");
}

async function fetchRetry(url, init, attempts = 6) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        ...init,
      });
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

const base = await origin();
const app = `${base}/clan`;
const api = `${base}/api/clan`;
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

// Every read prints how long it took and, for the API, the server's own
// Server-Timing, so a slow smoke says where the time went.
const timed = async (url, init) => {
  const t = Date.now();
  const res = await fetchRetry(url, init);
  const timing = res.headers.get("server-timing");
  console.log(
    `     ${Date.now() - t} ms  ${url.slice(base.length)}${timing ? `  [${timing}]` : ""}`,
  );
  return res;
};

const home = await timed(`${app}/`);
const homeText = await home.text();
check(
  "GET /clan/ is the app shell",
  home.status === 200 && homeText.includes("Elixir Clan"),
  String(home.status),
);
check(
  "security headers present",
  Boolean(home.headers.get("content-security-policy")) &&
    Boolean(home.headers.get("strict-transport-security")),
);
// Elixir's CSP, which this app now runs under: script from the origin
// and the analytics embed, nothing else.
const csp = home.headers.get("content-security-policy") ?? "";
const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
check(
  "app shell CSP allows script only from 'self' and tinylytics",
  scriptSrc.includes("'self'") &&
    scriptSrc
      .trim()
      .split(/\s+/)
      .every((s) => ["'self'", "https://tinylytics.app"].includes(s)),
  scriptSrc,
);

// The clan map (Social, 2026-09-26) draws OpenStreetMap's tiles. Card
// art and the analytics pixel are Elixir's to allow too.
const imgSrc = /img-src ([^;]+)/.exec(csp)?.[1] ?? "";
check(
  "app shell CSP allows OpenStreetMap's tiles",
  imgSrc.split(/\s+/).includes("https://tile.openstreetmap.org"),
  imgSrc,
);

const route = await timed(`${app}/clans`);
check(
  "GET /clan/clans serves the app shell (SPA router)",
  route.status === 200 && (await route.text()).includes("Elixir Clan"),
  String(route.status),
);

const missing = await timed(`${app}/assets/nope.js`);
check(
  "a missing /clan/assets/ file is honestly a miss",
  missing.status === 403 || missing.status === 404,
  String(missing.status),
);

const health = await timed(`${api}/health`);
let healthBody = {};
try {
  healthBody = await health.json();
} catch {
  healthBody = {};
}
check(
  "GET /api/clan/health",
  health.status === 200 && healthBody.ok === true,
  String(health.status),
);

const me = await timed(`${api}/me`);
let meBody = {};
try {
  meBody = await me.json();
} catch {
  meBody = {};
}
check(
  "GET /api/clan/me signed out is 401 JSON",
  me.status === 401 && meBody.signed_in === false,
  String(me.status),
);

// Nothing under a clan answers without a session: Elixir Clan publishes
// no public pages or documents (Jamie, 2026-09-25). The tag is invented.
const clanRead = await timed(`${api}/clans/2PPQQRRV/awards`);
check(
  "a clan route with no session is 401",
  clanRead.status === 401,
  String(clanRead.status),
);

if (checks.every(Boolean)) {
  console.log(`smoke passed at ${base}`);
} else {
  console.error(`smoke FAILED at ${base}`);
  process.exit(1);
}
