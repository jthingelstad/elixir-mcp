import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
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
  REQUIRED_PARAMETERS,
  webBuildParameters,
} from "../../../infra/scripts/parameters.mjs";

const templateUrl = new URL("../../../infra/template.yaml", import.meta.url);

test("the model relay can distinguish unwritten replies without reading other outbox bodies", async () => {
  const template = await readFile(templateUrl, "utf8");
  const role = resource(template, "EmailRelayRole", "EmailRelayFunction");
  assert.match(
    role,
    /Action: s3:ListBucket\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\n\s+Condition:\n\s+StringLike:\n\s+s3:prefix:\n\s+- clan-model\/reply\/\*\n\s+- clan-model\/claim\/\*\n\s+- clan-discord\/reply\/\*\n\s+- clan-discord\/claim\/\*\n\s+- timeline-discord-state\/\*\n\s+NumericLessThanEquals:\n\s+s3:max-keys: "1"/,
  );
  // The other list: Turnstile's kept verdicts, one exact key at a time.
  assert.match(
    role,
    /Action: s3:ListBucket\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\n\s+Condition:\n\s+StringLike:\n\s+s3:prefix: mail-delivery\/turnstile\/\*\n\s+NumericLessThanEquals:\n\s+s3:max-keys: "1"/,
  );
  assert.equal((role.match(/Action: s3:ListBucket/g) ?? []).length, 2);
  assert.match(
    role,
    /Action: s3:GetObject\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\/clan-model\/\*/,
  );
  assert.match(
    role,
    /Action: s3:GetObject\n\s+Resource: !Sub arn:aws:s3:::elixir-mcp-outbox-\$\{AWS::AccountId\}\/clan-discord\/\*/,
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
  for (const [queue, next] of [
    ["ClanModelQueue", "EmailDlq"],
    ["TimelineSyncQueue", "TimelineHoldQueue"],
    ["TimelineHoldQueue", "TimelineSyncDlq"],
    ["TimelineDiscordQueue", "TimelineDiscordDlq"],
  ])
    assert.match(
      resource(template, queue, next),
      /^      VisibilityTimeout: 360$/m,
      queue,
    );
  assert.doesNotMatch(template, /^  Editor(?:Function|Queue|EventSource):/m);
  // A clan's held stories (2026-10-11): five minutes on their own queue,
  // into the sync's dead letters, read by the same function.
  const hold = resource(template, "TimelineHoldQueue", "TimelineSyncDlq");
  assert.match(hold, /^      DelaySeconds: 300$/m);
  assert.match(hold, /deadLetterTargetArn: !GetAtt TimelineSyncDlq\.Arn/);
  assert.match(
    resource(template, "TimelineHoldEventSource", "TimelineEditorEventSource"),
    /FunctionName: !Ref TimelineSyncFunction\n\s+EventSourceArn: !GetAtt TimelineHoldQueue\.Arn/,
  );
  // A clan whose own model edits (2026-10-11): its own queue, one clan
  // an invocation, into the sync's dead letters; the function has room
  // for three rounds of 50 s and the queue hides a message longer.
  const editor = resource(template, "TimelineEditorQueue", "TimelineSyncDlq");
  assert.match(editor, /^      VisibilityTimeout: 360$/m);
  assert.doesNotMatch(editor, /DelaySeconds/);
  assert.match(editor, /deadLetterTargetArn: !GetAtt TimelineSyncDlq\.Arn/);
  const mapping = resource(
    template,
    "TimelineEditorEventSource",
    "MigrateLogGroup",
  );
  assert.match(
    mapping,
    /FunctionName: !Ref TimelineSyncFunction\n\s+EventSourceArn: !GetAtt TimelineEditorQueue\.Arn\n\s+BatchSize: 1$/m,
  );
  const fn = resource(
    template,
    "TimelineSyncFunction",
    "TimelineSyncEventSource",
  );
  const timeout = Number(/^ +(?:Timeout|TimeoutSeconds): (\d+)$/m.exec(fn)[1]);
  assert.ok(timeout >= 3 * 50 + 25 && timeout < 360, `timeout ${timeout}`);
  assert.match(
    template,
    /Queue: !GetAtt TimelineEditorQueue\.Arn\n\s+Filter:\n\s+S3Key: \{ Rules: \[\{ Name: prefix, Value: timeline-editor\/ \}\] \}/,
  );
});

test("the clan's model requests have a queue of their own, one request a relay run, inside the relay's timeout", async () => {
  // 2026-10-11: a leader's draft may wait 50 s for the provider
  // (`DEFERRED_RELAY_MS`); batched with mail it could outlast the run.
  const template = await readFile(templateUrl, "utf8");
  const mapping = resource(
    template,
    "ClanModelEventSource",
    "TimelineDiscordEventSource",
  );
  assert.match(mapping, /EventSourceArn: !GetAtt ClanModelQueue\.Arn/);
  assert.match(mapping, /^      BatchSize: 1$/m);
  assert.match(
    template,
    /Queue: !GetAtt ClanModelQueue\.Arn\n\s+Filter:\n\s+S3Key: \{ Rules: \[\{ Name: prefix, Value: clan-model\/request\/ \}\] \}/,
  );
  assert.doesNotMatch(
    template,
    /Queue: !GetAtt EmailQueue\.Arn\n\s+Filter:\n\s+S3Key: \{ Rules: \[\{ Name: prefix, Value: clan-model\//,
  );
  const relay = resource(template, "EmailRelayFunction", "EmailEventSource");
  const timeout = Number(
    /^ +(?:Timeout|TimeoutSeconds): (\d+)$/m.exec(relay)[1],
  );
  const bridge = await readFile(
    new URL("../../../packages/clan/src/model-bridge.mjs", import.meta.url),
    "utf8",
  );
  const deferred = Number(
    /export const DEFERRED_RELAY_MS = ([\d_]+);/
      .exec(bridge)[1]
      .replaceAll("_", ""),
  );
  assert.ok(
    deferred + 5000 <= timeout * 1000,
    `${deferred} ms in ${timeout} s`,
  );
});

test("database-facing Lambda concurrency remains bounded", async () => {
  const template = await readFile(templateUrl, "utf8");
  const expected = [
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
    ["WebApiWebRevision", "CollectorLogGroup", "elixir-mcp-web-api"],
    ["CollectorWebRevision", "McpLogGroup", "elixir-mcp-collector"],
    ["McpWebRevision", "SchedulerLogGroup", "elixir-mcp-mcp"],
    ["SchedulerFunction", "SchedulerRule", "elixir-mcp-scheduler"],
    ["MigrateFunction", "JobsLogGroup", "elixir-mcp-migrate"],
    ["JobsFunction", "EmailClanReportRule", "elixir-mcp-jobs"],
    [
      "TimelineSyncFunction",
      "TimelineSyncEventSource",
      "elixir-mcp-timeline-sync",
    ],
  ];
  for (const [logicalId, nextLogicalId, name] of functions) {
    const block = resource(template, logicalId, nextLogicalId);
    assert.match(block, /DATABASE_URL:/, logicalId);
    assert.match(
      block,
      new RegExp(`^          PGAPPNAME: ${name}$`, "m"),
      logicalId,
    );
    const timeoutMatch = /^ +(?:Timeout|TimeoutSeconds): (\d+)$/m.exec(block);
    const timeouts = timeoutMatch ? [Number(timeoutMatch[1])] : [20, 30];
    if (!timeoutMatch) {
      assert.equal(logicalId, "WebApiWebRevision");
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
  assert.equal((template.match(/^          DATABASE_URL:/gm) ?? []).length, 7);
});

test("the collector door is its own function, role and route on the site API (2026-09-29)", async () => {
  const template = await readFile(templateUrl, "utf8");
  // The role puts payloads, mail and the timeline sync's wakes and
  // nothing else: a write-once put needs no read, and the door lists
  // nothing.
  const role = resource(template, "CollectorRole", "McpRole");
  assert.match(role, /RoleName: elixir-mcp-collector\n/);
  assert.deepEqual(
    [...role.matchAll(/^ {16}Action: (.+)$/gm)].map((m) => m[1]),
    ["s3:PutObject", "s3:PutObject", "s3:PutObject"],
  );
  assert.match(
    role,
    /elixir-mcp-outbox-\$\{AWS::AccountId\}\/timeline-sync\/\*\n/,
  );
  assert.match(
    role,
    /- \$\{Arn\}\/payloads\/\*\n\s+- Arn: !GetAtt ArchiveBucket\.Arn/,
  );
  assert.match(role, /elixir-mcp-outbox-\$\{AWS::AccountId\}\/email\/\*\n/);
  assert.match(
    resource(template, "CollectorWebRevision", "McpLogGroup"),
    /ExecutionRoleArn: !GetAtt CollectorRole\.Arn/,
  );
  const behaviours = cacheBehaviours(template);
  const collector = behaviours.find(
    ([path]) => path === "/api/collector/*",
  )?.[1];
  assert.match(collector, /TargetOriginId: collector/);
  assert.ok(
    behaviours.findIndex(([p]) => p === "/api/collector/*") <
      behaviours.findIndex(([p]) => p === "/api/*"),
  );
  const endpoint = resource(
    template,
    "CollectorWebEndpoint",
    "CollectorLocalLogGroup",
  );
  assert.match(endpoint, /AuthType: IamAuth/);
  assert.match(endpoint, /EndpointType: HomeRegion/);
  assert.match(endpoint, /RevisionId: !GetAtt CollectorWebRevision.RevisionId/);
  // Its ingest failures and its crashes page as the web-api's did.
  const filter = resource(
    template,
    "CollectorSubmitIngestErrorFilter",
    "SubmitIngestErrorAlarm",
  );
  assert.match(filter, /LogGroupName: !Ref CollectorLogGroup/);
  assert.match(filter, /MetricName: SubmitIngestError\n/);
  const errors = resource(template, "CollectorErrorsAlarm", "McpLatencyAlarm");
  assert.match(errors, /Value: elixir-mcp-collector-web/);
  assert.match(errors, /AlarmActions: \[!Ref AlarmTopic\]/);
  // The writer sends If-None-Match before the policy demands it.
  assert.match(
    resource(template, "ArchiveBucketPolicy", "GlueArchiveDatabase"),
    /DependsOn: CollectorWebFunction\n/,
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
    ["WebApiLatencyAlarm", "CollectorLatencyAlarm", "WebApiDuration", "15000"],
    ["CollectorLatencyAlarm", "DoorThrottleAlarm", "CollectorDuration", "5000"],
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

/** Every alarm resource in the template, by logical id. */
function alarms(template) {
  const found = new Map();
  const heads = [
    ...template.matchAll(/^  (\w+):\n    Type: AWS::CloudWatch::Alarm\n/gm),
  ];
  for (const head of heads) {
    const rest = template.slice(head.index + head[0].length);
    const end = rest.search(/^(  \w+:$|\S)/m);
    found.set(head[1], head[0] + (end === -1 ? rest : rest.slice(0, end)));
  }
  return found;
}

test("an incident pages once: the alarms hold ALARM through it, and every one pages the ops queue (2026-10-21)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const all = alarms(template);
  assert.equal(all.size, 28);
  for (const [id, block] of all) {
    // Alarms reach the sysadmin queue through the topic, never email,
    // and say what missing data means.
    assert.match(block, /^      AlarmActions: \[!Ref AlarmTopic\]$/m, id);
    assert.doesNotMatch(block, /OKActions|InsufficientDataActions/, id);
    assert.match(
      block,
      /^      TreatMissingData: (notBreaching|breaching)$/m,
      id,
    );
    // CloudWatch's limits: M of N with M <= N, and N periods at most a
    // day under an hour's period, a week at an hour or more.
    const n = Number(block.match(/^      EvaluationPeriods: (\d+)$/m)?.[1]);
    const m = Number(
      block.match(/^      DatapointsToAlarm: (\d+)$/m)?.[1] ?? String(n),
    );
    const period = Number(block.match(/^ +Period: (\d+)$/m)?.[1] ?? Number.NaN);
    assert.ok(n >= 1 && m >= 1 && m <= n, id);
    assert.ok(n * period <= (period < 3600 ? 86_400 : 604_800), id);
  }
  // A broken tool failing every five minutes swung a ten-minute sum
  // around 3 and paged 42 times: an hour's sum, 1 of 2.
  const door = all.get("HandledFailureAlarm");
  assert.match(door, /^      Period: 3600$/m);
  assert.match(door, /^      EvaluationPeriods: 2$/m);
  assert.match(door, /^      DatapointsToAlarm: 1$/m);
  assert.match(door, /^      Threshold: 3$/m);
  assert.match(door, /^      TreatMissingData: notBreaching$/m);
  // A daily log read is the season check's evidence: 1 of 30 hours.
  const season = all.get("SeasonMismatchAlarm");
  assert.match(season, /^      Period: 3600$/m);
  assert.match(season, /^      EvaluationPeriods: 30$/m);
  assert.match(season, /^      DatapointsToAlarm: 1$/m);
  assert.match(season, /^      Threshold: 1$/m);
  assert.match(season, /^      TreatMissingData: notBreaching$/m);
  // Throttles: the standard endpoint counts of the three doors, summed,
  // 3 of 6 five-minute periods; no metric of Elixir's own.
  const throttles = all.get("DoorThrottleAlarm");
  assert.match(throttles, /AlarmName: elixir-mcp-door-throttles\n/);
  assert.match(throttles, /Expression: SUM\(METRICS\(\)\)\n/);
  assert.equal(throttles.match(/ReturnData: true/g)?.length, 1);
  for (const fn of [
    "elixir-mcp-mcp-web",
    "elixir-mcp-web-api-web",
    "elixir-mcp-collector-web",
  ]) {
    for (const metric of [
      "EndpointActiveEnvironmentThrottles",
      "EndpointRequestThrottles",
    ]) {
      assert.ok(
        new RegExp(
          `MetricName: ${metric}\\n +Dimensions:\\n +- \\{ Name: FunctionName, Value: ${fn} \\}\\n +- \\{ Name: EndpointName, Value: live \\}\\n +- \\{ Name: ExecutionRegion, Value: !Ref AWS::Region \\}\\n +Period: 300\\n +Stat: Sum\\n`,
        ).test(throttles),
        `${fn} ${metric}`,
      );
    }
  }
  assert.equal(
    throttles.match(/Namespace: AWS\/Lambda\/Web\/Usage/g)?.length,
    6,
  );
  assert.doesNotMatch(throttles, /Account\w*Throttles/);
  assert.match(throttles, /^      EvaluationPeriods: 6$/m);
  assert.match(throttles, /^      DatapointsToAlarm: 3$/m);
  assert.match(throttles, /^      Threshold: 1$/m);
  assert.match(throttles, /^      TreatMissingData: notBreaching$/m);
  // The dashboard shows the new alarm and stays inside the free tier's
  // 50 metrics.
  const dashboard = template.slice(
    template.indexOf("  OpsDashboard:"),
    template.indexOf("\nOutputs:"),
  );
  assert.match(dashboard, /"\$\{DoorThrottleAlarm\.Arn\}"/);
  const metrics = dashboard.match(/\["(AWS|ElixirMCP)\//g) ?? [];
  assert.ok(metrics.length <= 50, `${metrics.length} dashboard metrics`);
});

test("checkpoints every fifteen minutes, on the parameter group the database already has (2026-10-21)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const group = resource(template, "DbParameterGroup", "DbPostgresLogGroup");
  assert.match(group, /^        checkpoint_timeout: 900$/m);
  // Description and Family replace the group, and a new group reaches
  // the instance only at a reboot: neither moves with a parameter.
  assert.match(
    group,
    /^      Description: elixir-mcp postgres17 - slow statements and lock waits to the log$/m,
  );
  assert.match(group, /^      Family: postgres17$/m);
  assert.doesNotMatch(group, /DBParameterGroupName:/);
});

test("the database connections verify the server against the bundled RDS roots (#71)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const urls = template.match(/^          DATABASE_URL: .+$/gm) ?? [];
  assert.equal(urls.length, 7);
  for (const url of urls) assert.match(url, /\?sslmode=verify-full"$/, url);
  assert.doesNotMatch(template, /sslmode=no-verify/);
  // Every function with a DATABASE_URL loads the bundle its package
  // carries, and only those packages carry it.
  const loads = template.match(/^          NODE_EXTRA_CA_CERTS: .+$/gm) ?? [];
  assert.equal(loads.length, 7);
  for (const line of loads)
    assert.ok(line.endsWith(`/var/task/${RDS_CA_PATH}`), line);
  assert.deepEqual(
    LAMBDAS.filter((l) => l.db).map((l) => l.name),
    [
      "web-api",
      "mcp",
      "scheduler",
      "migrate",
      "jobs",
      "collector",
      "timeline-sync",
    ],
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
  const webApi = block("WebApiWebRevision", "CollectorLogGroup");
  const collector = block("CollectorWebRevision", "McpLogGroup");
  const mcp = block("McpWebRevision", "SchedulerLogGroup");
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
  // moves: the seven database functions and the relay.
  assert.equal(
    (template.match(/^          SECRET_EPOCH: !Ref SecretEpoch$/gm) ?? [])
      .length,
    8,
  );
  assert.match(
    template.slice(
      template.indexOf("  SiteDistribution:"),
      template.indexOf(
        "    Properties:",
        template.indexOf("  SiteDistribution:"),
      ),
    ),
    /DependsOn: \[WebApiWebEndpoint, McpWebEndpoint, CollectorWebEndpoint\]/,
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
      "WebApiCodeVersion",
      "McpCodeVersion",
      "CollectorCodeVersion",
      "WebApiBuild",
      "McpBuild",
      "CollectorBuild",
      "WebApiCodeKey",
      "McpCodeKey",
      "SchedulerCodeKey",
      "EmailRelayCodeKey",
      "MigrateCodeKey",
      "JobsCodeKey",
      "EditorCodeKey",
      "CollectorCodeKey",
      "TimelineSyncCodeKey",
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

test("every stack parameter has exactly one deploy classification", async () => {
  const template = await readFile(templateUrl, "utf8");
  const parameters = template
    .split("\nParameters:\n")[1]
    .split("\nConditions:\n")[0];
  const names = [...parameters.matchAll(/^  ([A-Za-z0-9]+):$/gm)].map(
    (m) => m[1],
  );
  const classified = [...REQUIRED_PARAMETERS, ...PRESERVED_PARAMETERS];
  assert.equal(new Set(classified).size, classified.length);
  assert.deepEqual(names.sort(), classified.sort());
});

test("native bundle identity changes only its own revision; shared configuration remains a dependency", async () => {
  const template = await readFile(templateUrl, "utf8");
  const codeKeys = {
    "web-api": "code/web-api/one.zip",
    mcp: "code/mcp/one.zip",
    collector: "code/collector/one.zip",
  };
  const first = webBuildParameters(codeKeys);
  const doors = [
    ["WebApi", "web-api", "CollectorLogGroup"],
    ["Mcp", "mcp", "SchedulerLogGroup"],
    ["Collector", "collector", "McpLogGroup"],
  ];
  for (const [door, name] of doors) {
    assert.match(first[`${door}Build`], /^[0-9a-f]{16}$/);
    const next = webBuildParameters({
      ...codeKeys,
      [name]: `code/${name}/two.zip`,
    });
    const changed = Object.keys(first).filter(
      (key) => first[key] !== next[key],
    );
    assert.deepEqual(changed, [`${door}Build`]);
    for (const [otherDoor, , end] of doors) {
      const revision = resource(template, `${otherDoor}WebRevision`, end);
      assert.match(revision, new RegExp(`Description: !Ref ${otherDoor}Build`));
      assert.match(revision, new RegExp(`APP_BUILD: !Ref ${otherDoor}Build`));
      assert.equal(
        changed.some((key) => revision.includes(`!Ref ${key}`)),
        otherDoor === door,
        `${door} bundle must only affect ${door}`,
      );
      assert.match(revision, /SECRET_EPOCH: !Ref SecretEpoch/);
      assert.match(revision, /ORIGIN_SECRET: !Ref OriginSecret/);
      assert.match(
        revision,
        /EgressNetworkConnectorArn: !GetAtt WebNetworkConnector.LatestVersionArn/,
      );
    }
  }
  assert.doesNotMatch(template, /!Ref WebBuild/);
  assert.throws(() => webBuildParameters({}), /missing native code key/);
  const deploy = await readFile(
    new URL("../../../infra/scripts/deploy.mjs", import.meta.url),
    "utf8",
  );
  assert.match(deploy, /\.\.\.webBuildParameters\(codeKeys\)/);
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

test("the static router only resolves documents; native app behaviors bypass it", async () => {
  const { runInNewContext } = await import("node:vm");
  const template = await readFile(templateUrl, "utf8");
  const router = resource(template, "SpaRouter", "OauthQueryNormalizer");
  assert.match(router, /Name: elixir-mcp-spa-router/);
  assert.doesNotMatch(router, /app\.html|key === '\/(?:console|clan|ladder)'/);
  const source = router.split("FunctionCode: |\n")[1].split("\n  #")[0];
  const handler = runInNewContext(`${source}\nhandler`);
  for (const [uri, document] of [
    ["/", "/index.html"],
    ["/docs", "/docs/index.html"],
    ["/docs/", "/docs/index.html"],
    ["/clans", "/clans/index.html"],
    ["/assets/site.css", "/assets/site.css"],
  ]) {
    const request = { uri };
    assert.equal(handler({ request }), request);
    assert.equal(request.uri, document);
  }
  const behaviors = cacheBehaviours(template);
  for (const root of ["console", "ladder", "clan"])
    for (const pattern of [`/${root}`, `/${root}/*`]) {
      const behavior = behaviors.find(([path]) => path === pattern)?.[1];
      assert.ok(behavior, pattern);
      assert.match(behavior, /TargetOriginId: api/);
      assert.match(behavior, /CachePolicyId: !Ref WebPrivateCachePolicy/);
      assert.doesNotMatch(behavior, /GetAtt SpaRouter/);
    }
});

test("the static router answers scanner paths 404 itself; documents and files pass (#451)", async () => {
  const { runInNewContext } = await import("node:vm");
  const template = await readFile(templateUrl, "utf8");
  const router = resource(template, "SpaRouter", "OauthQueryNormalizer");
  const source = router.split("FunctionCode: |\n")[1].split("\n  #")[0];
  const handler = runInNewContext(`${source}\nhandler`);
  // Read off the web API's 404s for the week to 10-21.
  for (const uri of [
    "/.env",
    "/.env.production",
    "/public/.env",
    "/.git/config",
    "/.git/logs/HEAD",
    "/.aws/credentials",
    "/.npmrc",
    "/.claude/settings.json",
    "/.github/workflows/deploy.yml",
    "/wp-login.php",
    "/wp-content/debug.log",
    "/wp-json/gravitysmtp/v1/tests/mock-data",
    "/wordpress",
    "/wp",
    "/phpinfo",
    "/phpinfo.php",
    "/api/phpinfo.php",
    "/_profiler/phpinfo",
    "/wp-config.php.bak",
    "/config.php",
    "/config.env",
    "/config.yaml",
    "/config/aws.yml",
    "/docker-compose.yml",
    "/Dockerfile",
    "/database.sql",
    "/credentials.ini",
    "/credentials",
    "/server/settings.py",
    "/temporal.toml",
    "/vendor/composer/installed.json",
    "/env.js",
    "/__env.js",
    "/env.json",
    "/config.js",
    "/config.json",
    "/app.config.js",
    "/runtime-config.js",
    "/globalConfig.js",
    "/server-config.json",
    "/assets/config.js",
    "/appsettings.json",
    "/appsettings.Development.json",
    "/credentials.json",
    "/secrets.json",
    "/settings.json",
    "/aws-exports.js",
    "/composer.json",
    "/auth.json",
  ]) {
    const answer = handler({ request: { uri } });
    assert.equal(answer.statusCode, 404, uri);
    assert.equal(answer.uri, undefined, uri);
  }
  // Documents, files and honest misses keep going to the bucket. A built
  // chunk is name-hash.js, so a word in its name never matches; the site
  // tests walk the whole built tree.
  for (const [uri, document] of [
    ["/docs/connections", "/docs/connections/index.html"],
    ["/cards/Inferno%20Dragon", "/cards/Inferno%20Dragon/index.html"],
    ["/assets/config-B3k9xQ2a.js", "/assets/config-B3k9xQ2a.js"],
    ["/assets/Settings-Cq1ZpK0e.js", "/assets/Settings-Cq1ZpK0e.js"],
    ["/assets/env-a1b2c3d4.js", "/assets/env-a1b2c3d4.js"],
    ["/assets/not-a-real-file.js", "/assets/not-a-real-file.js"],
    ["/docs/integration-api.json", "/docs/integration-api.json"],
    ["/llms.txt", "/llms.txt"],
    ["/feed.xml", "/feed.xml"],
    ["/favicon.ico", "/favicon.ico"],
    ["/environment", "/environment/index.html"],
    ["/wpa", "/wpa/index.html"],
  ]) {
    const request = { uri };
    assert.equal(handler({ request }), request, uri);
    assert.equal(request.uri, document);
  }
});

test("every behaviour compresses; only identical-for-everyone reads are cached (2026-10-21)", async () => {
  const template = await readFile(templateUrl, "utf8");
  const behaviours = cacheBehaviours(template);
  for (const [path, block] of behaviours)
    assert.match(block, /\n\s+Compress: true\n/, `${path} compresses`);
  const cached = behaviours.filter(([, block]) =>
    block.includes(`CachePolicyId: ${CACHING_OPTIMIZED}\n`),
  );
  assert.deepEqual(
    cached.map(([path]) => path),
    ["/api/public/*", "/battle/*", "/.well-known/*"],
  );
  for (const [path, block] of cached) {
    // Nothing but the path reaches the origin, so one cached object is
    // right for every caller; and nothing but a read is allowed.
    assert.doesNotMatch(block, /OriginRequestPolicyId/, path);
    assert.match(block, /AllowedMethods: \[GET, HEAD\]\n/, path);
  }
  for (const [path, block] of behaviours)
    if (!cached.some(([p]) => p === path))
      assert.match(
        block,
        /CachePolicyId: !Ref WebPrivateCachePolicy\n/,
        `${path} is private`,
      );
  const [, metadata] = cached.find(([path]) => path === "/.well-known/*");
  assert.match(metadata, /TargetOriginId: mcpapi\n/);
});

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
    resource(template, "ClanInternal", "HasInternalClan"),
    /Default: "true"/,
  );
  // Clan's own feedback lane retired into the one system (0204).
  assert.doesNotMatch(template, /ClanMaintainerTags|CLAN_MAINTAINER_TAGS/);
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

// The jobs Lambda joined on 2026-10-10: the morning run posts a clan's
// Actions to its Discord, through a webhook sealed under this secret. It
// already holds the session secret, so no stronger key came with it.
// The timeline sync joined the same day: a clan's activity rewritten by
// the clan's own model goes through Clan's model bridge, whose request
// it seals. It holds the database password already, and logs no key.
test("the private sealing secret is limited to the web API, the morning run, the timeline sync and the egress relay", async () => {
  const template = await readFile(templateUrl, "utf8");
  const functions = [
    ...template.matchAll(/^  (\w+(?:Function|Revision)):\n/gm),
  ];
  const consumers = functions
    .filter((entry, index) => {
      const block = template.slice(entry.index, functions[index + 1]?.index);
      return /CLAN_MODEL_SECRET:/.test(block);
    })
    .map((entry) => entry[1]);
  assert.deepEqual(consumers, [
    "WebApiWebRevision",
    "EmailRelayFunction",
    "TimelineSyncFunction",
    "JobsFunction",
  ]);
  assert.equal((template.match(/CLAN_MODEL_SECRET:/g) ?? []).length, 4);
  assert.equal(
    (
      template.match(/\$\{AppSecretName\}:SecretString:clan_sealing_secret/g) ??
      []
    ).length,
    4,
  );
});

test("Turnstile: only the relay holds the secret, only once the app secret carries it; the doors and relay share one mode", async () => {
  const template = await readFile(templateUrl, "utf8");
  const functions = [
    ...template.matchAll(/^  (\w+(?:Function|Revision)):\n/gm),
  ];
  const holding = (re) =>
    functions
      .filter((entry, index) =>
        re.test(template.slice(entry.index, functions[index + 1]?.index)),
      )
      .map((entry) => entry[1]);
  // The doors reach only the NAT-free VPC; the relay is the one function
  // that can ask Cloudflare, so it alone holds the secret.
  assert.deepEqual(holding(/TURNSTILE_SECRET_KEY:/), ["EmailRelayFunction"]);
  assert.match(
    template,
    /TURNSTILE_SECRET_KEY: !If\n\s+- HasTurnstileKey\n.+turnstile_secret_key\}\}"\n\s+- !Ref AWS::NoValue/,
  );
  assert.match(
    template,
    /^  HasTurnstileKey: !Equals \[!Ref TurnstileKeyInSecret, "true"\]$/m,
  );
  assert.deepEqual(holding(/TURNSTILE_MODE: !Ref TurnstileMode/), [
    "WebApiWebRevision",
    "McpWebRevision",
    "EmailRelayFunction",
  ]);
  assert.match(
    template,
    /^  TurnstileMode:\n {4}Type: String\n {4}Default: observe$/m,
  );
  for (const key of ["TurnstileKeyInSecret", "TurnstileMode"])
    assert.ok(PRESERVED_PARAMETERS.includes(key), key);
  // The relay keeps verdicts under its own prefix, and nothing else.
  const relayRole = resource(
    template,
    "EmailRelayRole",
    "SenderConfigurationSet",
  );
  assert.match(relayRole, /mail-delivery\/turnstile\/\*/);
  // The site's CSP lets the console load Cloudflare's script and frame.
  assert.match(
    template,
    /script-src 'self' https:\/\/tinylytics\.app https:\/\/challenges\.cloudflare\.com;\n\s+frame-src https:\/\/challenges\.cloudflare\.com;/,
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
      "assets/cards/26000000_evo.png",
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

test("CI builds the site once per job (#73)", async () => {
  // The test runner (infra/scripts/test.mjs) builds the merged tree once
  // when the site workspace is among its units, so no test shard builds
  // it in a step of its own; each e2e shard runs on a runner of its own
  // and builds it once for the Playwright webServer.
  const workflow = await readFile(
    new URL("../../../.github/workflows/validate.yml", import.meta.url),
    "utf8",
  );
  const job = (name) =>
    workflow
      .split(/^ {2}(?=[a-z][\w-]*:\s*$)/m)
      .find((block) => block.startsWith(`${name}:`)) ?? "";
  const builds = /^\s*- run: .*build-site\.mjs/gm;
  assert.equal(job("test").match(builds)?.length ?? 0, 0);
  assert.equal(job("static").match(builds)?.length ?? 0, 0);
  assert.equal(job("e2e").match(builds)?.length ?? 0, 1);
  assert.equal(workflow.match(builds)?.length ?? 0, 1);
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
  // A focused `npm test -w @elixir-mcp/site` builds it in pretest; the
  // runner skips pretest (--ignore-scripts) because it built it first.
  assert.match(site.scripts.pretest, /build-site\.mjs/);
  assert.doesNotMatch(site.scripts.test, /build/);
  const runner = await readFile(
    new URL("../../../infra/scripts/test.mjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /"infra\/scripts\/build-site\.mjs", "--skip-stats"/);
});

test("the one-minute mail rule also drains answers to feedback (0204)", async () => {
  const template = await readFile(templateUrl, "utf8");
  assert.match(
    resource(template, "CollectorUpgradeRule", "CollectorUpgradePermission"),
    /Input: '\{"collector_upgrades": true, "feedback_answers": true\}'/,
  );
});

test("a site miss fails over to the site's 404 page, on the site behaviour alone", async () => {
  const template = await readFile(templateUrl, "utf8");
  // The default (site) behaviour targets the group: the bucket first,
  // then the web API, which answers 404.html with a true 404.
  const group = template.slice(
    template.indexOf("        OriginGroups:"),
    template.indexOf("        DefaultCacheBehavior:"),
  );
  assert.match(group, /- Id: site-or-miss\n/);
  assert.match(group, /Items: \[403, 404\]/);
  assert.match(group, /- OriginId: site\n\s+- OriginId: api\n/);
  const defaults = template.slice(
    template.indexOf("        DefaultCacheBehavior:"),
    template.indexOf("        CacheBehaviors:"),
  );
  assert.match(defaults, /TargetOriginId: site-or-miss\n/);
  // No other behaviour fails over: the API, MCP and OAuth doors keep
  // their own refusals, and CustomErrorResponses, which are
  // distribution-wide, stay out.
  for (const [p, block] of cacheBehaviours(template))
    assert.doesNotMatch(
      block,
      /TargetOriginId: site-or-miss/,
      `${p} fails over`,
    );
  assert.doesNotMatch(template, /^\s+CustomErrorResponses:/m);
  // The web API may read the page it serves, and nothing else new.
  assert.match(
    template,
    /arn:aws:s3:::elixir-mcp-site-\$\{AWS::AccountId\}\/404\.html/,
  );
});

test("Discord posts refused or lost across every webhook page the ops queue, from the relay's log", async () => {
  const template = await readFile(templateUrl, "utf8");
  const filter = resource(
    template,
    "DiscordUndeliveredFilter",
    "DiscordUndeliveredAlarm",
  );
  assert.match(filter, /LogGroupName: !Ref EmailRelayLogGroup/);
  assert.match(filter, /FilterPattern: '"discord_undelivered"'/);
  assert.match(filter, /MetricName: Undelivered\n/);
  const alarm = resource(
    template,
    "DiscordUndeliveredAlarm",
    "WarUnresolvedAlarm",
  );
  assert.match(alarm, /Period: 3600/);
  assert.match(alarm, /Threshold: 5/);
  assert.match(alarm, /AlarmActions: \[!Ref AlarmTopic\]/);
});

test("OAuth form spaces normalize before origin signing without changing literal pluses or repeats", async () => {
  const { runInNewContext } = await import("node:vm");
  const template = await readFile(templateUrl, "utf8");
  const source = resource(template, "OauthQueryNormalizer", "AlarmTopic")
    .split("FunctionCode: |\n")[1]
    .split("\n  #")[0];
  const handler = runInNewContext(`${source}\nhandler`);
  const request = {
    querystring: {
      scope: {
        value: "openid+players%3Aread",
        multiValue: [
          { value: "openid+players%3Aread" },
          { value: "literal%2Bplus" },
        ],
      },
      state: { value: "a%2Bb+c" },
    },
  };
  assert.equal(handler({ request }), request);
  assert.equal(request.querystring.scope.value, "openid%20players%3Aread");
  assert.deepEqual(
    request.querystring.scope.multiValue.map((p) => p.value),
    ["openid%20players%3Aread", "literal%2Bplus"],
  );
  assert.equal(request.querystring.state.value, "a%2Bb%20c");
  // What URLSearchParams writes for a search with a space (Clan's roster
  // find, 2026-10-16: the edge's own 403 HTML until this ran there).
  const find = { querystring: { find: { value: "King+Thing" } } };
  handler({ request: find });
  assert.equal(find.querystring.find.value, "King%20Thing");
  assert.equal(
    new URLSearchParams(`find=${find.querystring.find.value}`).get("find"),
    new URLSearchParams("find=King+Thing").get("find"),
    "the doors read both spellings as the same space",
  );
});

test("every behaviour that reaches a Web Function normalizes the query before signing", async () => {
  // The origin access control signs every origin request, and a raw '+'
  // in a forwarded query breaks the signature (2026-10-16: /clan/*,
  // /console, /api/*, /api/v1/*, /api/public/*, /mcp, /oauth/* all
  // answered CloudFront's 403). A behaviour takes one function per event
  // type, so each carries exactly one viewer-request association.
  const template = await readFile(templateUrl, "utf8");
  const behaviours = cacheBehaviours(template);
  const doors = behaviours.filter(([, block]) =>
    /TargetOriginId: (?:api|mcpapi|collector)\n/.test(block),
  );
  assert.ok(doors.length >= 17, `${doors.length} door behaviours`);
  assert.equal(doors.length, behaviours.length, "every behaviour is a door's");
  for (const [path, block] of doors) {
    assert.equal(
      block.match(/EventType: viewer-request/g)?.length,
      1,
      `${path}: one viewer-request function`,
    );
    assert.match(
      block,
      /FunctionAssociations:\n\s+- EventType: viewer-request\n\s+FunctionARN: !GetAtt OauthQueryNormalizer\.FunctionMetadata\.FunctionARN/,
      path,
    );
  }
  const fallback = template.slice(
    template.indexOf("        DefaultCacheBehavior:"),
    template.indexOf("        CacheBehaviors:"),
  );
  assert.match(fallback, /FunctionARN: !GetAtt SpaRouter/);
  assert.doesNotMatch(fallback, /OauthQueryNormalizer/);
});

test("native doors cap the private database pools and pin IAM HomeRegion revisions", async () => {
  const template = await readFile(templateUrl, "utf8");
  for (const [door, next, pool] of [
    ["WebApi", "CollectorLogGroup", 4],
    ["Collector", "McpLogGroup", 2],
    ["Mcp", "SchedulerLogGroup", 4],
  ]) {
    const native = resource(template, `${door}WebFunction`, next);
    assert.match(
      native,
      /EgressNetworkConnectorArn: !GetAtt WebNetworkConnector.LatestVersionArn/,
    );
    assert.match(native, new RegExp(`DB_POOL_MAX: "${pool}"`));
    assert.match(native, /EndpointType: HomeRegion/);
    assert.match(native, /AuthType: IamAuth/);
    assert.match(
      native,
      new RegExp(`RevisionId: !GetAtt ${door}WebRevision.RevisionId`),
    );
    assert.match(native, /MaxEnvironments: 2/);
    assert.match(native, /RateLimit: 100/);
  }
  assert.match(template, /SigningBehavior: always-amz-auth/);
  assert.match(template, /Headers: \[Authorization\]/);
});

// The card mirror is the browser boundary, including Verify and collector art.
test("the image policy cannot hotlink Supercell card art", async () => {
  const template = await readFile(templateUrl, "utf8");
  assert.ok(!template.includes("https://api-assets.clashroyale.com"));
});
