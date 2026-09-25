#!/usr/bin/env node
/**
 * Deploy (run with AWS_PROFILE=cloud-engineer). Order is the design (§11.1):
 * build -> upload -> stack create/update -> MIGRATE -> web sync -> outputs.
 *
 *   node infra/scripts/deploy.mjs --create   # first deploy (GATED)
 *   node infra/scripts/deploy.mjs            # update
 *   node infra/scripts/deploy.mjs --skip-web # code/infra only
 *   node infra/scripts/deploy.mjs --help     # every flag; deploys nothing
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
import { DEPLOY_USAGE, parseDeployArgs } from "./lib/deploy-args.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const STACK = "elixir-mcp";
// The stack's tags, propagated by CloudFormation to every taggable
// resource (2026-09-17). awsApplication puts them into the myApplications
// application "Elixir" (created by Jamie in the console; the id is the
// application's, not a secret). Application and Project are the account's
// cost allocation tags (projects-sysadmin docs/AWS-TAGS.md, 2026-09-24):
// the family, then the project inside it. UpdateStack keeps existing tags
// when Tags is omitted, so this is not the parameter trap.
const ELIXIR_APPLICATION_ID = "06wp90h48v7ugspg5pol25cmp3";
const stackTags = (accountId) => [
  {
    Key: "awsApplication",
    Value: `arn:aws:resource-groups:${REGION}:${accountId}:group/Elixir/${ELIXIR_APPLICATION_ID}`,
  },
  { Key: "Application", Value: "Elixir" },
  { Key: "Project", Value: "elixir-mcp" },
  { Key: "Environment", Value: "production" },
  { Key: "ManagedBy", Value: "cloudformation" },
  { Key: "Repository", Value: "jthingelstad/elixir-mcp" },
];

// Refuse anything but a known flag before the first AWS call: an unknown
// one used to be ignored, so `--help` deployed production (2026-09-25).
const args = parseDeployArgs(process.argv.slice(2));
if (args.help) {
  console.log(DEPLOY_USAGE);
  process.exit(0);
}
if (args.unknown.length > 0) {
  console.error(
    `deploy: unknown argument ${args.unknown.join(" ")}; nothing was deployed.\n\n${DEPLOY_USAGE}`,
  );
  process.exit(2);
}
const isCreate = args.create;
const skipWeb = args.skipWeb;

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
  // The archetype vocabulary rides every deploy (0147): the Lambdas have
  // no internet, so this checkout's sibling cr-agent-api-docs is the
  // source, and its commit is the version.
  console.error(
    "importing the archetype vocabulary from ../cr-agent-api-docs...",
  );
  await import("./import-card-roles.mjs");
}

// 3. Stack ------------------------------------------------------------------
const templateBody = await readFile(
  path.join(repoRoot, "infra/template.yaml"),
  "utf8",
);
// Inline TemplateBody caps at 51,200 bytes and the template passed it on
// 2026-09-09; by URL the cap is 1 MB. The object rides the code bucket
// under its content hash, like the bundles.
const templateKey = `templates/${createHash("sha256").update(templateBody).digest("hex").slice(0, 16)}.yaml`;
await s3.send(
  new PutObjectCommand({
    Bucket: codeBucket,
    Key: templateKey,
    Body: templateBody,
    ContentType: "application/x-yaml",
  }),
);
const templateUrl = `https://${codeBucket}.s3.${REGION}.amazonaws.com/${templateKey}`;
await cfn.send(new ValidateTemplateCommand({ TemplateURL: templateUrl }));

// --param=Key=Value: one-time explicit values for PRESERVED parameters
// (a parameter's first deploy cannot UsePreviousValue).
const paramOverrides = args.params;

const required = {
  CodeBucket: codeBucket,
  WebApiCodeKey: codeKeys["web-api"],
  McpCodeKey: codeKeys.mcp,
  SchedulerCodeKey: codeKeys.scheduler,
  EmailRelayCodeKey: codeKeys["email-relay"],
  MigrateCodeKey: codeKeys.migrate,
  JobsCodeKey: codeKeys.jobs,
  EditorCodeKey: codeKeys.editor,
};

if (isCreate) {
  console.error("creating stack (this starts billing: RDS ~$15/mo)...");
  await cfn.send(
    new CreateStackCommand({
      StackName: STACK,
      TemplateURL: templateUrl,
      Parameters: buildParameters(required, {}),
      Capabilities: ["CAPABILITY_NAMED_IAM"],
      Tags: stackTags(accountId),
    }),
  );
  await waitUntilStackCreateComplete(
    { client: cfn, maxWaitTime: 2400 },
    { StackName: STACK },
  );
} else {
  console.error("updating stack...");
  // Which parameters the live stack already carries: a SECRET parameter
  // absent here is on its first deploy and gets minted, never reset.
  const { Stacks: current } = await cfn.send(
    new DescribeStacksCommand({ StackName: STACK }),
  );
  const existingKeys = (current[0].Parameters ?? []).map((p) => p.ParameterKey);
  try {
    await cfn.send(
      new UpdateStackCommand({
        StackName: STACK,
        TemplateURL: templateUrl,
        Parameters: buildParameters(
          required,
          null,
          paramOverrides,
          existingKeys,
        ),
        Capabilities: ["CAPABILITY_NAMED_IAM"],
        Tags: stackTags(accountId),
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
  console.error("building the site (app + static)...");
  // Two builds merged into one tree, validated before anything is
  // uploaded: dead sitemap entries, dangling llms.txt links, a missing
  // app shell or a missing asset fail here instead of on the live site.
  // This replaces the old deploy-time bake, which patched live stats
  // into the single shared shell; the static build now reads the same
  // endpoint at build time and writes real pages.
  execFileSync("node", [path.join(repoRoot, "infra/scripts/build-site.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  execFileSync(
    "aws",
    [
      "s3",
      "sync",
      path.join(repoRoot, "dist/site"),
      `s3://${outputs.SiteBucketName}`,
      "--delete",
    ],
    { stdio: "inherit" },
  );
  // `s3 sync` types an object by extension and never names a charset,
  // and a `text/plain` with no charset is read as Latin-1 by browsers
  // and most agents: llms.txt showed "adding â€¦" for a UTF-8 ellipsis.
  // HTML carries <meta charset>, JSON and XML are UTF-8 by their specs;
  // the .txt surfaces are the ones that need it said in the header.
  execFileSync(
    "aws",
    [
      "s3",
      "cp",
      `s3://${outputs.SiteBucketName}`,
      `s3://${outputs.SiteBucketName}`,
      "--recursive",
      "--exclude",
      "*",
      "--include",
      "*.txt",
      "--content-type",
      "text/plain; charset=utf-8",
      "--metadata-directive",
      "REPLACE",
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

// Acceptance gate (2026-09-21): the deployed product against the real
// record, read-only, as a read-only agent principal - invariants the
// fixture tests cannot see (live data shape, live scale). Opt-in per
// deploy (Jamie, 2026-09-21: ~4.5 minutes and a pass of heavy reads on
// the shared micro, so it is turned on when wanted, not on every
// deploy): `--acceptance` on the command line or ACCEPTANCE=1 in the
// environment. Without it the deploy says so in one line. A red case
// fails the deploy; a missing token file warns.
const { existsSync } = await import("node:fs");
const acceptanceEnv = new URL("../../acceptance/.env", import.meta.url)
  .pathname;
// --acceptance=<family> runs only that family's cases (2026-09-23: a
// full pass on every deploy of a sweep drained the database's EBS byte
// balance). Plain --acceptance is the whole suite, for releases that
// touch shared code.
const acceptanceFamily = args.acceptanceFamily;
const wantAcceptance = args.acceptance || process.env.ACCEPTANCE === "1";
if (!wantAcceptance) {
  console.log(
    "acceptance: not run (opt in with --acceptance or ACCEPTANCE=1; npm run acceptance any time).",
  );
} else if (existsSync(acceptanceEnv)) {
  const acceptance = spawnSync(
    process.execPath,
    [
      new URL("../../acceptance/run.mjs", import.meta.url).pathname,
      ...(acceptanceFamily ? ["--family", acceptanceFamily] : []),
    ],
    { stdio: "inherit" },
  );
  if (acceptance.status !== 0) {
    console.error(
      "ACCEPTANCE FAILED - the deploy is live but an invariant broke; fix forward or roll back.",
    );
    process.exit(1);
  }
} else {
  console.warn(
    "acceptance: skipped - no acceptance/.env on this machine (see acceptance/README.md).",
  );
}

console.log("\ndeploy complete.");
console.log(
  `site + mcp door: https://${outputs.SiteDistributionDomain}  (CNAME elixir.poapkings.com here)`,
);
console.log(`connect URL: https://elixir.poapkings.com/mcp`);
console.log(`alarm topic: ${outputs.AlarmTopicArn}`);
