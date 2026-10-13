import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  guardCollectorNaming,
  readDeployedCollectorMinimum,
  minimumFromSource,
  collectorNamingLock,
} from "../../../infra/scripts/lib/collector-naming.mjs";

const caller = {
  Account: "999153317627",
  Arn: "arn:aws:sts::999153317627:assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
};

test("naming locks the script repository even when called from the domain repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "collector-naming-lock-"));
  const repo = path.join(dir, "elixir-mcp");
  mkdirSync(repo);
  const cwd = process.cwd();
  let held;
  let lock;
  try {
    for (const worktree of [dir, repo]) {
      execFileSync("git", ["init", "-q"], { cwd: worktree });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "--allow-empty",
          "-qm",
          "fixture",
        ],
        { cwd: worktree },
      );
    }
    process.chdir(dir);
    lock = collectorNamingLock(
      pathToFileURL(
        path.join(repo, "infra/scripts/name-collector-release.mjs"),
      ),
      "v3.0.6",
    );
    held = lock.acquire();
    assert.equal(held.ok, true);
    assert.equal(held.lock.worktree, repo);
    assert.equal(
      existsSync(path.join(repo, ".git/elixir-production-lock.json")),
      true,
    );
    assert.equal(
      existsSync(path.join(dir, ".git/elixir-production-lock.json")),
      false,
    );
  } finally {
    if (held?.ok) lock.release(held.lock);
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

function naming(overrides = {}) {
  const events = [];
  const options = {
    tag: "v3.0.6",
    dryRun: false,
    whoami: async () => {
      events.push("identity");
      return caller;
    },
    lock: {
      acquire: () => {
        events.push("lock");
        return { ok: true, lock: { lock_id: "mine" } };
      },
      holdUntilExit: () => {},
      release: (held) => {
        assert.equal(held.lock_id, "mine");
        events.push("release");
      },
    },
    readMinimum: async () => {
      events.push("guard");
      return { minimum: "3.0.6", enforced: true };
    },
    name: async () => {
      events.push("write-1", "write-2", "promote");
    },
    log: () => {},
    ...overrides,
  };
  return { events, run: () => guardCollectorNaming(options) };
}

test("naming refuses a below-minimum release before any write or promotion, and releases the lock", async () => {
  const n = naming({ tag: "v3.0.5" });
  await assert.rejects(n.run, /below the deployed collector minimum 3.0.6/);
  assert.deepEqual(n.events, ["identity", "lock", "guard", "release"]);
});

test("all naming effects are inside the lock for the exact minimum and later releases", async () => {
  for (const tag of ["v3.0.6", "v3.0.7", "v3.1.0"]) {
    const n = naming({ tag });
    await n.run();
    assert.deepEqual(n.events, [
      "identity",
      "lock",
      "guard",
      "write-1",
      "write-2",
      "promote",
      "release",
    ]);
  }
});

test("disabled enforcement retains the ability to name an older release", async () => {
  const n = naming({
    tag: "v3.0.5",
    readMinimum: async () => ({ minimum: "3.0.6", enforced: false }),
  });
  await n.run();
  assert.ok(n.events.includes("promote"));
});

test("dry run checks the deployed guard and performs no writes or locking", async () => {
  const n = naming({ dryRun: true });
  await n.run();
  assert.deepEqual(n.events, ["identity", "guard"]);
  const stale = naming({ dryRun: true, tag: "v3.0.5" });
  await assert.rejects(stale.run, /below/);
  assert.deepEqual(stale.events, ["identity", "guard"]);
});

test("wrong identity and a held lock stop before the deployed read", async () => {
  const bad = naming({
    whoami: async () => ({ ...caller, Account: "000000000000" }),
  });
  await assert.rejects(bad.run, /cloud-engineer/);
  assert.deepEqual(bad.events, []);
  const held = naming({
    lock: { acquire: () => ({ ok: false, reason: "held" }) },
  });
  await assert.rejects(held.run, (error) => error.exitCode === 3);
  assert.deepEqual(held.events, ["identity"]);
});

test("failed guard or naming always releases the acquired lock", async () => {
  for (const effect of ["readMinimum", "name"]) {
    const n = naming({
      [effect]: async () => {
        throw new Error("failed");
      },
    });
    await assert.rejects(n.run, /failed/);
    assert.equal(n.events.at(-1), "release");
    assert.ok(!n.events.includes("promote"));
  }
  const malformed = naming({
    readMinimum: async () => ({ minimum: "unknown", enforced: true }),
  });
  await assert.rejects(malformed.run, /Invalid deployed/);
  assert.equal(malformed.events.at(-1), "release");
});

function deployed({
  status = "UPDATE_COMPLETE",
  version = "immutable",
  endpointRevision = "deployed",
  updateStatus = "Successful",
  source = 'const CONFIG = { min_client_version: "3.0.6" };',
  returnedVersion = version,
} = {}) {
  const calls = [];
  const values = {
    CodeBucket: "elixir-mcp-code-999153317627",
    CollectorCodeKey: "code/collector/0123456789abcdef.zip",
    CollectorCodeVersion: version,
    CollectorMinEnforce: "1",
  };
  const outputs = {
    CollectorWebFunctionName: "elixir-mcp-collector-web",
    CollectorWebRevisionId: "deployed",
  };
  const options = {
    cf: {
      send: async () => ({
        Stacks: [
          {
            StackStatus: status,
            Parameters: Object.entries(values).map(
              ([ParameterKey, ParameterValue]) => ({
                ParameterKey,
                ParameterValue,
              }),
            ),
            Outputs: Object.entries(outputs).map(
              ([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }),
            ),
          },
        ],
      }),
    },
    web: {
      send: async () => ({
        state: "Active",
        updateStatus,
        authType: "IamAuth",
        autoDeploymentMode: "Disabled",
        revisionWeights: [{ revisionId: endpointRevision, weight: 100 }],
      }),
    },
    s3: {
      send: async (command) => {
        calls.push(command.input);
        return {
          VersionId: returnedVersion,
          Body: { transformToByteArray: async () => new Uint8Array() },
        };
      },
    },
    unpack: () => source,
  };
  return { calls, run: () => readDeployedCollectorMinimum(options) };
}

test("deployed guard reads the exact immutable source version for the serving revision", async () => {
  const d = deployed();
  assert.deepEqual(await d.run(), { minimum: "3.0.6", enforced: true });
  assert.equal(d.calls[0].VersionId, "immutable");
  assert.equal(d.calls[0].Key, "code/collector/0123456789abcdef.zip");
});

test("a completed stack rollback still verifies its serving revision and immutable source", async () => {
  assert.deepEqual(
    await deployed({ status: "UPDATE_ROLLBACK_COMPLETE" }).run(),
    { minimum: "3.0.6", enforced: true },
  );
  await assert.rejects(
    deployed({ status: "UPDATE_ROLLBACK_COMPLETE", endpointRevision: "other" })
      .run,
    /not pinned/,
  );
});

test("unstable stacks, missing immutable sources and mismatched endpoints fail before downloading code", async () => {
  for (const overrides of [
    { status: "UPDATE_IN_PROGRESS" },
    { status: "UPDATE_ROLLBACK_IN_PROGRESS" },
    { status: "UPDATE_ROLLBACK_FAILED" },
    { version: "null" },
    { endpointRevision: "other" },
    { updateStatus: "InProgress" },
  ]) {
    const d = deployed(overrides);
    await assert.rejects(d.run);
    assert.deepEqual(d.calls, []);
  }
  await assert.rejects(
    deployed({ returnedVersion: "other" }).run,
    /source version differs/,
  );
});

test("missing, malformed and ambiguous minimum literals fail closed", () => {
  for (const source of [
    "",
    'min_client_version: "unknown"',
    'min_client_version: "3.0.5", min_client_version: "3.0.6"',
  ])
    assert.throws(() => minimumFromSource(source), /missing or ambiguous/);
});
