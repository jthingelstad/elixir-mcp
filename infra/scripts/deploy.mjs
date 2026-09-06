#!/usr/bin/env node
/**
 * Deploy (run with AWS_PROFILE=jamie). Order is the design (§11.1):
 * build -> upload -> stack create/update -> MIGRATE -> web sync -> outputs.
 *
 *   node infra/scripts/deploy.mjs --create   # first deploy (GATED)
 *   node infra/scripts/deploy.mjs            # update
 *   node infra/scripts/deploy.mjs --skip-web # code/infra only
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
  ListDistributionsCommand,
} from "@aws-sdk/client-cloudfront";
import {
  CloudFormationClient,
  CreateStackCommand,
  UpdateStackCommand,
  DescribeStacksCommand,
  ValidateTemplateCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  LambdaClient,
  InvokeCommand,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { buildAll } from "./build.mjs";
import { buildParameters } from "./parameters.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const STACK = "elixir-mcp";

const args = process.argv.slice(2);
const isCreate = args.includes("--create");
const skipWeb = args.includes("--skip-web");

const sts = new STSClient({ region: REGION });
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand({}));
const codeBucket = `elixir-mcp-code-${accountId}`;
const cfn = new CloudFormationClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// 1. Build + upload ---------------------------------------------------------
console.error("building lambda bundles...");
const artifacts = await buildAll();
const codeKeys = {};
for (const { name, zipPath } of artifacts) {
  const body = await readFile(zipPath);
  const sha = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const key = `code/${name}/${sha}.zip`;
  await s3.send(
    new PutObjectCommand({ Bucket: codeBucket, Key: key, Body: body }),
  );
  codeKeys[name] = key;
  console.error(`uploaded ${key}`);
}

// 2. Migrate BEFORE the flip (sol-6 F2) -------------------------------------
// Migrations are expand-and-contract by policy: applying them first
// means the currently-serving code (which tolerates the expanded
// schema by construction) never races a schema it predates, and a
// failed migration stops the deploy before any application code flips.
// On --create the stack doesn't exist yet; migrations run after create.
const lambda = new LambdaClient({ region: REGION });
async function runMigrations(functionName) {
  console.error("running migrations via the migrate lambda...");
  const invoked = await lambda.send(
    new InvokeCommand({ FunctionName: functionName, Payload: "{}" }),
  );
  const migrateResult = JSON.parse(
    Buffer.from(invoked.Payload).toString() || "null",
  );
  if (invoked.FunctionError) {
    console.error(`MIGRATE FAILED: ${JSON.stringify(migrateResult)}`);
    process.exit(1);
  }
  console.error(`migrations: ${JSON.stringify(migrateResult)}`);
}
if (!isCreate) {
  console.error("pushing migrate bundle ahead of the stack flip...");
  await lambda.send(
    new UpdateFunctionCodeCommand({
      FunctionName: "elixir-mcp-migrate",
      S3Bucket: codeBucket,
      S3Key: codeKeys.migrate,
    }),
  );
  await waitUntilFunctionUpdatedV2(
    { client: lambda, maxWaitTime: 120 },
    { FunctionName: "elixir-mcp-migrate" },
  );
  await runMigrations("elixir-mcp-migrate");
}

// 3. Stack ------------------------------------------------------------------
const templateBody = await readFile(
  path.join(repoRoot, "infra/template.yaml"),
  "utf8",
);
await cfn.send(new ValidateTemplateCommand({ TemplateBody: templateBody }));

const required = {
  CodeBucket: codeBucket,
  WebApiCodeKey: codeKeys["web-api"],
  McpCodeKey: codeKeys.mcp,
  SchedulerCodeKey: codeKeys.scheduler,
  IngestCodeKey: codeKeys.ingest,
  EmailRelayCodeKey: codeKeys["email-relay"],
  MigrateCodeKey: codeKeys.migrate,
  JobsCodeKey: codeKeys.jobs,
};

if (isCreate) {
  console.error("creating stack (this starts billing: RDS ~$15/mo)...");
  await cfn.send(
    new CreateStackCommand({
      StackName: STACK,
      TemplateBody: templateBody,
      Parameters: buildParameters(required, {}),
      Capabilities: ["CAPABILITY_NAMED_IAM"],
    }),
  );
  await waitUntilStackCreateComplete(
    { client: cfn, maxWaitTime: 2400 },
    { StackName: STACK },
  );
} else {
  console.error("updating stack...");
  try {
    await cfn.send(
      new UpdateStackCommand({
        StackName: STACK,
        TemplateBody: templateBody,
        Parameters: buildParameters(required),
        Capabilities: ["CAPABILITY_NAMED_IAM"],
      }),
    );
    await waitUntilStackUpdateComplete(
      { client: cfn, maxWaitTime: 2400 },
      { StackName: STACK },
    );
  } catch (err) {
    if (String(err.message ?? "").includes("No updates are to be performed")) {
      console.error("stack unchanged");
    } else {
      throw err;
    }
  }
}

const { Stacks } = await cfn.send(
  new DescribeStacksCommand({ StackName: STACK }),
);
const outputs = Object.fromEntries(
  Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);

// 4. First-create migrations (the update path migrated pre-flip) -----------
if (isCreate) {
  await runMigrations(outputs.MigrateFunctionName);
}

// 4. Web --------------------------------------------------------------------
if (!skipWeb) {
  console.error("building + syncing the site...");
  execFileSync("npm", ["run", "build", "-w", "@elixir-mcp/web"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  // Crawlability bake (SITE-IA 2026-09-05): Home and Data must be
  // readable without JS, so live corpus stats and the site's text get
  // baked into index.html; the app removes the block after mount.
  // First-deploy chicken-and-egg: if the stats endpoint isn't live yet,
  // the bake is skipped, not fatal.
  try {
    const res = await fetch("https://elixir.poapkings.com/api/public/stats");
    if (res.ok) {
      const stats = await res.json();
      const t = stats.totals;
      const { readFileSync, writeFileSync } = await import("node:fs");
      const idx = path.join(repoRoot, "apps/web/dist/index.html");
      const html = readFileSync(idx, "utf8").replace(
        "<!--BAKE-->",
        `<h1>Elixir MCP - Clash Royale history, recorded</h1>` +
          `<p>The official Clash Royale API only knows the present. Elixir MCP records battles, progression, and clan life as they happen, and serves the history to your own AI agent over MCP.</p>` +
          `<p>${t.battles.toLocaleString()} battles recorded across ${t.players.toLocaleString()} players and ${t.clans.toLocaleString()} clans by ${t.collectors_active} collectors, from ${String(t.oldest_battle).slice(0, 10)} to ${String(t.newest_battle).slice(0, 10)}.</p>` +
          `<nav><a href="/data/dashboard">Data dashboard</a> <a href="/data/changelog">Contract changelog</a> <a href="/docs/about">About</a> <a href="/docs/roles">Roles</a> <a href="/docs/tools">Tools</a> <a href="/docs/privacy">Privacy</a> <a href="/docs/terms">Terms</a></nav>` +
          `<p>This material is unofficial and is not endorsed by Supercell.</p>`,
      );
      writeFileSync(idx, html);
      console.error("baked crawlable stats into index.html");
    } else {
      console.error(`bake skipped: stats endpoint ${res.status}`);
    }
  } catch (err) {
    console.error(`bake skipped: ${err.message}`);
  }
  execFileSync(
    "aws",
    [
      "s3",
      "sync",
      path.join(repoRoot, "apps/web/dist"),
      `s3://${outputs.SiteBucketName}`,
      "--delete",
    ],
    { stdio: "inherit" },
  );
  // A synced site with a cached index.html pointing at deleted hashed
  // assets is a silent blank page; every web deploy flushes the edge.
  const cloudfront = new CloudFrontClient({ region: REGION });
  const { DistributionList } = await cloudfront.send(
    new ListDistributionsCommand({}),
  );
  const dist = DistributionList.Items.find(
    (d) => d.Comment === "elixir.poapkings.com",
  );
  if (dist) {
    await cloudfront.send(
      new CreateInvalidationCommand({
        DistributionId: dist.Id,
        InvalidationBatch: {
          CallerReference: String(Date.now()),
          Paths: { Quantity: 1, Items: ["/*"] },
        },
      }),
    );
    console.error(`invalidated ${dist.Id}`);
  }
}

// Smoke gate (review 2026-09-05): a deploy is not done until the
// read-only checks pass against the live doors.
const { spawnSync } = await import("node:child_process");
const smoke = spawnSync(
  process.execPath,
  [new URL("./smoke.mjs", import.meta.url).pathname],
  { stdio: "inherit" },
);
if (smoke.status !== 0) {
  console.error("SMOKE FAILED - the stack deployed but the doors misbehave.");
  process.exit(1);
}

console.log("\ndeploy complete.");
console.log(
  `site + mcp door: https://${outputs.SiteDistributionDomain}  (CNAME elixir.poapkings.com here)`,
);
console.log(`connect URL: https://elixir.poapkings.com/mcp`);
console.log(`alarm topic: ${outputs.AlarmTopicArn}`);
