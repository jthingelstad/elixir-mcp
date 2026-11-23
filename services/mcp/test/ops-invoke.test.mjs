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
  assert.ok(migrate.has("stats") && jobs.has("shape_census"));
  // Retired 2026-11-13: the jobs dispatcher no longer answers it.
  assert.equal(jobs.has("series_metrics"), false);
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
    { discord_review: { key: "#J2RGCRVG" } },
    { backends: true },
    { ledger: true },
    { ledger: { op: "dead" } },
    { account_role: { list: true } },
    { integration: { action: "list" } },
    { family_clients: { list: true } },
    { oauth_grants: { redirect_host: "drop.poapkings.com" } },
    { reindex: { table: "battle" } },
    { account_remove: { email: "x", dry_run: true } },
    { account_follow: { primary_tag: "#A", player_tag: "#B", dry_run: true } },
    { test_account: { list: true } },
    { verified_tag_census: { dry_run: true } },
    { comment_delivery: { tag: "#0PYLQ2" } },
    { clan_maintenance: { lane: "actions", clan_tag: "#A" } },
    {
      clan_maintenance: { lane: "draft_packet", clan_tag: "#A", card_id: "c" },
    },
  ])
    assert.equal(kind(payload), "read", JSON.stringify(payload));
});

test("op: everything else is a write, and takes the lock", () => {
  for (const payload of [
    {}, // the migrations
    { vacuum: { table: "battle" } },
    { terminate_backends: { pids: [1] } },
    { rewrite_table: { table: "battle" } },
    { card_roles_import: {} },
    { feedback_respond: { id: 1 } },
    { seed: true },
    // A read op's write shapes.
    { ledger: { op: "requeue", job_ids: ["1"] } },
    { ledger: { op: "dead", job_ids: ["1"] } },
    { account_role: { account_id: "u", role: "owner" } },
    { account_role: { list: true, account_id: "u", role: "owner" } },
    { integration: { action: "create" } },
    { integration: { action: "revoke_legacy", id: "1" } },
    { integration: {} },
    { family_clients: { set_secret: {} } },
    { family_clients: { list: true, provision: { app: "x" } } },
    { oauth_grants: { revoke: ["f"] } },
    { oauth_grants: { redirect_host: "x", revoke: ["f"] } },
    // The rebuild and the leftover's drop; anything beside the table.
    { reindex: { table: "battle", index: "battle_pkey", apply: true } },
    { reindex: { table: "battle", drop_invalid: "battle_pkey_ccnew" } },
    { reindex: { table: "battle", index: "battle_pkey" } },
    { reindex: { table: "battle", apply: false } },
    { reindex: true },
    { reindex: {} },
    { account_remove: { email: "x" } }, // defaults to a dry run; not counted
    { account_enroll: { dry_run: false } },
    { account_follow: { primary_tag: "#A" } }, // defaults to a REAL run
    { test_account: { name: "gym", clan_tag: "#A", token_hash: "h" } },
    { test_account: { list: true, name: "gym" } },
    { test_account: { list: false } },
    { verified_tag_census: { dry_run: false } },
    { verified_tag_census: {} },
    { clan_maintenance: { lane: "reconcile_removal", card_id: "c" } },
    { clan_maintenance: { lane: "actions", apply: false } },
    { clan_maintenance: { lane: "draft_packet", apply: true } },
    // The catalogue's read that may refresh a stamp.
    { reference_seed_preview: { roles: [] } },
    // Unknown, misspelt, falsy, or mixed with a write.
    { stat: true },
    { stats: false },
    { stats: 0 },
    { stats: true, vacuum: true },
    { account_follow: { dry_run: true }, stats: true, seed: true },
  ])
    assert.equal(kind(payload), "write", JSON.stringify(payload));
  for (const payload of [
    { email: "clan_report" },
    { shape_census: true }, // writes payload_shape_seen and feedback
    { capture_efficiency: true }, // upserts capture_efficiency_daily
    { collector_upgrades: true },
    { stats: true }, // a migrate op, unknown to jobs
    { series_metrics: true }, // retired 2026-11-13; unknown, so a write
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

test("op: inside a batch, a write and a read run under the batch's lock: nothing taken, nothing refused", async () => {
  const batch = { holder: "batch", lock_id: "B", purpose: "repair x" };
  for (const argv of [['{"vacuum": true}'], ['{"stats": true}']]) {
    // lockHolder answers the batch's own lock, which must not refuse it.
    const h = harness({ held: batch });
    assert.equal(
      await runOp({ ...h.deps, batchLock: () => batch, argv }),
      0,
      argv[0],
    );
    assert.deepEqual(h.events, ["invoke"]);
    assert.match(
      h.err.join("\n"),
      /under the batch's production lock \(repair x\)/,
    );
  }
});

/** The SDK's throttle, refused before the function ran. */
function throttled() {
  return Object.assign(new Error("Rate Exceeded."), {
    name: "TooManyRequestsException",
    Reason: "ReservedFunctionConcurrentInvocationLimitExceeded",
    $metadata: { httpStatusCode: 429 },
  });
}

/** A harness whose Lambda throws a throttle `n` times, then answers. */
function throttledHarness(n, options) {
  const h = harness(options);
  const answer = h.deps.lambda.send;
  let left = n;
  h.deps.lambda = {
    send: async (command) => {
      if (left > 0) {
        left -= 1;
        h.events.push("throttled");
        throw throttled();
      }
      return answer(command);
    },
  };
  h.slept = [];
  h.deps.sleep = async (ms) => h.slept.push(ms);
  return h;
}

test("op: a throttled write waits it out under its lock and is sent again; the lock is released after", async () => {
  const h = throttledHarness(2);
  assert.equal(await runOp({ ...h.deps, argv: ['{"vacuum": true}'] }), 0);
  assert.deepEqual(h.events, [
    "acquire op:vacuum",
    "throttled",
    "throttled",
    "invoke",
    "release L",
  ]);
  assert.deepEqual(h.slept, [2_000, 4_000]);
  assert.match(h.err.join("\n"), /throttled .*it was not run/);
});

test("op: a throttled read stops waiting the moment production is locked", async () => {
  const h = throttledHarness(5);
  let checks = 0;
  h.deps.lockHolder = () =>
    (checks += 1) <= 1 ? null : { holder: "deploy", lock_id: "D" };
  assert.equal(await runOp({ ...h.deps, argv: ['{"stats": true}'] }), 3);
  // Free at the start; locked at the first throttle, so no wait and no
  // second send.
  assert.deepEqual(h.events, ["throttled"]);
  assert.deepEqual(h.slept, []);
  assert.match(
    h.err.join("\n"),
    /locked while this read waited; held by deploy/,
  );
});

test("op: a lock taken during a throttled read's wait stops it before the resend", async () => {
  const h = throttledHarness(5);
  let locked = false;
  h.deps.lockHolder = () =>
    locked ? { holder: "deploy", lock_id: "D" } : null;
  h.deps.sleep = async (ms) => {
    h.slept.push(ms);
    locked = true; // a deploy takes the lock mid-wait
  };
  assert.equal(await runOp({ ...h.deps, argv: ['{"stats": true}'] }), 3);
  assert.deepEqual(h.events, ["throttled"], "never sent under the lock");
  assert.deepEqual(h.slept, [2_000]);
});

test("op: a function busy past its own timeout exits 4 and still releases the lock", async () => {
  const h = throttledHarness(10_000);
  assert.equal(await runOp({ ...h.deps, argv: ['{"vacuum": true}'] }), 4);
  assert.equal(h.events.at(-1), "release L");
  assert.equal(
    h.slept.reduce((a, b) => a + b, 0),
    (FUNCTIONS.migrate.timeoutS + 30) * 1000,
  );
  assert.match(h.err.join("\n"), /stayed busy past its own timeout/);
});
