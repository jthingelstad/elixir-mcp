/**
 * The deploy's smoke gate (infra/scripts/smoke.mjs) against a fake
 * origin: a healthy one passes every check, and each regression a check
 * exists for fails that check by name. Nothing here reaches AWS or the
 * network.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runSmoke } from "../../../infra/scripts/smoke.mjs";

const DOMAIN = "d111111abcdef8.cloudfront.net";
const stack = {
  StackStatus: "UPDATE_COMPLETE",
  Outputs: [{ OutputKey: "SiteDistributionDomain", OutputValue: DOMAIN }],
};

const SITE_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' https://tinylytics.app; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};
const HOME = `<html><body><header><a class="chrome__product" href="/console">Console</a><button class="chrome__menu">Menu</button></header><div id="chrome-sheet"><a href="/docs">Docs</a></div><main><section data-transcript>...</section></main></body></html>`;
const APP = `<html><body><div id="root"><p>Sign in first</p></div><script type="application/json" id="elixir-bootstrap">{}</script></body></html>`;
const APP_CSP =
  "default-src 'self'; script-src 'self' https://tinylytics.app https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'";
const CONSENT_CSP =
  "default-src 'self'; form-action 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*";

/** What a healthy origin answers, by path (the query dropped). */
function healthy() {
  const text = (body, headers = {}, status = 200) => ({
    status,
    body,
    headers,
  });
  const cached = () => {
    let seen = 0;
    return () => {
      seen += 1;
      return text("{}", {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
        "x-cache": seen === 1 ? "Miss from cloudfront" : "Hit from cloudfront",
      });
    };
  };
  return {
    "/.well-known/oauth-authorization-server": () =>
      text(JSON.stringify({ issuer: "https://elixir.poapkings.com" })),
    "POST /mcp": () =>
      text(
        "",
        {
          "www-authenticate": `Bearer resource_metadata="https://elixir.poapkings.com/.well-known/oauth-protected-resource"`,
        },
        401,
      ),
    "/": () => text(HOME, SITE_HEADERS),
    "/data": () => text("<main>12,345 battles recorded</main>", SITE_HEADERS),
    "/oauth/authorize": () =>
      text("<form>", { "content-security-policy": CONSENT_CSP }),
    "/api/public/status": cached(),
    "/api/public/cards": cached(),
    "/console/account/overview": () =>
      text(APP, { "content-security-policy": APP_CSP }),
    "/docs/tools": () =>
      text(
        "<title>Tools - Elixir</title><main>players_profile live_fetch</main>",
      ),
    "/llms.txt": () =>
      text("# Elixir\n\n## MCP connection\n", {
        "content-type": "text/plain; charset=utf-8",
      }),
    "/tools.json": () => text(JSON.stringify({ tool_count: 41 })),
    "/sitemap.xml": () => text("<loc>https://e/docs/tools</loc>"),
    "/robots.txt": () =>
      text("Sitemap: https://elixir.poapkings.com/sitemap.xml\n", {
        "content-type": "text/plain; charset=utf-8",
      }),
    "/api/admin/requests": () =>
      text(
        JSON.stringify({ error: "forbidden" }),
        { "content-type": "application/json" },
        403,
      ),
    "/api/definitely-not-a-route": () => text("{}", {}, 404),
    "/assets/not-a-real-file.js": () => text("AccessDenied", {}, 403),
  };
}

/** A fetch over these routes, recording each request. */
function origin(routes) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const { host, pathname } = new URL(url);
    assert.equal(host, DOMAIN);
    const key = init.method === "POST" ? `POST ${pathname}` : pathname;
    requests.push({ key, init });
    const route = routes[key];
    if (!route) throw new Error(`smoke asked for an unknown route ${key}`);
    const { status, body, headers } = route();
    return new Response(body, { status, headers });
  };
  return { fetch, requests };
}

async function smoke(patch = {}, { stackStatus } = {}) {
  const routes = { ...healthy(), ...patch };
  const { fetch, requests } = origin(routes);
  const sleeps = [];
  const result = await runSmoke({
    stack: stackStatus ? { ...stack, StackStatus: stackStatus } : stack,
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: () => {},
  });
  const failed = result.results.filter((r) => !r.ok).map((r) => r.name);
  return { ...result, failed, requests, sleeps };
}

test("smoke: a healthy origin passes every check, and the site pages are read past the edge cache", async () => {
  const run = await smoke();
  assert.deepEqual(run.failed, []);
  assert.equal(run.failures, 0);
  assert.ok(run.results.length >= 40, String(run.results.length));
  for (const page of ["/", "/data"]) {
    const asked = run.requests.find((r) => r.key === page);
    assert.equal(asked.init.headers["cache-control"], "no-cache", page);
    assert.equal(asked.init.cache, "no-store", page);
  }
  // The first public read was a Miss; the second hit, so no wait.
  assert.deepEqual(run.sleeps, []);
});

test("smoke: each regression fails the check written for it", async () => {
  const shell = () => ({
    status: 200,
    body: '<div id="root"></div>',
    headers: { "content-type": "text/html" },
  });
  for (const [why, patch, want, options] of [
    [
      "a rolled-back stack",
      {},
      ["stack status"],
      { stackStatus: "UPDATE_ROLLBACK_COMPLETE" },
    ],
    [
      "/mcp answering without a bearer",
      { "POST /mcp": () => ({ status: 200, body: "{}", headers: {} }) },
      ["mcp refuses without bearer", "www-authenticate present"],
    ],
    [
      "the edge's error mapping turning API refusals into the shell (2026-09)",
      { "/api/admin/requests": shell },
      ["api refusal keeps its status", "api refusal keeps its json"],
    ],
    [
      "every URL serving the one app shell (before the 2026-09-07 split)",
      { "/": () => ({ ...shell(), headers: SITE_HEADERS }) },
      [
        "home is a real document",
        "home leads with the transcript",
        "the narrow menu is on the bar, and the product buttons are not in it",
      ],
    ],
    [
      "llms.txt read as Latin-1 (2026-09-10)",
      {
        "/llms.txt": () => ({
          status: 200,
          body: "## MCP connection",
          headers: { "content-type": "text/plain" },
        }),
      },
      ["llms.txt names its charset"],
    ],
    [
      "the edge overwriting the consent page's CSP",
      {
        "/oauth/authorize": () => ({
          status: 200,
          body: "",
          headers: { "content-security-policy": "default-src 'self'" },
        }),
      },
      [
        "consent page may redirect a form to the client",
        "consent page may redirect a form to a local client",
      ],
    ],
    [
      "a third-party script on the app shell",
      {
        "/console/account/overview": () => ({
          status: 200,
          body: APP,
          headers: {
            "content-security-policy": APP_CSP.replace(
              "https://tinylytics.app",
              "https://tinylytics.app https://cdn.example",
            ),
          },
        }),
      },
      [
        "app shell CSP allows only tinylytics and Turnstile as third-party script",
      ],
    ],
    [
      "inline script allowed on the site",
      {
        "/": () => ({
          status: 200,
          body: HOME,
          headers: {
            ...SITE_HEADERS,
            "content-security-policy":
              "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
          },
        }),
      },
      ["CSP forbids inline script"],
    ],
    [
      "a missing asset answered with HTML",
      { "/assets/not-a-real-file.js": shell },
      ["missing asset is not the shell"],
    ],
    [
      "the corpus page without its totals",
      {
        "/data": () => ({
          status: 200,
          body: "<main>battles</main>",
          headers: {},
        }),
      },
      ["the corpus page carries live totals"],
    ],
  ]) {
    const run = await smoke(patch, options);
    assert.deepEqual(run.failed, want, why);
    assert.equal(run.failures, want.length, why);
  }
});

test("smoke: a cache that never hits fails after six bounded retries; one that settles passes", async () => {
  const miss = () => ({
    status: 200,
    body: "{}",
    headers: {
      "cache-control": "public, max-age=60",
      "x-cache": "Miss from cloudfront",
    },
  });
  const never = await smoke({ "/api/public/status": miss });
  assert.deepEqual(never.failed, ["public status caches at the edge"]);
  assert.equal(
    never.requests.filter((r) => r.key === "/api/public/status").length,
    7,
  );
  assert.deepEqual(never.sleeps, Array(6).fill(500));

  // After a deploy's invalidation the first few requests land on
  // different empty edges: a hit on the fourth request is a pass.
  let seen = 0;
  const settles = await smoke({
    "/api/public/cards": () => {
      seen += 1;
      return {
        ...miss(),
        headers: {
          ...miss().headers,
          "x-cache": seen < 4 ? "Miss from cloudfront" : "Hit from cloudfront",
        },
      };
    },
  });
  assert.deepEqual(settles.failed, []);
  assert.deepEqual(settles.sleeps, [500, 500]);

  // A response that forgets its own freshness fails even when it hits.
  const fresh = await smoke({
    "/api/public/cards": () => ({
      status: 200,
      body: "{}",
      headers: { "x-cache": "Hit from cloudfront" },
    }),
  });
  assert.deepEqual(fresh.failed, [
    "public cards still declares its own freshness",
  ]);
});
