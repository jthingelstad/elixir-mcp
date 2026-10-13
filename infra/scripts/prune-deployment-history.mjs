#!/usr/bin/env node
/** Dry run by default. Apply an exact saved manifest after shipping the code.
 * No secret-bearing Web Function revision configuration is read. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { LambdaWebClient } from "@aws-sdk/client-lambda-web";
import { S3Client } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { ciGate } from "./lib/ci-gate.mjs";
import {
  lockFileFor,
  lockHolder,
  describeHolder,
} from "./lib/production-lock.mjs";
import {
  historyInventory,
  historyPlan,
  applyHistoryPlan,
  acquireHistoryLock,
  historyOutputPath,
  writeHistoryJson,
  requireShippedCommit,
} from "./lib/deployment-history.mjs";
const usage =
  "Usage: AWS_PROFILE=cloud-engineer node infra/scripts/prune-deployment-history.mjs --plan=/absolute/path.json [--apply] [--receipt=/absolute/path.json]";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
if (
  args.some(
    (a) =>
      a !== "--apply" &&
      !a.startsWith("--plan=") &&
      !a.startsWith("--receipt="),
  )
)
  throw new Error(usage);
const option = (k) =>
  args.find((a) => a.startsWith(k + "="))?.slice(k.length + 1);
let planPath = option("--plan"),
  receiptPath = option("--receipt");
if (
  !planPath ||
  !path.isAbsolute(planPath) ||
  (receiptPath && !path.isAbsolute(receiptPath))
)
  throw new Error(usage);
if (args.includes("--apply") && (!receiptPath || planPath === receiptPath))
  throw new Error("Apply needs a separate receipt path");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
planPath = await historyOutputPath(planPath, root);
if (receiptPath) receiptPath = await historyOutputPath(receiptPath, root);
if (planPath === receiptPath)
  throw new Error("Plan and receipt must be different destinations");
const config = { region: "us-east-1", maxAttempts: 1 };
const sts = new STSClient(config);
const who = await sts.send(new GetCallerIdentityCommand({}));
if (
  who.Account !== "999153317627" ||
  !who.Arn.includes(
    "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
  )
)
  throw new Error("Use cloud-engineer");
const clients = {
  cf: new CloudFormationClient(config),
  lambda: new LambdaClient(config),
  web: new LambdaWebClient(config),
  s3: new S3Client(config),
};
const file = lockFileFor(root);
const git = (a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
let release;
try {
  if (args.includes("--apply")) {
    if (!receiptPath)
      throw new Error("Apply requires --receipt=/absolute/path.json");
    if (git(["status", "--porcelain"]))
      throw new Error("Apply requires a clean checkout");
    const gate = await ciGate({
      git,
      ghApi: (p) =>
        JSON.parse(
          execFileSync("gh", ["api", p], { cwd: root, encoding: "utf8" }),
        ),
      repo: "jthingelstad/elixir-mcp",
      log: console.error,
    });
    if (!gate.ok) throw new Error(gate.reason);
    release = acquireHistoryLock({ file, worktree: root, head: gate.sha });
    await requireShippedCommit(clients.s3, gate.sha);
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const receipt = await applyHistoryPlan(clients, plan, {
      save: (r) => writeHistoryJson(receiptPath, { ...r, commit: gate.sha }),
    });
    console.log(JSON.stringify({ ...receipt, commit: gate.sha }, null, 2));
  } else {
    const holder = lockHolder({ file });
    if (holder)
      throw new Error("Production is locked: " + describeHolder(holder));
    const plan = historyPlan(await historyInventory(clients));
    await writeHistoryJson(planPath, plan);
    console.log(
      JSON.stringify(
        {
          plan: planPath,
          revisions: plan.revisions.length,
          objects: plan.objects.length,
          bytes: plan.bytes,
          protectedRevisions: plan.protectedRevisions,
          protectedSources: plan.protectedSources,
          sourceDeletion:
            "Sources are deleted only after all non-stack revisions are removed and fresh references match.",
        },
        null,
        2,
      ),
    );
  }
} finally {
  release?.();
  for (const client of [sts, ...Object.values(clients)]) client.destroy();
}
