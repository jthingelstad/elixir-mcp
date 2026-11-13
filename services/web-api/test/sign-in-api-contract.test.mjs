/**
 * /api/v1 is exactly what Sign in with Elixir needs (Jamie, 2026-11-13:
 * "Keep only sign-in"; DECISIONS "No integrations: Elixir has users and
 * agents"): `GET /api/v1/me` and nothing else. A new path here is a new
 * product surface, which that decision closed: it fails this test until
 * the decision is changed first.
 *
 * The version moves with the shape (DECISIONS "The JSON API keeps
 * ordinary semver"): the pin is the structural shape, descriptions
 * stripped, of the operations and their schemas. When it moves, bump
 * info.version (a removed or renamed field is a major, an addition a
 * minor) and write the new version and fingerprint beside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import contract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };
import { v1Operation } from "../src/sign-in-api.mjs";

const strip = (v) =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k !== "description" && k !== "summary")
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, strip(x)]),
        )
      : v;

test("/api/v1 serves exactly the sign-in surface: GET /me", () => {
  const served = Object.entries(contract.paths).flatMap(([p, methods]) =>
    Object.keys(methods).map((m) => `${m.toUpperCase()} /api/v1${p}`),
  );
  assert.deepEqual(served, ["GET /api/v1/me"]);
  assert.deepEqual(Object.keys(contract.components.securitySchemes), [
    "personOAuth",
  ]);
});

test("the door answers the contract's one operation and no other path", () => {
  assert.equal(v1Operation("GET", "/api/v1/me"), "me");
  for (const [method, path] of [
    ["POST", "/api/v1/me"],
    ["HEAD", "/api/v1/me"],
    ["GET", "/api/v1/me/"],
    ["POST", "/api/v1/me/players"],
    ["GET", "/api/v1/me/cheers"],
    ["GET", "/api/v1/game/clock"],
    ["GET", "/api/v1/players/%230CR"],
    ["GET", "/api/v1/players/%230CR/profile"],
    ["POST", "/api/v1/players/%230CR/facts"],
    ["POST", "/api/v1/profile-refreshes"],
    ["GET", "/api/v1/clans/%230CR/roster"],
    ["GET", "/api/v1/clans/directory"],
    ["GET", "/api/v1/feedback"],
    ["GET", "/api/v1/models"],
    ["GET", "/api/v1"],
  ])
    assert.equal(v1Operation(method, path), null, `${method} ${path}`);
});

test("the JSON API's version moves whenever its shape does", () => {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([strip(contract.paths), strip(contract.components)]))
    .digest("hex")
    .slice(0, 16);
  const pin = JSON.parse(
    readFileSync(new URL("./sign-in-api.pin.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    { version: contract.info.version, fingerprint },
    pin,
    "/api/v1 changed shape: bump info.version in integration-api.openapi.json (a removed or renamed field is a major) and write the new version and fingerprint into sign-in-api.pin.json.",
  );
});
