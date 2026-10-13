import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHttpApp } from "../src/server.mjs";

test("native HTTP preserves bearer credentials, raw forms, repeated query keys and cookies", async () => {
  let seen;
  const app = makeHttpApp({
    dispatch: async (request, context) => {
      seen = { request, context };
      return {
        statusCode: 303,
        headers: {
          location: "/console",
          "set-cookie": "__Host-elixir_session=a; Path=/; Secure; HttpOnly",
        },
        body: "",
      };
    },
  });
  const response = await app.request(
    "https://origin.example/oauth/authorize?scope=cr%3Aread&scope=write&literal=%2B",
    {
      method: "POST",
      headers: {
        authorization: "Bearer credential",
        cookie: "__Host-elixir_session=old",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "email=fictional%40example.test&code=123456",
    },
  );
  assert.equal(seen.request.headers.authorization, "Bearer credential");
  assert.equal(seen.request.headers.cookie, "__Host-elixir_session=old");
  assert.equal(
    new URLSearchParams(seen.request.rawQueryString).getAll("scope").length,
    2,
  );
  assert.equal(seen.request.body, "email=fictional%40example.test&code=123456");
  assert.ok(seen.context.remainingMs() > 0);
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("binary responses and HEAD bodies keep HTTP semantics", async () => {
  const app = makeHttpApp({
    dispatch: async () => ({
      statusCode: 200,
      headers: { "content-type": "image/png" },
      isBase64Encoded: true,
      body: Buffer.from([0, 255, 4]).toString("base64"),
    }),
  });
  assert.deepEqual(
    Buffer.from(
      await (
        await app.request("https://origin.example/battle/example.png")
      ).arrayBuffer(),
    ),
    Buffer.from([0, 255, 4]),
  );
  assert.equal(
    await (
      await app.request("https://origin.example/battle/example.png", {
        method: "HEAD",
      })
    ).text(),
    "",
  );
});
