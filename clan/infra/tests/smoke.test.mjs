import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

for (const frozen of [false, true])
  test(`deployment smoke checks ${frozen ? "frozen" : "active"} Clan using only safe reads`, () => {
    const mockFetch = `
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      console.log("REQUEST " + (init.method ?? "GET") + " " + path);
      const headers = {"content-security-policy": "default-src 'self'; script-src 'self' https://tinylytics.app; img-src 'self' data: https://api-assets.clashroyale.com https://tinylytics.app https://tile.openstreetmap.org", "strict-transport-security": "max-age=31536000", "cache-control": "public, max-age=300"};
      let body = "Elixir Clan", status = 200;
      if (path === "/clan/assets/nope.js") status = 403;
      if (path === "/api/clan/health") body = JSON.stringify({ok:true});
      if (path === "/api/clan/me") { status = 401; body = JSON.stringify({signed_in:false}); }
      if (path.startsWith("/api/clan/clans/")) { status = 401; body = JSON.stringify({signed_in:false}); }
      if (path === "/api/clan/auth/login") {
        status = 303;
        headers.location = "https://elixir.test/oauth/authorize?scope=cr%3Aread&code_challenge_method=S256&redirect_uri=https%3A%2F%2Felixir.test%2Fapi%2Fclan%2Fauth%2Fcallback";
        headers["set-cookie"] = "__Host-elixir_clan_login=fixture";
      }
      if (${frozen} && path.startsWith("/api/clan/") && path !== "/api/clan/health") { status = 503; body = JSON.stringify({error:"clan_migration"}); }
      return new Response(body, {status, headers});
    };
  `;
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(mockFetch)}`,
        "infra/scripts/smoke.mjs",
      ],
      {
        cwd: new URL("../../", import.meta.url),
        env: {
          ...process.env,
          SMOKE_ORIGIN: "https://elixir.test",
          SMOKE_FROZEN: String(frozen),
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.match(output, /smoke passed/);
    const requests = output
      .split("\n")
      .filter((line) => line.startsWith("REQUEST "));
    assert.deepEqual(requests, [
      "REQUEST GET /clan/",
      "REQUEST GET /clan/clans",
      "REQUEST GET /clan/assets/nope.js",
      "REQUEST GET /api/clan/health",
      "REQUEST GET /api/clan/me",
      "REQUEST GET /api/clan/clans/2PPQQRRV/awards",
    ]);
  });
