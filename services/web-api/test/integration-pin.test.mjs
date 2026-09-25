/**
 * The JSON API's version moves with its shape (docs/DECISIONS.md: the
 * JSON API keeps ordinary semver). Its person operations answer with an
 * MCP tool's structured result, and an MCP field removal is only a patch
 * (the agent-facing rule), so a change made for agents can silently
 * change what a program reads here. 9.0.0 did exactly that and the JSON
 * API stayed at 1.3.0 (audit, 2026-09-25).
 *
 * The pin is the structural shape - descriptions stripped - of every
 * mirrored tool's input and output schema plus the operations
 * themselves. When it moves, bump info.version (a removed or renamed
 * field is a major, an addition a minor) and update the pin beside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import contract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };
import { makeRegistry } from "../../mcp/src/tools.mjs";

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

test("the JSON API's version moves whenever a mirrored tool's shape does", () => {
  const byName = new Map(
    makeRegistry()
      .declarations()
      .map((d) => [d.name, d]),
  );
  const mirrored = [];
  for (const [p, ops] of Object.entries(contract.paths))
    for (const [method, op] of Object.entries(ops))
      if (op["x-tool"]) mirrored.push([`${method} ${p}`, op["x-tool"]]);
  mirrored.sort(([a], [b]) => a.localeCompare(b));
  const shape = mirrored.map(([op, tool]) => {
    const d = byName.get(tool);
    assert.ok(d, `${op} mirrors ${tool}, which is not a tool`);
    return [op, tool, strip(d.inputSchema), strip(d.outputSchema ?? null)];
  });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([shape, strip(contract.paths)]))
    .digest("hex")
    .slice(0, 16);
  const pin = JSON.parse(
    readFileSync(
      new URL("./integration-api.pin.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    { version: contract.info.version, fingerprint },
    pin,
    "A tool the JSON API mirrors (or the API itself) changed shape: bump info.version in integration-api.openapi.json (a removed or renamed field is a major) and write the new version and fingerprint into integration-api.pin.json.",
  );
});
