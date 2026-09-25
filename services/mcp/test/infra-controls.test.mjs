import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_THROTTLES } from "../../../infra/scripts/api-throttle-config.mjs";

const templateUrl = new URL("../../../infra/template.yaml", import.meta.url);

function resource(template, logicalId, nextLogicalId) {
  return template.slice(
    template.indexOf(`  ${logicalId}:`),
    template.indexOf(`  ${nextLogicalId}:`),
  );
}

test("SQS visibility outlasts each Lambda timeout by six times", async () => {
  const template = await readFile(templateUrl, "utf8");
  const emailQueue = resource(template, "EmailQueue", "EmailDlq");
  const editorQueue = resource(
    template,
    "EditorQueue",
    "EditorDeadLetterQueue",
  );

  assert.match(emailQueue, /^      VisibilityTimeout: 360$/m);
  assert.match(editorQueue, /^      VisibilityTimeout: 5040$/m);
});

test("database-facing Lambda concurrency remains bounded", async () => {
  const template = await readFile(templateUrl, "utf8");
  const expected = [
    ["WebApiFunction", "McpLogGroup", 20],
    ["McpFunction", "SchedulerLogGroup", 20],
    ["SchedulerFunction", "SchedulerRule", 1],
    ["MigrateFunction", "JobsLogGroup", 1],
    ["JobsFunction", "EditorLogGroup", 1],
  ];

  for (const [logicalId, nextLogicalId, concurrency] of expected) {
    assert.match(
      resource(template, logicalId, nextLogicalId),
      new RegExp(`^      ReservedConcurrentExecutions: ${concurrency}$`, "m"),
      logicalId,
    );
  }
});

test("API throttles preserve measured production bursts", () => {
  assert.deepEqual(API_THROTTLES, [
    {
      apiName: "elixir-mcp-site-api",
      rateLimit: 20,
      burstLimit: 40,
    },
    {
      apiName: "elixir-mcp-mcp-api",
      rateLimit: 50,
      burstLimit: 100,
    },
  ]);
});
