import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_THROTTLES } from "../../../infra/scripts/api-throttle-config.mjs";
import { parseDeployArgs } from "../../../infra/scripts/lib/deploy-args.mjs";

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

test("deploy flags: every known flag parses, anything else is refused", () => {
  const parsed = parseDeployArgs([
    "--skip-web",
    "--param=OpsQueueArn=arn:aws:sqs:us-east-1:1:q=x",
    "--acceptance=cards,war",
  ]);
  assert.equal(parsed.skipWeb, true);
  assert.equal(parsed.create, false);
  assert.deepEqual(parsed.params, {
    OpsQueueArn: "arn:aws:sqs:us-east-1:1:q=x",
  });
  assert.equal(parsed.acceptance, true);
  assert.equal(parsed.acceptanceFamily, "cards,war");
  assert.deepEqual(parsed.unknown, []);
  assert.equal(parseDeployArgs(["--help"]).help, true);
  assert.equal(parseDeployArgs(["-h"]).help, true);
  // 2026-09-25: `--help` was not a flag and an unknown flag was ignored,
  // so asking for help deployed production.
  for (const typo of ["--dry-run", "--skipweb", "help", "--param=", "-y"])
    assert.deepEqual(parseDeployArgs([typo]).unknown, [typo], typo);
});

test("deploy.mjs refuses its arguments before the first AWS call", async () => {
  const source = await readFile(
    new URL("../../../infra/scripts/deploy.mjs", import.meta.url),
    "utf8",
  );
  const parse = source.indexOf("parseDeployArgs(process.argv");
  const refuse = source.indexOf("args.unknown.length > 0");
  assert.ok(parse > 0 && refuse > parse);
  for (const first of ["new STSClient(", "buildAll(", ".send("])
    assert.ok(refuse < source.indexOf(first), first);
  assert.doesNotMatch(source, /process\.argv\.(includes|find)\(/);
});
