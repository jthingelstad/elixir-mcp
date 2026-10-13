import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_BUCKET,
  historyPlan,
  applyHistoryPlan,
  referenceFingerprint,
} from "../../../infra/scripts/lib/deployment-history.mjs";
const cutoff = "2026-10-13T22:00:00Z";
const arn = (id) =>
  "arn:aws:lambda:us-east-1:999153317627:web-function/elixir-mcp-web-api-web/revision/" +
  id;
const key = "code/web-api/1111111111111111.zip",
  eventKey = "code/jobs/2222222222222222.zip";
const object = (Key, VersionId, Size = 10) => ({
  Key,
  VersionId,
  Size,
  LastModified: "2026-10-12T00:00:00.000Z",
});
function fixture() {
  return {
    stackId: "stack",
    codeBucket: CODE_BUCKET,
    codeKeys: { "web-api": key, jobs: eventKey },
    codeVersions: { "web-api": "live-source" },
    managedRevisions: [arn("live")],
    eventFunctions: ["elixir-mcp-jobs"],
    doors: [
      {
        functionName: "elixir-mcp-web-api-web",
        revisions: [
          {
            revisionId: "live",
            revisionArn: arn("live"),
            state: "Active",
            createdAt: "2026-10-12",
          },
          {
            revisionId: "old",
            revisionArn: arn("old"),
            state: "Active",
            createdAt: "2026-10-12",
          },
        ],
        endpoints: [
          {
            endpointArn: "endpoint",
            revisionWeights: [{ revisionId: "live", weight: 100 }],
          },
        ],
      },
    ],
    objects: [
      object(key, "live-source"),
      object(key, "old-source"),
      object(eventKey, "current-event"),
      object(eventKey, "old-event"),
      object("code/mcp/3333333333333333.zip", "null"),
      object("deploys/production.json", "receipt"),
      object("payload/player.json", "canonical"),
      object("code/other/4444444444444444.zip", "unknown"),
    ],
  };
}
const clone = (i) => structuredClone(i);
function mock(i, { onInventory, onDeleteObjects } = {}) {
  const writes = [];
  let calls = 0;
  return {
    writes,
    inventory: async () => {
      onInventory?.(++calls, i);
      return clone(i);
    },
    clients: {
      web: {
        send: async (c) => {
          writes.push(c.input);
          i.doors[0].revisions = i.doors[0].revisions.filter(
            (r) => r.revisionId !== c.input.revisionId,
          );
          return {};
        },
      },
      s3: {
        send: async (c) => {
          writes.push(c.input);
          return onDeleteObjects?.(c) ?? { Deleted: c.input.Delete.Objects };
        },
      },
    },
  };
}
test("protect exact native source, every current Event source version, receipts and canonical/unknown keys", () => {
  const p = historyPlan(fixture(), { cutoff });
  assert.deepEqual(p.objects.map((o) => o.VersionId).sort(), [
    "null",
    "old-source",
  ]);
  assert.equal(p.revisions.length, 1);
  assert.equal(p.sourceBlocked, true);
});
test("any endpoint reference, including zero-weight, protects its revision and refuses ambiguous sources", () => {
  const i = fixture();
  i.doors[0].endpoints.push({
    endpointArn: "extra",
    revisionWeights: [{ revisionId: "old", weight: 0 }],
  });
  assert.throws(() => historyPlan(i, { cutoff }), /unmanaged revision/);
});
test("fresh uploads and pending revisions are never treated as old deployment history", () => {
  const i = fixture();
  i.objects.push({
    ...object("code/mcp/5555555555555555.zip", "fresh"),
    LastModified: cutoff,
  });
  i.doors[0].revisions[1].state = "Pending";
  const p = historyPlan(i, { cutoff });
  assert.equal(p.revisions.length, 0);
  assert(!p.objects.some((o) => o.VersionId === "fresh"));
});
test("apply removes eligible revisions first and uses exact version IDs for source deletion", async () => {
  const i = fixture(),
    p = historyPlan(i, { cutoff }),
    m = mock(i);
  const r = await applyHistoryPlan(m.clients, p, { inventory: m.inventory });
  assert.deepEqual(m.writes[0], {
    functionName: "elixir-mcp-web-api-web",
    revisionId: "old",
  });
  assert.equal(m.writes[1].Bucket, CODE_BUCKET);
  assert.deepEqual(
    m.writes[1].Delete.Objects,
    p.objects.map(({ Key, VersionId }) => ({ Key, VersionId })),
  );
  assert.equal(r.objects, 2);
  assert.equal(r.bytes, 20);
  assert.equal(i.doors[0].revisions.length, 1);
});
test("changed source pin refuses before any mutation", async () => {
  const i = fixture(),
    p = historyPlan(i, { cutoff });
  i.codeVersions["web-api"] = "changed";
  const m = mock(i);
  await assert.rejects(
    applyHistoryPlan(m.clients, p, { inventory: m.inventory }),
    /references changed/,
  );
  assert.equal(m.writes.length, 0);
});
test("forged manifest cannot delete a protected source or live revision", async () => {
  for (const kind of ["source", "revision"]) {
    const i = fixture(),
      p = historyPlan(i, { cutoff });
    p.revisions = [];
    i.doors[0].revisions = i.doors[0].revisions.slice(0, 1);
    if (kind === "source") p.objects = [object(key, "live-source")];
    else
      p.revisions = [
        { functionName: "elixir-mcp-web-api-web", revisionId: "live" },
      ];
    const m = mock(i);
    await assert.rejects(
      applyHistoryPlan(m.clients, p, { inventory: m.inventory }),
      /no longer eligible/,
    );
    assert.equal(m.writes.length, 0);
  }
});
test("new pending unmanaged revision aborts source deletion after orphan removal", async () => {
  const i = fixture(),
    p = historyPlan(i, { cutoff });
  const m = mock(i, {
    onInventory: (n) => {
      if (n === 2)
        i.doors[0].revisions.push({
          revisionId: "new",
          revisionArn: arn("new"),
          state: "Pending",
          createdAt: cutoff,
        });
    },
  });
  await assert.rejects(
    applyHistoryPlan(m.clients, p, { inventory: m.inventory }),
    /retaining every source/,
  );
  assert.equal(m.writes.length, 1);
});
test("partial S3 failures preserve a receipt and stop", async () => {
  const i = fixture(),
    p = historyPlan(i, { cutoff });
  let saved;
  const m = mock(i, {
    onDeleteObjects: (c) => ({
      Deleted: [c.input.Delete.Objects[0]],
      Errors: [{ Code: "AccessDenied" }],
    }),
  });
  await assert.rejects(
    applyHistoryPlan(m.clients, p, {
      inventory: m.inventory,
      save: async (r) => {
        saved = clone(r);
      },
    }),
    /incomplete/,
  );
  assert.equal(saved.objects, 1);
  assert(saved.error);
  assert(!saved.completedAt);
});
test("changed endpoint between source batches stops before the second deletion", async () => {
  const i = fixture();
  i.doors[0].revisions = i.doors[0].revisions.slice(0, 1);
  i.objects = Array.from({ length: 1001 }, (_, n) =>
    object("code/mcp/" + n.toString(16).padStart(16, "0") + ".zip", "v" + n),
  );
  const p = historyPlan(i, { cutoff });
  const m = mock(i, {
    onInventory: (n) => {
      if (n === 3)
        i.doors[0].endpoints[0].revisionWeights = [
          { revisionId: "other", weight: 100 },
        ];
    },
  });
  await assert.rejects(
    applyHistoryPlan(m.clients, p, { inventory: m.inventory }),
    /references changed/,
  );
  assert.equal(m.writes.length, 1);
});
test("reference identity ignores removed unserved revisions but detects source and endpoint changes", () => {
  const i = fixture(),
    hash = referenceFingerprint(i);
  i.doors[0].revisions.pop();
  assert.equal(referenceFingerprint(i), hash);
  i.codeKeys.jobs = "other";
  assert.notEqual(referenceFingerprint(i), hash);
});

test("receipt storage refusal happens before any deletion", async () => {
  const i = fixture(),
    p = historyPlan(i, { cutoff }),
    m = mock(i);
  await assert.rejects(
    applyHistoryPlan(m.clients, p, {
      inventory: m.inventory,
      save: async () => {
        throw new Error("receipt unavailable");
      },
    }),
    /receipt unavailable/,
  );
  assert.equal(m.writes.length, 0);
});

import { mkdtemp, mkdir, symlink, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireHistoryLock,
  historyOutputPath,
  writeHistoryJson,
} from "../../../infra/scripts/lib/deployment-history.mjs";
import {
  acquireLock,
  releaseLock,
  lockHolder,
} from "../../../infra/scripts/lib/production-lock.mjs";
test("cleanup respects an existing production lock and releases only its own lock", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "elixir-history-lock-")),
    file = path.join(dir, "lock");
  try {
    const held = acquireLock({
      file,
      holder: "deploy",
      purpose: "existing deploy",
    });
    assert(held.ok);
    assert.throws(
      () => acquireHistoryLock({ file, worktree: dir, head: "sha" }),
      /held/,
    );
    assert.equal(lockHolder({ file }).lock_id, held.lock.lock_id);
    releaseLock({ file, lockId: held.lock.lock_id });
    const release = acquireHistoryLock({ file, worktree: dir, head: "sha" });
    assert.equal(lockHolder({ file }).holder, "op:deployment-history");
    release();
    release();
    assert.equal(lockHolder({ file }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("history outputs reject normalized or symlinked paths into the repository", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "elixir-history-path-")),
    repo = path.join(dir, "repo");
  try {
    await mkdir(repo);
    await symlink(repo, path.join(dir, "alias"));
    await assert.rejects(
      historyOutputPath(
        path.join(dir, "other", "..", "repo", "plan.json"),
        repo,
      ),
      /outside/,
    );
    await assert.rejects(
      historyOutputPath(path.join(dir, "alias", "plan.json"), repo),
      /outside/,
    );
    const output = await historyOutputPath(path.join(dir, "plan.json"), repo);
    await writeHistoryJson(output, { phase: "before" });
    await writeHistoryJson(output, { phase: "after" });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
      phase: "after",
    });
    await symlink(output, path.join(dir, "linked.json"));
    await assert.rejects(
      historyOutputPath(path.join(dir, "linked.json"), repo),
      /symbolic/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { historyInventory } from "../../../infra/scripts/lib/deployment-history.mjs";
function inventoryClients({
  missingLive = false,
  duplicateManaged = false,
} = {}) {
  const names = {
    WebApi: "web-api",
    Mcp: "mcp",
    Collector: "collector",
    Scheduler: "scheduler",
    EmailRelay: "email-relay",
    Migrate: "migrate",
    Jobs: "jobs",
    TimelineSync: "timeline-sync",
  };
  const doors = ["web-api", "mcp", "collector"],
    events = ["scheduler", "email-relay", "migrate", "jobs", "timeline-sync"];
  const revision = (name) =>
    `arn:aws:lambda:us-east-1:999153317627:web-function/elixir-mcp-${name}-web/revision/live`;
  const parameters = [
    { ParameterKey: "CodeBucket", ParameterValue: CODE_BUCKET },
    ...Object.entries(names).map(([door, service]) => ({
      ParameterKey: door + "CodeKey",
      ParameterValue: `code/${service}/1111111111111111.zip`,
    })),
    ...["WebApi", "Mcp", "Collector"].map((door) => ({
      ParameterKey: door + "CodeVersion",
      ParameterValue: "source",
    })),
  ];
  const managed = doors.map((name) => ({
    ResourceType: "AWS::Lambda::WebFunctionRevision",
    PhysicalResourceId: revision(name),
  }));
  if (duplicateManaged) managed[2] = managed[0];
  return {
    cf: {
      send: async (c) =>
        c.constructor.name === "DescribeStacksCommand"
          ? {
              Stacks: [
                {
                  StackStatus: "UPDATE_COMPLETE",
                  StackId: "stack",
                  Parameters: parameters,
                },
              ],
            }
          : c.input.NextToken
            ? { StackResourceSummaries: managed.slice(2) }
            : { StackResourceSummaries: managed.slice(0, 2), NextToken: "cf2" },
    },
    lambda: {
      send: async (c) => {
        assert(!c.input.NextMarker);
        return c.input.Marker
          ? {
              Functions: events
                .slice(2)
                .map((n) => ({ FunctionName: "elixir-mcp-" + n })),
            }
          : {
              Functions: events
                .slice(0, 2)
                .map((n) => ({ FunctionName: "elixir-mcp-" + n })),
              NextMarker: "lambda2",
            };
      },
    },
    web: {
      send: async (c) => {
        if (c.constructor.name === "ListWebFunctionsCommand")
          return c.input.nextToken
            ? {
                functions: doors
                  .slice(2)
                  .map((n) => ({ functionName: "elixir-mcp-" + n + "-web" })),
              }
            : {
                functions: doors
                  .slice(0, 2)
                  .map((n) => ({ functionName: "elixir-mcp-" + n + "-web" })),
                nextToken: "web2",
              };
        const name = c.input.functionName.slice(
          "elixir-mcp-".length,
          -"-web".length,
        );
        if (c.constructor.name === "ListWebFunctionRevisionsCommand")
          return {
            revisions: [
              {
                revisionId: "live",
                revisionArn: revision(name),
                state: "Active",
                createdAt: "2026-10-12",
              },
            ],
          };
        return {
          endpoints: missingLive
            ? []
            : [
                {
                  endpointArn: `arn:aws:lambda:us-east-1:999153317627:web-function/${c.input.functionName}/endpoint/live`,
                  state: "Active",
                  autoDeploymentMode: "Disabled",
                  revisionWeights: [{ revisionId: "live", weight: 100 }],
                },
              ],
        };
      },
    },
    s3: {
      send: async (c) =>
        c.input.KeyMarker
          ? {
              Versions: [object("code/mcp/3333333333333333.zip", "second")],
              IsTruncated: false,
            }
          : {
              Versions: [object("code/mcp/2222222222222222.zip", "first")],
              IsTruncated: true,
              NextKeyMarker: "key2",
              NextVersionIdMarker: "v2",
            },
    },
  };
}
test("inventory follows all service pagination, including Lambda input Marker and S3 version markers", async () => {
  const i = await historyInventory(inventoryClients());
  assert.equal(i.doors.length, 3);
  assert.equal(i.eventFunctions.length, 5);
  assert.equal(i.objects.length, 2);
  assert.equal(i.managedRevisions.length, 3);
});
test("incomplete live endpoints or duplicate stack revision inventory fail closed", async () => {
  await assert.rejects(
    historyInventory(inventoryClients({ missingLive: true }), {
      objects: false,
    }),
    /Incomplete/,
  );
  await assert.rejects(
    historyInventory(inventoryClients({ duplicateManaged: true }), {
      objects: false,
    }),
    /Incomplete/,
  );
});

import { requireShippedCommit } from "../../../infra/scripts/lib/deployment-history.mjs";
test("cleanup requires its main commit to have shipped, with a valid production receipt", async () => {
  const s3 = (value) => ({
    send: async (c) => {
      assert.equal(c.input.Key, "deploys/production.json");
      return { Body: { transformToString: async () => value } };
    },
  });
  await assert.rejects(
    requireShippedCommit(s3(JSON.stringify({ sha: "previous" })), "current"),
    /Ship this main/,
  );
  await assert.rejects(
    requireShippedCommit(s3("invalid"), "current"),
    /Invalid production/,
  );
  await requireShippedCommit(s3(JSON.stringify({ sha: "current" })), "current");
});

test("retired editor and ingest deployment zips are eligible while unknown prefixes remain protected", () => {
  const i = fixture();
  i.objects.push(
    object("code/editor/6666666666666666.zip", "editor"),
    object("code/ingest/7777777777777777.zip", "ingest"),
  );
  const p = historyPlan(i, { cutoff });
  assert(p.objects.some((o) => o.VersionId === "editor"));
  assert(p.objects.some((o) => o.VersionId === "ingest"));
  assert(!p.objects.some((o) => o.VersionId === "unknown"));
});
