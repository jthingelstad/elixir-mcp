/**
 * When no database connection can be had (a full pool, an instance that
 * will not connect), the site API answers 503 with Retry-After and a
 * request id in each door's own shape, as MCP's live_unavailable does;
 * and the Clan door's unsigned answers read nothing, so they take no
 * lease at all (2026-10-21).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";

function unreachable() {
  const leases = { taken: 0, ended: 0 };
  return {
    leases,
    database: {
      close: async () => {},
      lease() {
        leases.taken += 1;
        return {
          connect: async () => {
            throw new Error("timeout exceeded when trying to connect");
          },
          query: async () => {
            throw new Error("database lease is not open");
          },
          end: async () => {
            leases.ended += 1;
          },
        };
      },
    },
  };
}

const quietly = async (run) => {
  const { error, info } = console;
  const logged = [];
  console.error = (line) => logged.push(line);
  console.info = () => {};
  try {
    return { result: await run(), logged };
  } finally {
    Object.assign(console, { error, info });
  }
};

test("the site API answers a failed connection with 503, Retry-After and words to act on", async () => {
  const { database, leases } = unreachable();
  const handler = makeHandler({ database, secret: "s" });
  const { result: res, logged } = await quietly(() =>
    handler(
      { path: "/api/me", method: "GET", headers: {} },
      { requestId: "r-1" },
    ),
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["retry-after"], "5");
  const body = JSON.parse(res.body);
  assert.equal(body.error, "unavailable");
  assert.match(body.message, /try again in a few seconds/);
  assert.equal(body.request_id, "r-1");
  assert.deepEqual(leases, { taken: 1, ended: 1 });
  assert.deepEqual(logged, [{ event: "db_connect_failed", name: "Error" }]);
});

test("the JSON API answers it with its documented problem, temporarily_unavailable", async () => {
  const { database } = unreachable();
  const handler = makeHandler({ database, secret: "s" });
  const { result: res } = await quietly(() =>
    handler({
      path: "/api/v1/game/clock",
      method: "GET",
      headers: { authorization: "Bearer x" },
    }),
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["content-type"], "application/problem+json");
  assert.equal(res.headers["retry-after"], "5");
  const body = JSON.parse(res.body);
  assert.equal(body.code, "temporarily_unavailable");
  assert.equal(body.status, 503);
  assert.match(body.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers["x-request-id"], body.request_id);
});

test("the Clan door's health check and retired callback take no lease", async () => {
  const { database, leases } = unreachable();
  const clan = async () => {
    throw new Error("the Clan handler is never reached unsigned");
  };
  const handler = makeHandler({ database, secret: "s", clan });
  const { result: health } = await quietly(() =>
    handler({ path: "/api/clan/health", method: "GET", headers: {} }),
  );
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true });
  const { result: callback } = await quietly(() =>
    handler({ path: "/api/clan/auth/callback", method: "POST", headers: {} }),
  );
  assert.equal(callback.statusCode, 410);
  assert.deepEqual(leases, { taken: 0, ended: 0 });
  // Anything else under /api/clan/ still resolves a person first, so it
  // needs the database.
  const { result: signed } = await quietly(() =>
    handler({ path: "/api/clan/health", method: "POST", headers: {} }),
  );
  assert.equal(signed.statusCode, 503);
  assert.deepEqual(leases, { taken: 1, ended: 1 });
});
