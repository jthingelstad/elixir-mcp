/**
 * The batch hold (#440; production-lock.mjs holdForBatch, op-batch.mjs):
 * one lock for a whole command, recognised by every `npm run op` inside,
 * refused with the holder named when someone else has it, and released
 * only once the command has stopped, signals included. Real lock files
 * in a scratch directory; the ops Lambda is a stub, so nothing reaches
 * AWS.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BATCH_LOCK_ENV,
  acquireLock,
  batchLockFromEnv,
  holdForBatch,
  lockHolder,
  releaseLock,
} from "../../../infra/scripts/lib/production-lock.mjs";
import { parseBatchArgs } from "../../../infra/scripts/op-batch.mjs";

const LOCK_LIB = new URL(
  "../../../infra/scripts/lib/production-lock.mjs",
  import.meta.url,
).href;
const OPS_LIB = new URL(
  "../../../infra/scripts/lib/ops-invoke.mjs",
  import.meta.url,
).href;

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "prod-lock-batch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "elixir-production-lock.json");
}

const silent = () => {};

/** A child process that does nothing until told how to end. */
function fakeChild() {
  const child = new EventEmitter();
  child.killed = [];
  child.kill = (signal) => child.killed.push(signal);
  return child;
}

test("batch: every op inside runs under the batch's lock, and the lock ends with the command", async (t) => {
  const file = scratch(t);
  // Two writes and a read, each a real runOp with a real lock file: an op
  // that tried to take the lock itself would meet the batch's and exit 3.
  const script = `
    import * as lock from ${JSON.stringify(LOCK_LIB)};
    import { runOp } from ${JSON.stringify(OPS_LIB)};
    const file = ${JSON.stringify(file)};
    class InvokeCommand { constructor(input) { this.input = input; } }
    const codes = [];
    for (const payload of ['{"vacuum": {"table": "a"}}', '{"vacuum": {"table": "b"}}', '{"stats": true}'])
      codes.push(await runOp({
        argv: [payload],
        whoami: async () => "arn:aws:sts::1:assumed-role/ProjectsCloudEngineer/x",
        lambda: { send: async () => ({ StatusCode: 200, Payload: Buffer.from("{}") }) },
        InvokeCommand,
        lockFile: file,
        acquireLock: lock.acquireLock,
        lockHolder: lock.lockHolder,
        holdUntilExit: lock.holdUntilExit,
        describe: lock.describeHolder,
        worktree: "/w",
        head: "h",
        batchLock: () => lock.batchLockFromEnv({ file, warn: () => {} }),
        print: () => {},
        warn: () => {},
      }));
    const held = lock.lockHolder({ file, warn: () => {} });
    process.stdout.write(JSON.stringify({ codes, holder: held?.holder, id: held?.lock_id }));
    process.exit(codes.every((c) => c === 0) ? 0 : 5);`;
  let out = "";
  const { spawn } = await import("node:child_process");
  const code = await holdForBatch({
    file,
    purpose: "repair x, resumable",
    command: process.execPath,
    args: ["--input-type=module", "-e", script],
    spawn: (cmd, args, opts) => {
      const p = spawn(cmd, args, {
        ...opts,
        stdio: ["ignore", "pipe", "inherit"],
      });
      p.stdout.on("data", (d) => (out += d));
      return p;
    },
    log: silent,
  });
  const seen = JSON.parse(out);
  assert.equal(code, 0, out);
  assert.deepEqual(seen.codes, [0, 0, 0]);
  assert.equal(seen.holder, "batch");
  assert.equal(existsSync(file), false, "released once the command ended");
});

test("batch: the command's exit code is the batch's", async (t) => {
  const file = scratch(t);
  const code = await holdForBatch({
    file,
    purpose: "x",
    command: process.execPath,
    args: ["-e", "process.exit(7)"],
    log: silent,
  });
  assert.equal(code, 7);
  assert.equal(existsSync(file), false);
});

test("batch: someone else's lock refuses the batch with who holds it; nothing is run", async (t) => {
  const file = scratch(t);
  const deploy = acquireLock({
    file,
    holder: "deploy",
    purpose: "deploy.mjs (update)",
    warn: silent,
  });
  const lines = [];
  let spawned = false;
  const code = await holdForBatch({
    file,
    purpose: "backfill",
    command: "true",
    spawn: () => {
      spawned = true;
      return fakeChild();
    },
    log: (l) => lines.push(l),
  });
  assert.equal(code, 3);
  assert.equal(spawned, false);
  assert.match(lines.join("\n"), /production is locked; held by deploy/);
  assert.match(lines.join("\n"), /deploy\.mjs \(update\)/);
  assert.match(lines.join("\n"), /Nothing was run/);
  assert.equal(lockHolder({ file, warn: silent }).lock_id, deploy.lock.lock_id);
  releaseLock({ file, lockId: deploy.lock.lock_id });
});

test("batch: a signal goes to the command, and the lock is released only once it has stopped", async (t) => {
  const file = scratch(t);
  const proc = new EventEmitter();
  const child = fakeChild();
  let env;
  const done = holdForBatch({
    file,
    purpose: "x",
    command: "worker",
    spawn: (_cmd, _args, opts) => {
      env = opts.env;
      return child;
    },
    proc,
    log: silent,
  });
  const lock = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(env[BATCH_LOCK_ENV], lock.lock_id);
  assert.equal(lock.holder, "batch");

  proc.emit("SIGTERM");
  assert.deepEqual(child.killed, ["SIGTERM"]);
  assert.equal(existsSync(file), true, "held while the command still runs");
  child.emit("close", null, "SIGTERM");
  assert.equal(await done, 143);
  assert.equal(existsSync(file), false);
  // Nothing is left listening on the process.
  for (const event of ["SIGINT", "SIGTERM", "SIGHUP", "exit"])
    assert.equal(proc.listenerCount(event), 0, event);
});

test(
  "batch: the lock waits for every process the command started, not only the command",
  { timeout: 15_000 },
  async (t) => {
    // Codex on #1044: a shell killed by SIGTERM while its op still runs.
    // The worker traps SIGTERM and finishes a write; the batch must not
    // release the lock until it has.
    const file = scratch(t);
    const dir = path.dirname(file);
    const ready = path.join(dir, "ready");
    const finished = path.join(dir, "finished");
    const worker = `
    const { writeFileSync } = require("node:fs");
    process.on("SIGTERM", () => setTimeout(() => {
      writeFileSync(${JSON.stringify(finished)}, "done");
      process.exit(0);
    }, 300));
    writeFileSync(${JSON.stringify(ready)}, "up");
    // Never outlives the test, even if the signal never reaches it.
    setTimeout(() => process.exit(9), 8000);`;
    const proc = new EventEmitter();
    const done = holdForBatch({
      file,
      purpose: "x",
      command: "sh",
      args: [
        "-c",
        `"${process.execPath}" -e '${worker.replace(/'/g, "'\\''")}' & wait`,
      ],
      proc,
      log: silent,
    });
    while (!existsSync(ready)) await new Promise((r) => setTimeout(r, 20));
    proc.emit("SIGTERM");
    const code = await done;
    assert.equal(code, 143, "the shell died of the signal");
    assert.equal(existsSync(finished), true, "the worker finished first");
    assert.equal(
      existsSync(file),
      false,
      "and only then was the lock released",
    );
  },
);

test("batch: an exit before the command ends still releases the lock", async (t) => {
  const file = scratch(t);
  const proc = new EventEmitter();
  const child = fakeChild();
  const done = holdForBatch({
    file,
    purpose: "x",
    command: "worker",
    spawn: () => child,
    proc,
    log: silent,
  });
  assert.equal(existsSync(file), true);
  proc.emit("exit", 1);
  assert.equal(existsSync(file), false);
  child.emit("close", 1, null);
  assert.equal(await done, 1);
});

test("batch: a batch inside a batch runs under the outer lock", async (t) => {
  const file = scratch(t);
  const outer = acquireLock({
    file,
    holder: "batch",
    purpose: "outer",
    warn: silent,
  });
  const child = fakeChild();
  let acquired = false;
  const done = holdForBatch({
    file,
    purpose: "inner",
    command: "worker",
    env: { [BATCH_LOCK_ENV]: outer.lock.lock_id },
    acquire: () => {
      acquired = true;
      return { ok: false, reason: "x" };
    },
    spawn: () => child,
    proc: new EventEmitter(),
    log: silent,
  });
  child.emit("close", 0, null);
  assert.equal(await done, 0);
  assert.equal(acquired, false);
  assert.equal(lockHolder({ file, warn: silent }).lock_id, outer.lock.lock_id);
  releaseLock({ file, lockId: outer.lock.lock_id });
});

test("batch: an inherited id counts only while that batch's lock is live", (t) => {
  const file = scratch(t);
  const lines = [];
  const warn = (l) => lines.push(l);
  assert.equal(batchLockFromEnv({ file, env: {}, warn }), null);
  assert.equal(lines.length, 0);

  // The batch is gone: a stale id is no lock, said once.
  assert.equal(
    batchLockFromEnv({ file, env: { [BATCH_LOCK_ENV]: "gone" }, warn }),
    null,
  );
  assert.match(lines[0], /no longer held/);

  // A deploy's lock is never a batch's, whatever id is presented.
  const deploy = acquireLock({
    file,
    holder: "deploy",
    purpose: "d",
    warn: silent,
  });
  assert.equal(
    batchLockFromEnv({
      file,
      env: { [BATCH_LOCK_ENV]: deploy.lock.lock_id },
      warn,
    }),
    null,
  );
  releaseLock({ file, lockId: deploy.lock.lock_id });

  // A batch whose process died: reclaimed, and no longer counts.
  const dead = acquireLock({
    file,
    holder: "batch",
    purpose: "b",
    pid: 999_999,
    alive: () => true,
    warn: silent,
  });
  assert.equal(
    batchLockFromEnv({
      file,
      env: { [BATCH_LOCK_ENV]: dead.lock.lock_id },
      alive: () => false,
      warn: silent,
    }),
    null,
  );
  assert.equal(existsSync(file), false);

  const live = acquireLock({
    file,
    holder: "batch",
    purpose: "b",
    warn: silent,
  });
  assert.equal(
    batchLockFromEnv({
      file,
      env: { [BATCH_LOCK_ENV]: live.lock.lock_id },
      warn,
    }).lock_id,
    live.lock.lock_id,
  );
  releaseLock({ file, lockId: live.lock.lock_id });
});

test("op:batch: arguments", () => {
  assert.deepEqual(
    parseBatchArgs([
      "--purpose",
      "fix x",
      "--",
      "sh",
      "-c",
      "npm run op -- '{}'",
    ]),
    {
      help: false,
      purpose: "fix x",
      command: "sh",
      args: ["-c", "npm run op -- '{}'"],
      errors: [],
    },
  );
  assert.equal(parseBatchArgs(["--help"]).help, true);
  assert.equal(parseBatchArgs(["--purpose=x", "--", "a"]).purpose, "x");
  // Flags after -- belong to the command.
  assert.deepEqual(
    parseBatchArgs(["--purpose", "x", "--", "a", "--help"]).args,
    ["--help"],
  );
  for (const [argv, re] of [
    [["--", "a"], /--purpose is required/],
    [["--purpose", " ", "--", "a"], /--purpose is required/],
    [["--purpose", "x"], /a command after --/],
    [["--purpose", "x", "--"], /a command after --/],
    [["--force", "--purpose", "x", "--", "a"], /unknown argument --force/],
  ])
    assert.ok(
      parseBatchArgs(argv).errors.some((e) => re.test(e)),
      argv.join(" "),
    );
});
