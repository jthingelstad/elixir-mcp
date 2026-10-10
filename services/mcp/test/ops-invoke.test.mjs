/**
 * `npm run op` (infra/scripts/op.mjs, lib/ops-invoke.mjs): which ops are
 * reads, the arguments, and the one invoke, all offline. Nothing here
 * reaches AWS: the Lambda client, the identity and the lock are stubs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FUNCTIONS,
  READ_KEYS,
  classifyOp,
  lambdaClientConfig,
  parseOpArgs,
  runOp,
} from "../../../infra/scripts/lib/ops-invoke.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const kind = (payload, fn = "migrate") => classifyOp(fn, payload).kind;

test("op: the allowlist names only keys the dispatchers still have", () => {
  const migrate = new Set(
    [
      ...readFileSync(
        path.join(repoRoot, "services/migrate/src/lambda.mjs"),
        "utf8",
      ).matchAll(/\bif\s*\(\s*event\?\.([a-z_]+)\s*\)/g),
    ].map((m) => m[1]),
  );
  const jobs = new Set(
    [
      ...readFileSync(
        path.join(repoRoot, "services/jobs/src/index.mjs"),
        "utf8",
      ).matchAll(/\bevent\?\.([a-z_]+)/g),
    ].map((m) => m[1]),
  );
  assert.ok(migrate.has("stats") && jobs.has("clan_report_preview"));
  assert.deepEqual(
    READ_KEYS.migrate.filter((k) => !migrate.has(k)),
    [],
    "a read op the migrate dispatcher no longer has",
  );
  assert.deepEqual(
    READ_KEYS.jobs.filter((k) => !jobs.has(k)),
    [],
    "a read op the jobs dispatcher no longer has",
  );
});

test("op: reads are reads", () => {
  for (const payload of [
    { stats: true },
    { capture_audit: { days: 1 } },
    { profile_tool: { tool: "clans_standings", explain: true } },
    { feedback_pending: true },
    { backends: true },
    { ledger: true },
    { ledger: { op: "dead" } },
    { account_role: { list: true } },
    { integration: { action: "list" } },
    { family_clients: { list: true } },
    { oauth_grants: { redirect_host: "drop.poapkings.com" } },
    { rollup_regroup: { census: true } },
    { account_remove: { email: "x", dry_run: true } },
    { account_track: { primary_tag: "#A", player_tag: "#B", dry_run: true } },
    { clan_context: { agents: ["abc"] } },
    { clan_maintenance: { lane: "actions", clan_tag: "#A" } },
  ])
    assert.equal(kind(payload), "read", JSON.stringify(payload));
  assert.equal(
    kind({ clan_report_preview: { clan_tag: "#A" } }, "jobs"),
    "read",
  );
  assert.equal(kind({ series_metrics: true }, "jobs"), "read");
});

test("op: everything else is a write, and takes the lock", () => {
  for (const payload of [
    {}, // the migrations
    { vacuum: { table: "battle" } },
    { terminate_backends: { pids: [1] } },
    { series_backfill: true },
    { card_roles_import: {} },
    { feedback_respond: { id: 1 } },
    { seed: true },
    // A read op's write shapes.
    { ledger: { op: "requeue", job_ids: ["1"] } },
    { ledger: { op: "dead", job_ids: ["1"] } },
    { account_role: { account_id: "u", role: "owner" } },
    { account_role: { list: true, account_id: "u", role: "owner" } },
    { integration: { action: "create" } },
    { integration: {} },
    { family_clients: { set_secret: {} } },
    { family_clients: { list: true, retire_app: { app: "clan" } } },
    { oauth_grants: { revoke: ["f"] } },
    { oauth_grants: { redirect_host: "x", revoke: ["f"] } },
    { rollup_regroup: true },
    { account_remove: { email: "x" } }, // defaults to a dry run; not counted
    { account_enroll: { dry_run: false } },
    { account_track: { primary_tag: "#A" } }, // defaults to a REAL run
    { clan_context: { agents: ["a"], apply: true } },
    { clan_context: { agents: ["a"], revoke: true } },
    { clan_maintenance: { lane: "reconcile_removal", card_id: "c" } },
    { clan_maintenance: { lane: "actions", apply: false } },
    // The catalogue's read that may refresh a stamp.
    { reference_seed_preview: { roles: [] } },
    // Unknown, misspelt, falsy, or mixed with a write.
    { stat: true },
    { stats: false },
    { stats: 0 },
    { stats: true, vacuum: true },
    { account_track: { dry_run: true }, stats: true, seed: true },
  ])
    assert.equal(kind(payload), "write", JSON.stringify(payload));
  for (const payload of [
    { email: "clan_report" },
    { shape_census: true }, // writes payload_shape_seen and feedback
    { capture_efficiency: true }, // upserts capture_efficiency_daily
    { collector_upgrades: true },
    { clan_report_preview: true },
    { stats: true }, // a migrate op, unknown to jobs
  ])
    assert.equal(kind(payload, "jobs"), "write", JSON.stringify(payload));
  for (const payload of [null, [], "stats", 1])
    assert.equal(kind(payload), "write", JSON.stringify(payload));
});

test("op: arguments", () => {
  assert.deepEqual(parseOpArgs(['{"stats":true}']), {
    help: false,
    fn: "migrate",
    payload: { stats: true },
    errors: [],
  });
  assert.equal(parseOpArgs(["{}", "--function", "jobs"]).fn, "jobs");
  assert.equal(parseOpArgs(["--function=jobs", '{"a":1}']).fn, "jobs");
  assert.equal(parseOpArgs(["--help"]).help, true);
  assert.equal(parseOpArgs(["-h"]).help, true);
  const refused = (argv, re) => {
    const { errors } = parseOpArgs(argv);
    assert.ok(
      errors.some((e) => re.test(e)),
      `${argv.join(" ")}: ${errors.join("; ")}`,
    );
  };
  refused([], /payload is required/);
  refused(["{}"], /runs the migrations/);
  refused(["not json"], /not JSON/);
  refused(["[1]"], /JSON object/);
  refused(['{"stats":true}', "--function", "scheduler"], /--function/);
  refused(['{"stats":true}', "--function"], /--function/);
  refused(['{"stats":true}', '{"tables":true}'], /unknown argument/);
  refused(['{"stats":true}', "--retry"], /unknown argument/);
});

test("op: one call is one call, waiting past the function's own timeout", () => {
  for (const fn of Object.keys(FUNCTIONS)) {
    const c = lambdaClientConfig(fn);
    assert.equal(c.maxAttempts, 1);
    assert.equal(c.profile, "cloud-engineer");
    assert.equal(c.region, "us-east-1");
    assert.ok(c.requestHandler.requestTimeout > FUNCTIONS[fn].timeoutS * 1000);
  }
  // Held to the template, so a timeout change there moves this too.
  const template = readFileSync(
    path.join(repoRoot, "infra/template.yaml"),
    "utf8",
  );
  for (const { name, timeoutS } of Object.values(FUNCTIONS)) {
    const at = template.indexOf(`FunctionName: ${name}\n`);
    assert.ok(at > 0, name);
    const timeout = template.slice(at).match(/\n\s+Timeout: (\d+)/);
    assert.equal(Number(timeout[1]), timeoutS, name);
  }
});

/** A runOp harness: a Lambda that records its calls, an identity, and a
 *  lock that records what was taken. */
function harness({
  arn = "arn:aws:sts::999153317627:assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
  response = { StatusCode: 200, Payload: Buffer.from('{"ok":true}') },
  held = null,
} = {}) {
  const calls = [];
  const events = [];
  const out = [];
  const err = [];
  class InvokeCommand {
    constructor(input) {
      this.input = input;
    }
  }
  const deps = {
    whoami: async () => arn,
    lambda: {
      send: async (command) => {
        calls.push(command.input);
        events.push("invoke");
        return response;
      },
    },
    InvokeCommand,
    lockFile: "/tmp/never-written",
    acquireLock: (o) => {
      events.push(`acquire ${o.holder}`);
      return held
        ? { ok: false, lock: held, reason: "production is locked; by deploy" }
        : { ok: true, lock: { lock_id: "L", holder: o.holder } };
    },
    lockHolder: () => held,
    holdUntilExit:
      ({ lock }) =>
      () =>
        events.push(`release ${lock.lock_id}`),
    describe: (l) => `held by ${l.holder}`,
    worktree: "/w",
    head: "h",
    print: (l) => out.push(l),
    warn: (l) => err.push(l),
  };
  return { deps, calls, events, out, err };
}

test("op: a read invokes once, takes no lock, and prints the response", async () => {
  const h = harness();
  assert.equal(await runOp({ ...h.deps, argv: ['{"stats": true}'] }), 0);
  assert.deepEqual(h.events, ["invoke"]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].FunctionName, "elixir-mcp-migrate");
  assert.equal(h.calls[0].InvocationType, "RequestResponse");
  assert.deepEqual(JSON.parse(Buffer.from(h.calls[0].Payload)), {
    stats: true,
  });
  assert.deepEqual(JSON.parse(h.out.join("\n")), { ok: true });
});

test("op: a write takes the lock before the invoke and releases it after", async () => {
  const h = harness();
  assert.equal(
    await runOp({
      ...h.deps,
      argv: ['{"vacuum": {"table": "battle"}}'],
    }),
    0,
  );
  assert.deepEqual(h.events, ["acquire op:vacuum", "invoke", "release L"]);

  const jobs = harness();
  await runOp({
    ...jobs.deps,
    argv: ['{"email": "clan_report"}', "--function", "jobs"],
  });
  assert.equal(jobs.calls[0].FunctionName, "elixir-mcp-jobs");
  assert.equal(jobs.events[0], "acquire op:email");
});

test("op: a held lock refuses a write and a read alike; nothing is invoked", async () => {
  const held = { holder: "deploy", lock_id: "D" };
  for (const argv of [['{"vacuum": true}'], ['{"stats": true}']]) {
    const h = harness({ held });
    assert.equal(await runOp({ ...h.deps, argv }), 3, argv[0]);
    assert.equal(h.calls.length, 0);
    assert.match(h.err.join("\n"), /held by deploy|production is locked/);
  }
});

test("op: a function error is printed and exits non-zero; the lock is still released", async () => {
  const h = harness({
    response: {
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: Buffer.from('{"errorMessage":"boom"}'),
    },
  });
  assert.equal(await runOp({ ...h.deps, argv: ['{"vacuum": true}'] }), 1);
  assert.match(h.out.join("\n"), /boom/);
  assert.match(h.err.join("\n"), /FunctionError Unhandled/);
  assert.deepEqual(h.events.at(-1), "release L");

  // A refusal the op returns without throwing is not a function error.
  const refused = harness({
    response: {
      StatusCode: 200,
      Payload: Buffer.from('{"error":"unknown_op"}'),
    },
  });
  assert.equal(await runOp({ ...refused.deps, argv: ['{"stats": 1}'] }), 0);
  assert.match(refused.err.join("\n"), /answered error "unknown_op"/);
});

test("op: the wrong identity, a bad argument or {} invokes nothing and takes no lock", async () => {
  const jamie = harness({
    arn: "arn:aws:sts::999153317627:assumed-role/AWSReservedSSO_Admin/jamie",
  });
  assert.equal(await runOp({ ...jamie.deps, argv: ['{"vacuum": true}'] }), 2);
  assert.deepEqual(jamie.events, []);
  for (const argv of [["{}"], ["nope"], ['{"stats":true}', "--function=x"]]) {
    const h = harness();
    assert.equal(await runOp({ ...h.deps, argv }), 2, argv.join(" "));
    assert.deepEqual(h.events, []);
  }
});
