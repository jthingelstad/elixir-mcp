/**
 * The token requests: a configured client secret rides both grants as
 * client_secret in the form (client_secret_post), none rides without
 * one, and no log line ever carries the form. The revocation at sign-out
 * authenticates the same way and never throws.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createOAuthClient } from "../src/oauth.mjs";
import { SLOW_CALL_MS, current, summarize, withTrace } from "../src/trace.mjs";

const ISSUER = "https://elixir.test";
const SECRET = "ecs_test-secret-never-logged";

function fakeFetch({
  tokenStatus = 200,
  slow = false,
  revocation = true,
  revokeStatus = 200,
  revokeThrows = false,
} = {}) {
  const tokenForms = [];
  const revokeForms = [];
  async function fetchImpl(url, init = {}) {
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return Response.json({
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        ...(revocation
          ? { revocation_endpoint: `${ISSUER}/oauth/revoke` }
          : {}),
      });
    }
    if (url === `${ISSUER}/oauth/revoke`) {
      assert.equal(init.method, "POST");
      revokeForms.push(Object.fromEntries(new URLSearchParams(init.body)));
      if (revokeThrows) throw new Error("connect ETIMEDOUT");
      return Response.json({}, { status: revokeStatus });
    }
    assert.equal(url, `${ISSUER}/oauth/token`);
    assert.equal(init.method, "POST");
    tokenForms.push(Object.fromEntries(new URLSearchParams(init.body)));
    if (slow) mock.timers.tick(SLOW_CALL_MS);
    if (tokenStatus !== 200)
      return Response.json(
        { error: "invalid_grant", error_description: "no" },
        { status: tokenStatus },
      );
    return Response.json({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "cr:read",
    });
  }
  return { fetchImpl, tokenForms, revokeForms };
}

function client(fetchImpl, clientSecret) {
  return createOAuthClient({
    issuer: ISSUER,
    resource: `${ISSUER}/api/v1`,
    clientId: "cid",
    ...(clientSecret === undefined ? {} : { clientSecret }),
    fetch: fetchImpl,
  });
}

async function bothGrants(oauth) {
  const exchanged = await oauth.exchange({
    code: "code",
    codeVerifier: "verifier",
    redirectUri: "https://elixir.test/api/clan/auth/callback",
  });
  const refreshed = await oauth.refresh({ refreshToken: "rt-old" });
  return [exchanged, refreshed];
}

test("with a secret, both token requests carry client_secret beside client_id", async () => {
  const { fetchImpl, tokenForms } = fakeFetch();
  const results = await bothGrants(client(fetchImpl, SECRET));
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(
    tokenForms.map((f) => f.grant_type),
    ["authorization_code", "refresh_token"],
  );
  for (const form of tokenForms) {
    assert.equal(form.client_id, "cid");
    assert.equal(form.client_secret, SECRET);
  }
});

test("without a secret, neither token request carries client_secret", async () => {
  for (const secret of [undefined, ""]) {
    const { fetchImpl, tokenForms } = fakeFetch();
    const results = await bothGrants(client(fetchImpl, secret));
    assert.ok(results.every((r) => r.ok));
    assert.equal(tokenForms.length, 2);
    for (const form of tokenForms) {
      assert.equal(form.client_id, "cid");
      assert.equal("client_secret" in form, false);
    }
  }
});

test("no log line carries the form: not the secret, the code, the verifier or a token", async (t) => {
  const printed = [];
  for (const level of ["log", "info", "warn", "error"])
    t.mock.method(console, level, (...args) => printed.push(args.join(" ")));
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  t.after(() => mock.timers.reset());

  // The request's own line, as the handler writes it at the end.
  const lines = [];
  for (const options of [{ slow: true }, { tokenStatus: 400, slow: true }]) {
    const { fetchImpl } = fakeFetch(options);
    const oauth = client(fetchImpl, SECRET);
    await withTrace({ http: "GET /auth/callback" }, async () => {
      await bothGrants(oauth);
      lines.push(JSON.stringify(summarize(current(), 200)));
    });
  }
  // The slow calls were logged on their own lines.
  assert.ok(printed.some((line) => line.includes("slow_elixir_call")));
  const everything = [...printed, ...lines].join("\n");
  for (const needle of [SECRET, "verifier", "rt-old", "code_verifier"])
    assert.equal(everything.includes(needle), false, needle);
});

test("revoke: the token and client authenticate as the token requests do", async () => {
  const withSecret = fakeFetch();
  assert.deepEqual(
    await client(withSecret.fetchImpl, SECRET).revoke({ token: "ert_9" }),
    { ok: true },
  );
  assert.deepEqual(withSecret.revokeForms, [
    { token: "ert_9", client_id: "cid", client_secret: SECRET },
  ]);

  const without = fakeFetch();
  await client(without.fetchImpl, "").revoke({ token: "ert_9" });
  assert.deepEqual(without.revokeForms, [{ token: "ert_9", client_id: "cid" }]);
});

test("revoke: a refusal, a transport failure or no endpoint is an answer, never a throw", async () => {
  const cases = [
    [{ revokeStatus: 401 }, { ok: false, status: 401, error: "http 401" }],
    [
      { revokeThrows: true },
      { ok: false, error: "transport: connect ETIMEDOUT" },
    ],
    [
      { revocation: false },
      { ok: false, error: "discovery lacks revocation_endpoint" },
    ],
  ];
  for (const [options, expected] of cases) {
    const { fetchImpl } = fakeFetch(options);
    assert.deepEqual(
      await client(fetchImpl, SECRET).revoke({ token: "ert_9" }),
      expected,
    );
  }
  const down = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  assert.deepEqual(await client(down, SECRET).revoke({ token: "ert_9" }), {
    ok: false,
    error: "transport: getaddrinfo ENOTFOUND",
  });
});
