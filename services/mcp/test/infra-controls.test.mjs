import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { API_THROTTLES } from "../../../infra/scripts/api-throttle-config.mjs";
import { parseDeployArgs } from "../../../infra/scripts/lib/deploy-args.mjs";
import { ciGate } from "../../../infra/scripts/lib/ci-gate.mjs";
import {
  bundleFingerprint,
  chooseLane,
  codeKey,
  sameTemplate,
} from "../../../infra/scripts/lib/deploy-lane.mjs";
import {
  IMMUTABLE,
  REVALIDATE,
  hashedAssets,
  publishSteps,
  pruneCandidates,
} from "../../../infra/scripts/lib/site-publish.mjs";
import {
  CORPUS_SOURCES,
  LAMBDAS,
  RDS_CA_BUNDLE,
  RDS_CA_PATH,
  repoRoot,
  sourceDateEpoch,
} from "../../../infra/scripts/build.mjs";
import {
  buildParameters,
  originRotation,
  PRESERVED_PARAMETERS,
} from "../../../infra/scripts/parameters.mjs";

const templateUrl = new URL("../../../infra/template.yaml", import.meta.url);

test("the model relay can distinguish unwritten replies without reading other outbox bodies", async () => {
  const template = await readFile(templateUrl, "utf8");
  const role = resource(template, "EmailRelayRole", "EmailRelayFunction");
  assert.match(
    role,
    /Action: s3:ListBucket\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\n\s+Condition:\n\s+StringLike:\n\s+s3:prefix:\n\s+- clan-model\/reply\/\*\n\s+- clan-model\/claim\/\*\n\s+NumericLessThanEquals:\n\s+s3:max-keys: "1"/,
  );
  assert.equal((role.match(/Action: s3:ListBucket/g) ?? []).length, 1);
  assert.match(
    role,
    /Action: s3:GetObject\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\/clan-model\/\*/,
  );
  assert.doesNotMatch(
    role,
    /Action: s3:GetObject\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\/\*/,
  );
});

function resource(template, logicalId, nextLogicalId) {
  return template.slice(
    template.indexOf(`  ${logicalId}:`),
    template.indexOf(`  ${nextLogicalId}:`),
  );
}

test("SQS visibility outlasts each Lambda timeout by six times", async () => {
  const template = await readFile(templateUrl, "utf8");
  const emailQueue = resource(template, "EmailQueue", "EmailDlq");

  assert.match(emailQueue, /^      VisibilityTimeout: 360$/m);
  assert.doesNotMatch(template, /^  Editor(?:Function|Queue|EventSource):/m);
});

test("database-facing Lambda concurrency remains bounded", async () => {
  const template = await readFile(templateUrl, "utf8");
  const expected = [
    ["WebApiFunction", "CollectorLogGroup", 20],
    ["CollectorFunction", "McpLogGroup", 10],
    ["McpFunction", "SchedulerLogGroup", 20],
    ["SchedulerFunction", "SchedulerRule", 1],
    ["MigrateFunction", "JobsLogGroup", 1],
    ["JobsFunction", "EmailClanReportRule", 1],
  ];

  for (const [logicalId, nextLogicalId, concurrency] of expected) {
    assert.match(
      resource(template, logicalId, nextLogicalId),
      new RegExp(`^      ReservedConcurrentExecutions: ${concurrency}$`, "m"),
      logicalId,
    );
  }
});

test("the jobs Lambda's async retries are stated: two, inside an hour", async () => {
  // Review 2026-09-27 §6.7: a mail run that stops short of its
  // recipients fails on purpose, and the retry carries on from the ledger.
  const template = await readFile(templateUrl, "utf8");
  const block = resource(template, "JobsInvokeConfig", "EditorLogGroup");
  assert.match(block, /Type: AWS::Lambda::EventInvokeConfig/);
  assert.match(block, /FunctionName: !Ref JobsFunction/);
  assert.match(block, /^      MaximumEventAgeInSeconds: 3600$/m);
  assert.match(block, /^      MaximumRetryAttempts: 2$/m);
});

test("every database-facing Lambda names its connections and bounds its statements under its own timeout", async () => {
  // Review 2026-09-27 §3.1: five functions connected as one user with no
  // application_name and, the invoker's budget aside, no statement bound,
  // so a statement a Lambda abandoned ran on (0099, 2026-09-15; two `pop`
  // backends of 42 and 57 minutes, 2026-09-18).
  const template = await readFile(templateUrl, "utf8");
  const functions = [
    ["WebApiFunction", "CollectorLogGroup", "elixir-mcp-web-api"],
    ["CollectorFunction", "McpLogGroup", "elixir-mcp-collector"],
    ["McpFunction", "SchedulerLogGroup", "elixir-mcp-mcp"],
    ["SchedulerFunction", "SchedulerRule", "elixir-mcp-scheduler"],
    ["MigrateFunction", "JobsLogGroup", "elixir-mcp-migrate"],
    ["JobsFunction", "EmailClanReportRule", "elixir-mcp-jobs"],
  ];
  for (const [logicalId, nextLogicalId, name] of functions) {
    const block = resource(template, logicalId, nextLogicalId);
    assert.match(block, /DATABASE_URL:/, logicalId);
    assert.match(
      block,
      new RegExp(`^          PGAPPNAME: ${name}$`, "m"),
      logicalId,
    );
    const timeoutMatch = /^      Timeout: (\d+)$/m.exec(block);
    const timeouts = timeoutMatch ? [Number(timeoutMatch[1])] : [20, 30];
    if (!timeoutMatch) {
      assert.equal(logicalId, "WebApiFunction");
      assert.match(block, /^      Timeout: !If \[HasInternalClan, 30, 20\]$/m);
    }
    const options = /^          PGOPTIONS: "(.+)"$/m.exec(block)?.[1] ?? "";
    const statement = /-c statement_timeout=(\d+)s\b/.exec(options);
    assert.ok(statement, `${logicalId} sets statement_timeout`);
    assert.ok(
      timeouts.every((timeout) => Number(statement[1]) < timeout),
      `${logicalId}: statement_timeout ${statement[1]} s is under the ${timeouts.join("/")} s Lambda timeouts`,
    );
    assert.match(
      options,
      /-c idle_in_transaction_session_timeout=60s\b/,
      logicalId,
    );
    assert.doesNotMatch(
      options,
      /lock_timeout/,
      `${logicalId}: lock_timeout belongs to the read-only tool path only (the invoker), never a whole function`,
    );
  }
  // No other function reaches the database.
  assert.equal((template.match(/^          DATABASE_URL:/gm) ?? []).length, 6);
});

test("the collector door is its own function, role and route on the site API (2026-09-29)", async () => {
  const template = await readFile(templateUrl, "utf8");
  // The role puts payloads and mail and nothing else: a write-once put
  // needs no read, and the door lists nothing.
  const role = resource(template, "CollectorRole", "McpRole");
  assert.match(role, /RoleName: elixir-mcp-collector\n/);
  assert.deepEqual(
    [...role.matchAll(/^ {16}Action: (.+)$/gm)].map((m) => m[1]),
    ["s3:PutObject", "s3:PutObject"],
  );
  assert.match(
    role,
    /- \$\{Arn\}\/payloads\/\*\n\s+- Arn: !GetAtt ArchiveBucket\.Arn/,
  );
  assert.match(role, /elixir-mcp-outbox-\$\{AWS::AccountId\}\/email\/\*\n/);
  assert.match(
    resource(template, "CollectorFunction", "McpLogGroup"),
    /Role: !GetAtt CollectorRole\.Arn/,
  );
  // One API, one CloudFront behaviour: a route with a path beats
  // $default, and the route waits for the permission it invokes with.
  const route = resource(template, "CollectorRoute", "CollectorApiPermission");
  assert.match(route, /DependsOn: CollectorApiPermission/);
  assert.match(route, /ApiId: !Ref SiteApi/);
  assert.match(route, /RouteKey: ANY \/api\/collector\/\{proxy\+\}/);
  assert.match(route, /Target: !Sub integrations\/\$\{CollectorIntegration\}/);
  const integration = resource(
    template,
    "CollectorIntegration",
    "CollectorRoute",
  );
  assert.match(integration, /IntegrationUri: !GetAtt CollectorFunction\.Arn/);
  assert.match(integration, /PayloadFormatVersion: "2\.0"/);
  // Its ingest failures and its crashes page as the web-api's did.
  const filter = resource(
    template,
    "CollectorSubmitIngestErrorFilter",
    "SubmitIngestErrorAlarm",
  );
  assert.match(filter, /LogGroupName: !Ref CollectorLogGroup/);
  assert.match(filter, /MetricName: SubmitIngestError\n/);
  const errors = resource(template, "CollectorErrorsAlarm", "McpLatencyAlarm");
  assert.match(errors, /Value: !Ref CollectorFunction/);
  assert.match(errors, /AlarmActions: \[!Ref AlarmTopic\]/);
  // The writer sends If-None-Match before the policy demands it.
  assert.match(
    resource(template, "ArchiveBucketPolicy", "GlueArchiveDatabase"),
    /DependsOn: CollectorFunction\n/,
  );
  // The web-api no longer serves the door (2026-09-29): no payloads/
  // grant on its role, and no ingest filter on its log.
  assert.doesNotMatch(
    resource(template, "WebApiRole", "CollectorRole"),
    /\$\{Arn\}\/payloads\//,
  );
  assert.doesNotMatch(template, /^  SubmitIngestErrorFilter:/m);
  assert.doesNotMatch(
    template,
    /LogGroupName: !Ref WebApiLogGroup\n\s+FilterPattern: '"submit_ingest_error"'/,
  );
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
  assert.equal(parsed.breakGlass, false);
  assert.equal(parsed.platform, false);
  assert.equal(parseDeployArgs(["--break-glass"]).breakGlass, true);
  assert.equal(parseDeployArgs(["--platform"]).platform, true);
  assert.equal(
    parseDeployArgs(["--verify-reference-seed"]).verifyReferenceSeed,
    true,
  );
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
  // The CI gate, too, decides before anything is built or sent.
  const gate = source.indexOf("await ciGate(");
  assert.ok(gate > refuse);
  for (const first of ["new STSClient(", "buildAll(", ".send("])
    assert.ok(gate < source.indexOf(first), first);
  assert.doesNotMatch(source, /process\.argv\.(includes|find)\(/);
});

// Deploy lanes (structural assessment, Phase 4, 2026-09-29).
test("deploy lanes: a bundle is named by its content, never its zip or its mtimes", async () => {
  const a = await mkdtemp(path.join(tmpdir(), "lane-a-"));
  const b = await mkdtemp(path.join(tmpdir(), "lane-b-"));
  try {
    await writeFile(path.join(a, "index.mjs"), "export const x = 1;\n");
    await cp(path.join(a, "index.mjs"), path.join(a, "certificates-rds.pem"));
    const first = bundleFingerprint(a);
    assert.match(first, /^[0-9a-f]{16}$/);
    // The same files elsewhere, written later: the same name.
    await cp(a, b, { recursive: true });
    await utimes(path.join(b, "index.mjs"), 1, 1);
    assert.equal(bundleFingerprint(b), first);
    // One byte, or one file's name, is a different bundle.
    await writeFile(path.join(b, "index.mjs"), "export const x = 2;\n");
    assert.notEqual(bundleFingerprint(b), first);
    await rm(b, { recursive: true });
    await cp(a, b, { recursive: true });
    await cp(path.join(b, "index.mjs"), path.join(b, "other.mjs"));
    await rm(path.join(b, "index.mjs"));
    assert.notEqual(bundleFingerprint(b), first);
    assert.equal(codeKey("mcp", first), `code/mcp/${first}.zip`);
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("deploy lanes: the live template matches with its non-ASCII stored as ?", () => {
  // Measured 2026-09-29: GetTemplate (Original) hands back every
  // section sign and dash of template.yaml as "?".
  assert.equal(sameTemplate("a \u00a7 b \u2014 c", "a ? b ? c"), true);
  assert.equal(sameTemplate("a \u00a7 b", "a \u00a7 b"), false);
  assert.equal(sameTemplate("a: 1", "a: 2"), false);
  assert.equal(sameTemplate("a: 1", undefined), false);
});

test("deploy lanes: the site lane only when nothing CloudFormation holds would change", () => {
  const codeKeys = { CodeBucket: "bucket", McpCodeKey: "code/mcp/1.zip" };
  const liveParameters = [
    { ParameterKey: "CodeBucket", ParameterValue: "bucket" },
    { ParameterKey: "McpCodeKey", ParameterValue: "code/mcp/1.zip" },
    { ParameterKey: "OpsQueueArn", ParameterValue: "arn" },
  ];
  const same = { codeKeys, liveParameters, template: "t", liveTemplate: "t" };
  assert.deepEqual(chooseLane(same), { lane: "site", changed: [] });
  assert.deepEqual(
    chooseLane({
      ...same,
      codeKeys: { ...codeKeys, McpCodeKey: "code/mcp/2.zip" },
    }),
    { lane: "platform", changed: ["McpCodeKey"] },
  );
  assert.deepEqual(chooseLane({ ...same, liveTemplate: "u" }).changed, [
    "template",
  ]);
  assert.deepEqual(chooseLane({ ...same, parameterChange: true }).changed, [
    "parameters",
  ]);
  assert.deepEqual(chooseLane({ ...same, platform: true }).changed, [
    "--platform",
  ]);
  // A stack that does not carry a key yet is a change, not a match.
  assert.equal(
    chooseLane({ ...same, liveParameters: liveParameters.slice(0, 1) }).lane,
    "platform",
  );
});

test("deploy lanes: migrations and the stack update run only in the platform lane", async () => {
  const source = await readFile(
    new URL("../../../infra/scripts/deploy.mjs", import.meta.url),
    "utf8",
  );
  const lane = source.indexOf("chooseLane({");
  const migrate = source.indexOf('if (!isCreate && lane === "platform")');
  const stack = source.indexOf('if (lane === "platform") {');
  assert.ok(lane > 0 && migrate > lane && stack > migrate);
  assert.ok(
    migrate < source.indexOf('await runMigrations("elixir-mcp-migrate")'),
  );
  assert.ok(stack < source.indexOf("new UpdateStackCommand("));
  assert.ok(stack < source.indexOf("new ValidateTemplateCommand("));
  // The vocabulary rides every deploy, site lane included.
  const vocabulary = source.indexOf(
    "const vocabulary = verifiedReferenceSeed?.vocabulary",
  );
  assert.ok(vocabulary > migrate && vocabulary < stack);
  // Both lanes name a bundle by its content.
  assert.match(source, /codeKey\(name, bundleFingerprint\(dir\)\)/);
});

test("deploy lanes: the corpus's build time follows its sources, not the clock", async () => {
  const saved = process.env.SOURCE_DATE_EPOCH;
  try {
    process.env.SOURCE_DATE_EPOCH = "1790000000";
    assert.equal(sourceDateEpoch(), "1790000000");
    delete process.env.SOURCE_DATE_EPOCH;
    assert.match(sourceDateEpoch() ?? "0", /^\d+$/);
  } finally {
    if (saved === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = saved;
  }
  // Every source named is a directory that exists: a renamed one would
  // quietly stop moving the date.
  for (const dir of CORPUS_SOURCES)
    assert.ok(statSync(path.join(repoRoot, dir)).isDirectory(), dir);
  const docs = await readFile(
    new URL("../../../packages/docs/build.mjs", import.meta.url),
    "utf8",
  );
  assert.match(docs, /built_at: builtAt\.toISOString\(\)/);
  const site = await readFile(
    new URL("../../../apps/site/src/_data/build.js", import.meta.url),
    "utf8",
  );
  assert.match(site, /process\.env\.SOURCE_DATE_EPOCH/);
});

// The CI gate (the PR workflow, 2026-09-26): a fake git and GitHub.
const HEAD = "a".repeat(40);
const PR_HEAD = "b".repeat(40);
const TREE = "t".repeat(40);
function gateWorld({
  main = HEAD,
  runs = {},
  pulls = [],
  trees = {},
  pullsThrow = false,
} = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "fetch") return "";
    if (args[1] === "HEAD") return HEAD;
    if (args[1] === "origin/main") return main;
    if (args[1] === "HEAD^{tree}") return TREE;
    throw new Error(`unexpected git ${args}`);
  };
  const ghApi = async (path) => {
    const check = path.match(/commits\/(\w+)\/check-runs/);
    if (check) {
      const seq = runs[check[1]];
      const run = Array.isArray(seq) ? seq.shift() : seq;
      return { check_runs: run ? [run] : [] };
    }
    if (/commits\/\w+\/pulls$/.test(path)) {
      if (pullsThrow) throw new Error("HTTP 502");
      return pulls;
    }
    const commit = path.match(/git\/commits\/(\w+)$/);
    if (commit) return { tree: { sha: trees[commit[1]] } };
    throw new Error(`unexpected gh ${path}`);
  };
  return { git, ghApi, calls };
}
const run = (ciGateWorld, opts = {}) =>
  ciGate({
    ...ciGateWorld,
    repo: "o/r",
    sleep: async () => {},
    pollMs: 1,
    ...opts,
  });
const green = { status: "completed", conclusion: "success" };
const red = { status: "completed", conclusion: "failure" };
const going = { status: "in_progress", conclusion: null };

test("ci gate: HEAD must be origin/main, fetched first", async () => {
  const w = gateWorld({ main: PR_HEAD, runs: { [HEAD]: green } });
  const r = await run(w);
  assert.equal(r.ok, false);
  assert.match(r.reason, /is not origin\/main/);
  assert.equal(w.calls[0], "fetch --quiet origin main");
});

test("ci gate: green on HEAD passes; red with nothing running refuses", async () => {
  assert.deepEqual(await run(gateWorld({ runs: { [HEAD]: green } })), {
    ok: true,
    sha: HEAD,
    via: "main",
  });
  const r = await run(gateWorld({ runs: { [HEAD]: red } }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /check failed/);
});

test("ci gate: the merged PR's green head stands for HEAD only when the trees match", async () => {
  const pulls = [{ merged_at: "2026-09-26T20:00:00Z", head: { sha: PR_HEAD } }];
  const same = await run(
    gateWorld({
      pulls,
      trees: { [PR_HEAD]: TREE },
      runs: { [HEAD]: going, [PR_HEAD]: green },
    }),
  );
  assert.equal(same.ok, true);
  assert.match(same.via, /^PR head bbbbbbbb/);
  // A different tree (the branch was behind main) proves nothing about HEAD.
  const other = await run(
    gateWorld({
      pulls,
      trees: { [PR_HEAD]: "x".repeat(40) },
      runs: { [HEAD]: red, [PR_HEAD]: green },
    }),
  );
  assert.equal(other.ok, false);
  // An open PR is not a merge.
  const open = await run(
    gateWorld({
      pulls: [{ merged_at: null, head: { sha: PR_HEAD } }],
      trees: { [PR_HEAD]: TREE },
      runs: { [HEAD]: red, [PR_HEAD]: green },
    }),
  );
  assert.equal(open.ok, false);
  // The association lookup failing falls back to HEAD's own run.
  const fallback = await run(
    gateWorld({ pullsThrow: true, runs: { [HEAD]: green } }),
  );
  assert.equal(fallback.ok, true);
});

test("ci gate: a run not yet created or still going is waited for, up to the deadline", async () => {
  const w = gateWorld({ runs: { [HEAD]: [undefined, going, green] } });
  const lines = [];
  const r = await run(w, { log: (l) => lines.push(l) });
  assert.equal(r.ok, true);
  assert.equal(lines.length, 1, "announced once");
  let t = 0;
  const late = await run(gateWorld({ runs: { [HEAD]: going } }), {
    waitMs: 10,
    now: () => (t += 6),
  });
  assert.equal(late.ok, false);
  assert.match(late.reason, /did not finish/);
});

test("the failures the doors handle themselves are alarmed, to the ops queue (#71)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const filter = resource(
    template,
    "McpHandledFailureFilter",
    "WebApiHandledFailureFilter",
  );
  assert.match(filter, /LogGroupName: !Ref McpLogGroup/);
  assert.match(filter, /"tool_failed_unexpectedly"/);
  assert.match(filter, /"db_connect_failed"/);
  assert.doesNotMatch(filter, /^ *DefaultValue:/m);
  const expected = [
    // [logical id, next logical id, metric, threshold]
    ["HandledFailureAlarm", "WebApiLatencyAlarm", "HandledFailure", "3"],
    ["WebApiLatencyAlarm", "CollectorLatencyAlarm", "Duration", "15000"],
    ["CollectorLatencyAlarm", "DbEbsByteBalanceAlarm", "Duration", "5000"],
    ["DbEbsByteBalanceAlarm", "DbFreeableMemoryAlarm", "EBSByteBalance%", "25"],
    [
      "DbFreeableMemoryAlarm",
      "SiteCertificateExpiryAlarm",
      "FreeableMemory",
      "67108864",
    ],
    ["SiteCertificateExpiryAlarm", "Outputs", "DaysToExpiry", "30"],
  ];
  for (const [logicalId, next, metric, threshold] of expected) {
    const block =
      next === "Outputs"
        ? template.slice(
            template.indexOf(`  ${logicalId}:`),
            template.indexOf("\nOutputs:"),
          )
        : resource(template, logicalId, next);
    assert.match(block, /Type: AWS::CloudWatch::Alarm/, logicalId);
    assert.ok(block.includes(`MetricName: ${metric}\n`), logicalId);
    assert.match(block, new RegExp(`^      Threshold: ${threshold}$`, "m"));
    assert.match(block, /AlarmActions: \[!Ref AlarmTopic\]/, logicalId);
  }
});

test("the database connections verify the server against the bundled RDS roots (#71)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const urls = template.match(/^          DATABASE_URL: .+$/gm) ?? [];
  assert.equal(urls.length, 6);
  for (const url of urls) assert.match(url, /\?sslmode=verify-full"$/, url);
  assert.doesNotMatch(template, /sslmode=no-verify/);
  // Every function with a DATABASE_URL loads the bundle its package
  // carries, and only those packages carry it.
  const loads = template.match(/^          NODE_EXTRA_CA_CERTS: .+$/gm) ?? [];
  assert.equal(loads.length, 6);
  for (const line of loads)
    assert.ok(line.endsWith(`/var/task/${RDS_CA_PATH}`), line);
  assert.deepEqual(
    LAMBDAS.filter((l) => l.db).map((l) => l.name),
    ["web-api", "mcp", "scheduler", "migrate", "jobs", "collector"],
  );
  const bundle = await readFile(
    new URL(`../../../${RDS_CA_BUNDLE}`, import.meta.url),
    "utf8",
  );
  assert.equal((bundle.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length, 3);
});

test("secrets rotate without a sign-out: previous values and the epoch are wired (#71)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const block = (id, next) => resource(template, id, next);
  const webApi = block("WebApiFunction", "CollectorLogGroup");
  const collector = block("CollectorFunction", "McpLogGroup");
  const mcp = block("McpFunction", "SchedulerLogGroup");
  const jobs = block("JobsFunction", "EmailClanReportRule");
  for (const door of [webApi, mcp]) {
    assert.match(
      door,
      /SESSION_SECRET_PREVIOUS: !If\n\s+- HasSessionSecretPrevious\n.+session_secret_previous\}\}"\n\s+- !Ref AWS::NoValue/,
    );
    assert.match(
      door,
      /ORIGIN_SECRET_PREVIOUS: !If\n\s+- HasOriginSecretPrevious\n\s+- !Ref OriginSecretPrevious\n/,
    );
  }
  for (const signer of [webApi, jobs])
    assert.match(
      signer,
      /UNSUBSCRIBE_SECRET: !If\n\s+- HasUnsubscribeKey\n.+unsubscribe_secret\}\}"/,
    );
  assert.doesNotMatch(jobs, /SESSION_SECRET_PREVIOUS/, "jobs only signs");
  // The collector door checks the origin as every door, and holds no
  // session or unsubscribe secret: it authenticates collector tokens.
  assert.match(
    collector,
    /ORIGIN_SECRET_PREVIOUS: !If\n\s+- HasOriginSecretPrevious\n\s+- !Ref OriginSecretPrevious\n/,
  );
  assert.doesNotMatch(collector, /SESSION_SECRET|UNSUBSCRIBE_SECRET/);
  // Every function holding a secret reference re-reads it when the epoch
  // moves: the six database functions, the relay and the editor.
  assert.equal(
    (template.match(/^          SECRET_EPOCH: !Ref SecretEpoch$/gm) ?? [])
      .length,
    7,
  );
  assert.match(
    template.slice(
      template.indexOf("  SiteDistribution:"),
      template.indexOf(
        "    Properties:",
        template.indexOf("  SiteDistribution:"),
      ),
    ),
    /DependsOn: \[WebApiFunction, McpFunction, CollectorFunction\]/,
  );
  for (const key of [
    "OriginSecretPrevious",
    "SessionSecretPreviousInSecret",
    "UnsubscribeKeyInSecret",
    "SecretEpoch",
  ]) {
    assert.ok(PRESERVED_PARAMETERS.includes(key), key);
    assert.match(template, new RegExp(`^  ${key}:$`, "m"), key);
  }
});

test("a preserved parameter's first deploy takes its default; a rotation carries the old origin secret (#71)", () => {
  const required = Object.fromEntries(
    [
      "CodeBucket",
      "WebApiCodeKey",
      "McpCodeKey",
      "SchedulerCodeKey",
      "EmailRelayCodeKey",
      "MigrateCodeKey",
      "JobsCodeKey",
      "EditorCodeKey",
      "CollectorCodeKey",
    ].map((k) => [k, "x"]),
  );
  const existing = [...Object.keys(required), ...PRESERVED_PARAMETERS].filter(
    (k) => k !== "SecretEpoch",
  );
  const params = buildParameters(required, null, {}, existing);
  assert.equal(
    params.find((p) => p.ParameterKey === "SecretEpoch"),
    undefined,
    "never stored: omitted, so CloudFormation does not refuse UsePreviousValue",
  );
  assert.deepEqual(
    params.find((p) => p.ParameterKey === "OriginSecretPrevious"),
    { ParameterKey: "OriginSecretPrevious", UsePreviousValue: true },
  );
  const rotated = originRotation("old-origin");
  assert.equal(rotated.OriginSecretPrevious, "old-origin");
  assert.match(rotated.OriginSecret, /^[0-9a-f]{64}$/);
  assert.throws(() => originRotation(""), /no origin secret/);
  const withRotation = buildParameters(required, null, rotated, existing);
  assert.deepEqual(
    withRotation.find((p) => p.ParameterKey === "OriginSecret"),
    { ParameterKey: "OriginSecret", ParameterValue: rotated.OriginSecret },
  );
  assert.equal(
    parseDeployArgs(["--rotate-origin-secret"]).rotateOriginSecret,
    true,
  );
  assert.deepEqual(parseDeployArgs(["--param=OriginSecretPrevious="]).params, {
    OriginSecretPrevious: "",
  });
});

/** The distribution's ordered cache behaviours, as [path, block] pairs. */
function cacheBehaviours(template) {
  const start = template.indexOf("        CacheBehaviors:");
  const end = template.indexOf("\n  SpaRouter:", start);
  return template
    .slice(start, end)
    .split("\n          - PathPattern: ")
    .slice(1)
    .map((block) => [block.slice(0, block.indexOf("\n")).trim(), block]);
}

const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";

test("every public read is cached at the edge by one /api/public/* behaviour (#73)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const behaviours = cacheBehaviours(template);
  const paths = behaviours.map(([p]) => p);
  // CloudFront takes the FIRST pattern that matches, so the public
  // behaviour must come before the CachingDisabled /api/v1/* and /api/*.
  assert.equal(paths[0], "/api/public/*");
  assert.ok(paths.indexOf("/api/public/*") < paths.indexOf("/api/v1/*"));
  assert.ok(paths.indexOf("/api/v1/*") < paths.indexOf("/api/*"));
  // It replaces the two specific behaviours (#23): nothing else under it.
  assert.deepEqual(
    paths.filter((p) => p.startsWith("/api/public")),
    ["/api/public/*"],
  );
  const [, block] = behaviours[0];
  assert.match(block, /TargetOriginId: api\n/);
  assert.match(block, /AllowedMethods: \[GET, HEAD\]\n/);
  assert.ok(block.includes(`CachePolicyId: ${CACHING_OPTIMIZED}\n`));
  // No origin request policy: no cookie, header or query string reaches
  // the origin, so one cached object serves every caller.
  assert.doesNotMatch(block, /OriginRequestPolicyId/);
});

test("Clan always uses the shared account door and never falls back to the retired runtime", async () => {
  const template = await readFile(templateUrl, "utf8");
  const behaviours = cacheBehaviours(template);
  const paths = behaviours.map(([p]) => p);
  assert.ok(paths.includes("/api/clan/*"));
  assert.ok(paths.indexOf("/api/clan/*") < paths.indexOf("/api/*"));
  const [, block] = behaviours.find(([p]) => p === "/api/clan/*");
  assert.match(block, /TargetOriginId: api\n/);
  assert.match(block, /OriginRequestPolicyId: !Ref SiteApiOriginRequestPolicy/);
  assert.doesNotMatch(
    template,
    /ClanApiOriginRequestPolicy|ClanApiDomain|Id: clanapi|Id: clanweb/,
  );
  assert.match(
    resource(template, "ClanInternal", "ClanModelSecretName"),
    /Default: "true"/,
  );
  const shared = resource(
    template,
    "SiteApiOriginRequestPolicy",
    "OauthAuthorizeOriginRequestPolicy",
  );
  assert.match(shared, /CookiesConfig: \{ CookieBehavior: all \}/);
  assert.match(shared, /x-elixir-client/);
  const external = resource(
    template,
    "McpOriginRequestPolicy",
    "SecurityHeadersPolicy",
  );
  assert.match(external, /CookieBehavior: none/);
  // The app takes two patterns, never /clan*, which would take /clans.
  assert.deepEqual(
    paths.filter((p) => p.startsWith("/clan")),
    ["/clan", "/clan/*"],
  );
});

test("the private model sealing secret is limited to the shared web API and egress relay", async () => {
  const template = await readFile(templateUrl, "utf8");
  const functions = [...template.matchAll(/^  (\w+Function):\n/gm)];
  const consumers = functions
    .filter((entry, index) => {
      const block = template.slice(entry.index, functions[index + 1]?.index);
      return /CLAN_MODEL_SECRET:/.test(block);
    })
    .map((entry) => entry[1]);
  assert.deepEqual(consumers, ["WebApiFunction", "EmailRelayFunction"]);
  assert.equal((template.match(/CLAN_MODEL_SECRET:/g) ?? []).length, 2);
  assert.equal(
    (
      template.match(
        /\$\{ClanModelSecretName\}:SecretString:session_secret/g,
      ) ?? []
    ).length,
    2,
  );
});

test("every /api/public route is a GET that states its own freshness (#73)", async () => {
  // Cached under CachingOptimized, a response without Cache-Control
  // would live a DAY at the edge (the policy's default TTL), and a
  // write under /api/public would be refused by the GET/HEAD behaviour.
  const source = await readFile(
    new URL("../../web-api/src/routes/public.mjs", import.meta.url),
    "utf8",
  );
  const routes = [
    ...source.matchAll(/^ {4}"([A-Z]+) (\/api\/public[^"]*)":/gm),
  ];
  assert.ok(routes.length >= 5, "the public routes are found");
  for (let i = 0; i < routes.length; i += 1) {
    const [, method, route] = routes[i];
    assert.equal(method, "GET", route);
    const handler = source.slice(routes[i].index, routes[i + 1]?.index);
    assert.match(
      handler,
      /"cache-control": "public, max-age=\d+"/,
      `${route} states its max-age`,
    );
  }
});

// Publishing the site (#73). One `s3 sync
// --delete` with no Cache-Control removed the old build's lazy chunks
// while an open console, or an edge still holding the old app.html,
// could ask for them: a blank page mid-session.
const VITE_OUT = [
  "AccountPage-C3FTy2qB.js",
  "index-BTm8TzAt.js",
  "index-DQxSyd3a.css",
  "tag-url-DSiL-xl4.js",
];

test("publish: only Vite's content-hashed chunks are immutable (#73)", () => {
  const hashed = hashedAssets(
    [
      ...VITE_OUT.map((f) => `assets/${f}`),
      // The site's own assets keep one name and are busted by ?v=, which
      // the edge's cache key ignores: they must revalidate.
      "assets/site.css",
      "assets/chrome-menu.js",
      "assets/rail-anchors.js",
      "assets/updates-filter.js",
      "assets/fonts/Clash_Regular.otf",
      "assets/cards/26000000_evo-128.png",
      "index.html",
    ],
    [...VITE_OUT, "fonts"],
  );
  assert.deepEqual(
    [...hashed].sort(),
    VITE_OUT.map((f) => `assets/${f}`).sort(),
  );
  // A name that merely looks hashed but did not come from Vite is not.
  assert.deepEqual([...hashedAssets(["assets/some-abcdefgh.js"], [])], []);
});

test("publish: assets first without --delete, then documents, each with Cache-Control (#73)", () => {
  const steps = publishSteps({
    dir: "/tmp/site",
    bucket: "b",
    hashed: new Set(["assets/index-BTm8TzAt.js", "assets/index-DQxSyd3a.css"]),
  });
  const joined = steps.map((s) => s.join(" "));
  // 1. the hashed chunks, immutable, never deleting
  assert.deepEqual(steps[0].slice(0, 4), [
    "s3",
    "sync",
    "/tmp/site/assets",
    "s3://b/assets",
  ]);
  assert.ok(joined[0].includes("--include index-BTm8TzAt.js"));
  assert.ok(steps[0].includes(IMMUTABLE));
  // 2. every other asset, revalidated, never deleting
  assert.ok(joined[1].includes("--exclude index-BTm8TzAt.js"));
  assert.ok(steps[1].includes(REVALIDATE));
  for (const step of steps.slice(0, 2)) {
    assert.ok(!step.includes("--delete"), step.join(" "));
  }
  // 3. the documents: revalidated, deleting, and never touching assets/
  assert.deepEqual(steps[2].slice(0, 4), ["s3", "sync", "/tmp/site", "s3://b"]);
  assert.ok(steps[2].includes("--delete"));
  assert.ok(joined[2].includes("--exclude assets/*"));
  assert.ok(steps[2].includes(REVALIDATE));
  // 4. the .txt charset rewrite keeps the Cache-Control it replaces
  assert.ok(joined[3].includes("--content-type text/plain; charset=utf-8"));
  assert.ok(steps[3].includes("--metadata-directive"));
  assert.ok(steps[3].includes(REVALIDATE));
  assert.ok(joined[3].includes("--exclude assets/*"));
  assert.equal(steps.length, 4);
  // Every sync and copy states a Cache-Control.
  for (const step of steps) assert.ok(step.includes("--cache-control"));
});

test("publish: prune only assets the build no longer ships, after they have been gone long enough (#73)", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const day = 86_400_000;
  const objects = [
    // shipped by this build: kept however old
    { Key: "assets/index-NEW00000.js", LastModified: new Date(now - 90 * day) },
    // last shipped 20 days ago: an open tab from then is long gone
    { Key: "assets/index-OLD00000.js", LastModified: new Date(now - 20 * day) },
    // last shipped yesterday: an open console may still ask for it
    { Key: "assets/index-RECENT00.js", LastModified: new Date(now - day) },
    // never under assets/: not the prune's business
    { Key: "index.html", LastModified: new Date(now - 90 * day) },
  ];
  const current = new Set(["assets/index-NEW00000.js"]);
  assert.deepEqual(pruneCandidates({ objects, current, now, days: 14 }), [
    "assets/index-OLD00000.js",
  ]);
  // An empty build prunes nothing: it is a broken build, not a new one.
  assert.deepEqual(
    pruneCandidates({ objects, current: new Set(), now, days: 14 }),
    [],
  );
});

test("CI builds the site once (#73)", async () => {
  // The site workspace's test builds the merged tree inside `npm run
  // verify`; validate.yml and the Playwright webServer reuse it.
  const workflow = await readFile(
    new URL("../../../.github/workflows/validate.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(workflow, /^\s*- run: .*build-site\.mjs/m);
  const playwright = await readFile(
    new URL("../../../apps/web/playwright.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(playwright, /process\.env\.CI\s*\?\s*serve/);
  const site = JSON.parse(
    await readFile(
      new URL("../../../apps/site/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.match(site.scripts.test, /build-site\.mjs/);
});
