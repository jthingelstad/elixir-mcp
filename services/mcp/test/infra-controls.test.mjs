import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_THROTTLES } from "../../../infra/scripts/api-throttle-config.mjs";
import { parseDeployArgs } from "../../../infra/scripts/lib/deploy-args.mjs";
import { ciGate } from "../../../infra/scripts/lib/ci-gate.mjs";

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

test("every database-facing Lambda names its connections and bounds its statements under its own timeout", async () => {
  // Review 2026-09-27 §3.1: five functions connected as one user with no
  // application_name and, the invoker's budget aside, no statement bound,
  // so a statement a Lambda abandoned ran on (0099, 2026-09-15; two `pop`
  // backends of 42 and 57 minutes, 2026-09-18).
  const template = await readFile(templateUrl, "utf8");
  const functions = [
    ["WebApiFunction", "McpLogGroup", "elixir-mcp-web-api"],
    ["McpFunction", "SchedulerLogGroup", "elixir-mcp-mcp"],
    ["SchedulerFunction", "SchedulerRule", "elixir-mcp-scheduler"],
    ["MigrateFunction", "JobsLogGroup", "elixir-mcp-migrate"],
    ["JobsFunction", "EditorLogGroup", "elixir-mcp-jobs"],
  ];
  for (const [logicalId, nextLogicalId, name] of functions) {
    const block = resource(template, logicalId, nextLogicalId);
    assert.match(block, /DATABASE_URL:/, logicalId);
    assert.match(
      block,
      new RegExp(`^          PGAPPNAME: ${name}$`, "m"),
      logicalId,
    );
    const timeout = Number(/^      Timeout: (\d+)$/m.exec(block)[1]);
    const options = /^          PGOPTIONS: "(.+)"$/m.exec(block)?.[1] ?? "";
    const statement = /-c statement_timeout=(\d+)s\b/.exec(options);
    assert.ok(statement, `${logicalId} sets statement_timeout`);
    assert.ok(
      Number(statement[1]) < timeout,
      `${logicalId}: statement_timeout ${statement[1]} s is under the ${timeout} s Lambda timeout`,
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
  assert.equal((template.match(/^          DATABASE_URL:/gm) ?? []).length, 5);
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
  assert.equal(parseDeployArgs(["--break-glass"]).breakGlass, true);
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
