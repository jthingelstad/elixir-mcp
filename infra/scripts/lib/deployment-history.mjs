/** Reference-aware deployment history. Canonical archives and deploy receipts
 * are outside the only eligible prefix, code/<known service>/<hash>.zip. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { acquireLock, holdUntilExit } from "./production-lock.mjs";
import {
  DescribeStacksCommand,
  ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import {
  ListWebFunctionsCommand,
  ListWebFunctionEndpointsCommand,
  ListWebFunctionRevisionsCommand,
  DeleteWebFunctionRevisionCommand,
} from "@aws-sdk/client-lambda-web";
import {
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const DOORS = { WebApi: "web-api", Mcp: "mcp", Collector: "collector" };
const EVENTS = {
  Scheduler: "scheduler",
  EmailRelay: "email-relay",
  Migrate: "migrate",
  Jobs: "jobs",
  TimelineSync: "timeline-sync",
};
// Editor and ingest were retired in a2784939 and 779409ea. The complete
// function inventory refuses cleanup if either service ever reappears.
const SERVICES = [
  ...Object.values(DOORS),
  ...Object.values(EVENTS),
  "editor",
  "ingest",
];
export const CODE_BUCKET = "elixir-mcp-code-999153317627";
const STACK = "elixir-mcp";
const sorted = (values) =>
  [...values].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
const objectId = (o) => JSON.stringify([o.Key, o.VersionId]);
async function pages(
  client,
  Command,
  input,
  key,
  token = "nextToken",
  inputToken = token,
) {
  const all = [];
  let next;
  do {
    const page = await client.send(
      new Command({ ...input, ...(next ? { [inputToken]: next } : {}) }),
    );
    all.push(...(page[key] ?? []));
    next = page[token];
  } while (next);
  return all;
}

export async function historyInventory(clients, { objects = true } = {}) {
  const { cf, lambda, web, s3 } = clients;
  const [stackResponse, resources, functions, events] = await Promise.all([
    cf.send(new DescribeStacksCommand({ StackName: STACK })),
    pages(
      cf,
      ListStackResourcesCommand,
      { StackName: STACK },
      "StackResourceSummaries",
      "NextToken",
    ),
    pages(web, ListWebFunctionsCommand, {}, "functions"),
    pages(
      lambda,
      ListFunctionsCommand,
      {},
      "Functions",
      "NextMarker",
      "Marker",
    ),
  ]);
  const stack = stackResponse.Stacks?.[0];
  if (
    !stack ||
    !["UPDATE_COMPLETE", "CREATE_COMPLETE"].includes(stack.StackStatus)
  )
    throw new Error("Stack is not stable; refusing history cleanup");
  const params = Object.fromEntries(
    stack.Parameters.map((p) => [p.ParameterKey, p.ParameterValue]),
  );
  if (params.CodeBucket !== CODE_BUCKET)
    throw new Error("Unexpected code bucket");
  const codeKeys = {},
    codeVersions = {};
  for (const [door, service] of Object.entries({ ...DOORS, ...EVENTS })) {
    const key = params[door + "CodeKey"];
    if (!new RegExp(`^code/${service}/[a-f0-9]{16}\\.zip$`).test(key ?? ""))
      throw new Error("Missing or unexpected current source key: " + door);
    codeKeys[service] = key;
    if (DOORS[door]) {
      const version = params[door + "CodeVersion"];
      if (!version || version === "null")
        throw new Error("Missing immutable current source version: " + door);
      codeVersions[service] = version;
    }
  }
  const expectedWeb = sorted(
    Object.values(DOORS).map((s) => "elixir-mcp-" + s + "-web"),
  );
  const foundWeb = sorted(
    functions
      .filter((f) => f.functionName.startsWith("elixir-mcp"))
      .map((f) => f.functionName),
  );
  const expectedEvent = sorted(
    Object.values(EVENTS).map((s) => "elixir-mcp-" + s),
  );
  const foundEvent = sorted(
    events
      .filter((f) => f.FunctionName.startsWith("elixir-mcp"))
      .map((f) => f.FunctionName),
  );
  if (
    JSON.stringify(expectedWeb) !== JSON.stringify(foundWeb) ||
    JSON.stringify(expectedEvent) !== JSON.stringify(foundEvent)
  )
    throw new Error(
      "Unexpected Elixir function inventory; source ownership is ambiguous",
    );
  const doors = await Promise.all(
    expectedWeb.map(async (functionName) => {
      const [revisions, endpoints] = await Promise.all([
        pages(
          web,
          ListWebFunctionRevisionsCommand,
          { functionName },
          "revisions",
        ),
        pages(
          web,
          ListWebFunctionEndpointsCommand,
          { functionName },
          "endpoints",
        ),
      ]);
      if (
        endpoints.some(
          (e) =>
            e.state !== "Active" ||
            e.autoDeploymentMode !== "Disabled" ||
            e.updateStatus === "InProgress",
        )
      )
        throw new Error(
          "Endpoint is changing or automatically selects revisions",
        );
      return {
        functionName,
        revisions: revisions.map((r) => ({
          revisionId: r.revisionId,
          revisionArn: r.revisionArn,
          state: r.state,
          createdAt: r.createdAt,
        })),
        endpoints: endpoints.map((e) => ({
          endpointArn: e.endpointArn,
          revisionWeights: e.revisionWeights,
        })),
      };
    }),
  );
  const inventory = {
    stackId: stack.StackId,
    codeBucket: CODE_BUCKET,
    codeKeys,
    codeVersions,
    managedRevisions: sorted(
      resources
        .filter((r) => r.ResourceType === "AWS::Lambda::WebFunctionRevision")
        .map((r) => r.PhysicalResourceId),
    ),
    doors: sorted(doors),
    eventFunctions: foundEvent,
    objects: [],
  };
  const expectedManaged = expectedWeb.map((name) => {
    const matches = inventory.managedRevisions.filter((arn) =>
      arn.startsWith(
        `arn:aws:lambda:us-east-1:999153317627:web-function/${name}/revision/`,
      ),
    );
    const door = doors.find((d) => d.functionName === name);
    if (
      matches.length !== 1 ||
      !door.revisions.some((r) => r.revisionArn === matches[0]) ||
      !door.endpoints.some((e) => e.endpointArn.endsWith("/endpoint/live"))
    )
      throw new Error("Incomplete current revision or live endpoint inventory");
    return matches[0];
  });
  if (
    inventory.managedRevisions.length !== 3 ||
    new Set(expectedManaged).size !== 3
  )
    throw new Error("Unexpected stack revision inventory");
  if (objects) {
    let KeyMarker, VersionIdMarker, more;
    do {
      const page = await s3.send(
        new ListObjectVersionsCommand({
          Bucket: CODE_BUCKET,
          Prefix: "code/",
          KeyMarker,
          VersionIdMarker,
        }),
      );
      inventory.objects.push(...(page.Versions ?? []));
      more = page.IsTruncated;
      if (!more) break;
      KeyMarker = page.NextKeyMarker;
      VersionIdMarker = page.NextVersionIdMarker;
      if (!KeyMarker)
        throw new Error("Truncated source inventory has no continuation");
    } while (more);
  }
  return inventory;
}

export function referenceFingerprint(i) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        stackId: i.stackId,
        codeBucket: i.codeBucket,
        codeKeys: i.codeKeys,
        codeVersions: i.codeVersions,
        managedRevisions: sorted(i.managedRevisions),
        eventFunctions: sorted(i.eventFunctions),
        endpoints: sorted(
          i.doors.map((d) => ({
            functionName: d.functionName,
            endpoints: sorted(
              d.endpoints.map((e) => ({
                ...e,
                revisionWeights: sorted(e.revisionWeights),
              })),
            ),
          })),
        ),
      }),
    )
    .digest("hex");
}
export function historyPlan(i, { cutoff = new Date().toISOString() } = {}) {
  if (i.codeBucket !== CODE_BUCKET || !Number.isFinite(Date.parse(cutoff)))
    throw new Error("Invalid history inventory or cutoff");
  const managed = new Set(i.managedRevisions),
    protectedRevisions = new Set(i.managedRevisions),
    revisions = [];
  for (const d of i.doors)
    for (const e of d.endpoints)
      for (const r of e.revisionWeights)
        protectedRevisions.add(
          `arn:aws:lambda:us-east-1:999153317627:web-function/${d.functionName}/revision/${r.revisionId}`,
        );
  if ([...protectedRevisions].some((r) => !managed.has(r)))
    throw new Error(
      "Endpoint references an unmanaged revision; source references are ambiguous",
    );
  for (const d of i.doors)
    for (const r of d.revisions)
      if (
        !protectedRevisions.has(r.revisionArn) &&
        ["Active", "Failed"].includes(r.state) &&
        Date.parse(r.createdAt) < Date.parse(cutoff)
      )
        revisions.push({
          functionName: d.functionName,
          revisionId: r.revisionId,
        });
  // A revision outside the stack may point at any source version. Without
  // fetching its secret-bearing configuration, retain all objects until it
  // has been removed or its owner has reconciled it into the stack.
  const sourceBlocked =
    i.doors.some((d) => d.revisions.some((r) => !managed.has(r.revisionArn))) ||
    [...protectedRevisions].some((r) => !managed.has(r));
  const keep = (o) =>
    Object.entries(i.codeKeys).some(
      ([service, key]) =>
        key === o.Key &&
        (!i.codeVersions[service] || i.codeVersions[service] === o.VersionId),
    );
  const eligible = new RegExp(
    `^code/(${SERVICES.join("|")})/[a-f0-9]{16}\\.zip$`,
  );
  const objects = i.objects
    .filter(
      (o) =>
        eligible.test(o.Key) &&
        typeof o.VersionId === "string" &&
        Date.parse(o.LastModified) < Date.parse(cutoff) &&
        !keep(o),
    )
    .map((o) => ({
      Key: o.Key,
      VersionId: o.VersionId,
      Size: o.Size,
      LastModified: new Date(o.LastModified).toISOString(),
    }));
  return {
    version: 1,
    cutoff,
    codeBucket: CODE_BUCKET,
    fingerprint: referenceFingerprint(i),
    protectedRevisions: sorted(protectedRevisions),
    protectedSources: Object.entries(i.codeKeys).map(([service, Key]) => ({
      Key,
      VersionId: i.codeVersions[service] ?? "all versions",
    })),
    revisions: sorted(revisions),
    objects: sorted(objects),
    sourceBlocked,
    bytes: objects.reduce((sum, o) => sum + o.Size, 0),
  };
}

/** Only the frozen approved manifest may be removed. Fresh references are
 * checked before every mutation; the caller owns the shared production lock. */
export async function applyHistoryPlan(
  clients,
  plan,
  { inventory = historyInventory, save = async () => {} } = {},
) {
  if (plan.version !== 1 || plan.codeBucket !== CODE_BUCKET)
    throw new Error("Invalid approved history plan");
  const receipt = {
    startedAt: new Date().toISOString(),
    fingerprint: plan.fingerprint,
    revisions: [],
    objects: 0,
    bytes: 0,
  };
  const fresh = async (objects = false) => {
    const i = await inventory(clients, { objects });
    if (referenceFingerprint(i) !== plan.fingerprint)
      throw new Error("Live references changed; generate a fresh dry-run plan");
    return i;
  };
  await save(receipt);
  try {
    for (const r of plan.revisions) {
      const current = historyPlan(await fresh(), { cutoff: plan.cutoff });
      if (
        !current.revisions.some(
          (c) =>
            c.functionName === r.functionName && c.revisionId === r.revisionId,
        )
      )
        throw new Error("Revision is no longer eligible: " + r.revisionId);
      await clients.web.send(new DeleteWebFunctionRevisionCommand(r));
      receipt.revisions.push(r);
      await save(receipt);
    }
    const current = historyPlan(await fresh(true), { cutoff: plan.cutoff });
    if (current.sourceBlocked)
      throw new Error(
        "Unmanaged or endpoint-only revision remains; retaining every source object",
      );
    const candidates = new Map(current.objects.map((o) => [objectId(o), o]));
    const approved = plan.objects.map((o) => {
      const candidate = candidates.get(objectId(o));
      if (
        !candidate ||
        candidate.Size !== o.Size ||
        candidate.LastModified !== o.LastModified
      )
        throw new Error("Object is no longer eligible: " + o.Key);
      return candidate;
    });
    for (let start = 0; start < approved.length; start += 1000) {
      const refs = historyPlan(await fresh(), { cutoff: plan.cutoff });
      if (refs.sourceBlocked)
        throw new Error(
          "New unmanaged revision appeared; stopping source cleanup",
        );
      const batch = approved.slice(start, start + 1000);
      const deleted = await clients.s3.send(
        new DeleteObjectsCommand({
          Bucket: CODE_BUCKET,
          Delete: {
            Objects: batch.map(({ Key, VersionId }) => ({ Key, VersionId })),
            Quiet: false,
          },
        }),
      );
      const done = new Set((deleted.Deleted ?? []).map(objectId));
      receipt.objects += done.size;
      receipt.bytes += batch
        .filter((o) => done.has(objectId(o)))
        .reduce((sum, o) => sum + o.Size, 0);
      await save(receipt);
      if (deleted.Errors?.length || done.size !== batch.length)
        throw new Error(
          "Source deletion incomplete; inspect receipt and generate a fresh plan",
        );
    }
    await fresh();
    receipt.completedAt = new Date().toISOString();
    await save(receipt);
    return receipt;
  } catch (error) {
    receipt.error = error.message;
    await save(receipt);
    throw error;
  }
}

export function acquireHistoryLock({ file, worktree, head }) {
  const acquired = acquireLock({
    file,
    holder: "op:deployment-history",
    purpose:
      "Prune approved unused Web Function revisions and exact code object versions",
    worktree,
    head,
  });
  if (!acquired.ok) throw new Error(acquired.reason);
  return holdUntilExit({ file, lock: acquired.lock });
}

export async function historyOutputPath(file, root) {
  const normalized = path.resolve(file),
    parent = await realpath(path.dirname(normalized));
  const destination = path.join(parent, path.basename(normalized)),
    repo = await realpath(root);
  if (destination === repo || destination.startsWith(repo + path.sep))
    throw new Error(
      "Manifests and receipts stay outside the public repository",
    );
  try {
    if ((await lstat(destination)).isSymbolicLink())
      throw new Error("History output may not be a symbolic link");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return destination;
}
export async function writeHistoryJson(file, value) {
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function requireShippedCommit(s3, sha) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: CODE_BUCKET,
      Key: "deploys/production.json",
    }),
  );
  let receipt;
  try {
    receipt = JSON.parse(await response.Body.transformToString());
  } catch {
    throw new Error("Invalid production deploy receipt");
  }
  if (receipt.sha !== sha)
    throw new Error("Ship this main commit before pruning deployment history");
}
