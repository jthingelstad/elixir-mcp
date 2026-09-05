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
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
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

// 2. Stack ------------------------------------------------------------------
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

// 3. Migrate (code deployed above; schema follows; nothing serves stale) ----
console.error("running migrations via the migrate lambda...");
const lambda = new LambdaClient({ region: REGION });
const invoked = await lambda.send(
  new InvokeCommand({
    FunctionName: outputs.MigrateFunctionName,
    Payload: "{}",
  }),
);
const migrateResult = JSON.parse(
  Buffer.from(invoked.Payload).toString() || "null",
);
if (invoked.FunctionError) {
  console.error(`MIGRATE FAILED: ${JSON.stringify(migrateResult)}`);
  process.exit(1);
}
console.error(`migrations: ${JSON.stringify(migrateResult)}`);

// 4. Web --------------------------------------------------------------------
if (!skipWeb) {
  console.error("building + syncing the site...");
  execFileSync("npm", ["run", "build", "-w", "@elixir-mcp/web"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
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
