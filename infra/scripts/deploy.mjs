#!/usr/bin/env node
/**
 * Deploy (run with AWS_PROFILE=cloud-engineer). Order: build -> upload ->
 * lane -> MIGRATE (the migrate bundle is pushed ahead of the flip, so a
 * failed migration stops the deploy before any code changes) -> vocabulary
 * import -> stack update -> web sync and invalidation -> smoke ->
 * acceptance when asked. On --create the stack comes first and migrations
 * run after it. When no Lambda bundle and not the template changed, the
 * SITE lane skips the migrate push, the migrations and the stack update
 * (lib/deploy-lane.mjs); --platform takes the whole path anyway.
 *
 *   node infra/scripts/deploy.mjs --create   # first deploy (GATED)
 *   node infra/scripts/deploy.mjs            # update
 *   node infra/scripts/deploy.mjs --skip-web # code/infra only
 *   node infra/scripts/deploy.mjs --help     # every flag; deploys nothing
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
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
  GetTemplateCommand,
  ValidateTemplateCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { buildAll } from "./build.mjs";
import { buildParameters, originRotation } from "./parameters.mjs";
import { DEPLOY_USAGE, parseDeployArgs } from "./lib/deploy-args.mjs";
import { ciGate } from "./lib/ci-gate.mjs";
import { prepareReferenceSeedRefresh } from "./lib/reference-seed-check.mjs";
import {
  readVocabulary,
  saveVocabularySnapshot,
} from "./lib/reference-vocabulary.mjs";
import { importReferenceSeed } from "./lib/reference-seed-import.mjs";
import { bundleFingerprint, chooseLane, codeKey } from "./lib/deploy-lane.mjs";
import {
  PRUNE_AFTER_DAYS,
  hashedAssets,
  publishSteps,
  pruneCandidates,
} from "./lib/site-publish.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every file under a directory, as paths relative to it. */
function walkFiles(root, base = root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}
const repoRoot = path.resolve(here, "../..");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const STACK = "elixir-mcp";
const GITHUB_REPO = "jthingelstad/elixir-mcp";
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
  { Key: "Repository", Value: GITHUB_REPO },
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
if (args.verifyReferenceSeed && isCreate) {
  console.error(
    "deploy: --verify-reference-seed requires an existing stack; nothing was deployed.",
  );
  process.exit(2);
}
if (
  args.rotateOriginSecret &&
  (isCreate ||
    args.params.OriginSecret !== undefined ||
    args.params.OriginSecretPrevious !== undefined)
) {
  console.error(
    "deploy: --rotate-origin-secret sets OriginSecret and OriginSecretPrevious itself, on an update only; nothing was deployed.",
  );
  process.exit(2);
}

// Deploy what is committed (DECISIONS "One worktree per run": deploy from a clean
// worktree). The build bundles the working tree as it is, so an edit that
// was never committed would ship with no trace in git. Untracked files
// (local progress files, caches) are not the build's and do not count.
const dirty = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  { cwd: repoRoot, encoding: "utf8" },
).trim();
if (dirty) {
  console.error(
    `deploy: the worktree has uncommitted changes; commit them first. Nothing was deployed.\n${dirty}`,
  );
  process.exit(2);
}

// Deploy only what main holds and CI passed (the PR workflow,
// 2026-09-26; lib/ci-gate.mjs). --break-glass is for GitHub being
// unreachable, never for a red check.
if (args.breakGlass) {
  console.warn(
    "deploy: WARNING --break-glass: the CI gate is skipped; record why in docs/NOTES.md.",
  );
} else {
  const gate = await ciGate({
    git: (a) =>
      execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim(),
    ghApi: async (p) =>
      JSON.parse(execFileSync("gh", ["api", p], { encoding: "utf8" })),
    repo: GITHUB_REPO,
    log: (line) => console.log(line),
  });
  if (!gate.ok) {
    console.error(`deploy: ${gate.reason}`);
    process.exit(2);
  }
  console.log(
    `deploy: CI gate passed for ${gate.sha.slice(0, 8)} (validate green on ${gate.via}).`,
  );
}

const sts = new STSClient({ region: REGION });
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand({}));
const codeBucket = `elixir-mcp-code-${accountId}`;
const cfn = new CloudFormationClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// 1. Build + upload ---------------------------------------------------------
console.error("building lambda bundles...");
const artifacts = await buildAll();
const codeKeys = {};
for (const { name, zipPath, dir } of artifacts) {
  // Named by content, not by the zip's bytes (zip stamps mtimes): the
  // same code keeps its key and the stack sees no change for it.
  const key = codeKey(name, bundleFingerprint(dir));
  await s3.send(
    new PutObjectCommand({
      Bucket: codeBucket,
      Key: key,
      Body: await readFile(zipPath),
    }),
  );
  codeKeys[name] = key;
  console.error(`uploaded ${key}`);
}
const required = {
  CodeBucket: codeBucket,
  WebApiCodeKey: codeKeys["web-api"],
  McpCodeKey: codeKeys.mcp,
  SchedulerCodeKey: codeKeys.scheduler,
  EmailRelayCodeKey: codeKeys["email-relay"],
  MigrateCodeKey: codeKeys.migrate,
  JobsCodeKey: codeKeys.jobs,
  CollectorCodeKey: codeKeys.collector,
};
const templateBody = await readFile(
  path.join(repoRoot, "infra/template.yaml"),
  "utf8",
);

// 2. Lane (lib/deploy-lane.mjs) -----------------------------------------------
// The live stack's code keys and template against this build's. A deploy
// that changes neither ships the site alone: nothing to migrate, nothing
// for CloudFormation to do.
let lane = "platform";
if (!isCreate) {
  const { Stacks: live } = await cfn.send(
    new DescribeStacksCommand({ StackName: STACK }),
  );
  const { TemplateBody: liveTemplate } = await cfn.send(
    new GetTemplateCommand({ StackName: STACK, TemplateStage: "Original" }),
  );
  const choice = chooseLane({
    codeKeys: required,
    liveParameters: live[0].Parameters,
    template: templateBody,
    liveTemplate,
    platform: args.platform,
    parameterChange:
      Object.keys(args.params).length > 0 || args.rotateOriginSecret,
  });
  lane = choice.lane;
  console.error(
    lane === "site"
      ? "lane: site - no Lambda bundle and not the template changed; no migrations, no stack update."
      : `lane: platform - changed: ${choice.changed.join(", ")}.`,
  );
}

// 3. Migrate BEFORE the flip (sol-6 F2) -------------------------------------
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
if (!isCreate && lane === "platform") {
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
}
const verifiedReferenceSeed = args.verifyReferenceSeed
  ? await prepareReferenceSeedRefresh(lambda)
  : null;
if (!isCreate && lane === "platform") await runMigrations("elixir-mcp-migrate");
if (!isCreate) {
  // The archetype vocabulary rides every deploy, site lane included
  // (0147): the Lambdas have no internet, so this checkout's sibling
  // cr-agent-api-docs is the source, and its commit is the version.
  console.error(
    "importing the archetype vocabulary from ../cr-agent-api-docs...",
  );
  const vocabulary = verifiedReferenceSeed?.vocabulary ?? readVocabulary();
  saveVocabularySnapshot(vocabulary);
  if (verifiedReferenceSeed) await verifiedReferenceSeed.refresh();
  else await importReferenceSeed(lambda, vocabulary);
}

// 4. Stack (the platform lane) ----------------------------------------------
if (lane === "platform") {
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
  const paramOverrides = { ...args.params };

  // --rotate-origin-secret (docs/SECRETS.md): the current value is read
  // from the deployed web door, since the stack masks NoEcho parameters,
  // and held in this process only. The template makes CloudFront wait for
  // every door, so they accept the new value before any edge sends it.
  if (args.rotateOriginSecret) {
    const { Environment } = await lambda.send(
      new GetFunctionConfigurationCommand({
        FunctionName: "elixir-mcp-web-api",
      }),
    );
    const vars = Environment?.Variables ?? {};
    if (vars.ORIGIN_SECRET_PREVIOUS) {
      console.error(
        "deploy: the last origin rotation has not been cleared; deploy with --param=OriginSecretPrevious= first. The code is uploaded and migrated; the stack is unchanged.",
      );
      process.exit(2);
    }
    Object.assign(paramOverrides, originRotation(vars.ORIGIN_SECRET));
    console.error("rotating the origin secret (values not shown)...");
  }

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
    const existingKeys = (current[0].Parameters ?? []).map(
      (p) => p.ParameterKey,
    );
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
      if (
        String(err.message ?? "").includes("No updates are to be performed")
      ) {
        console.error("stack unchanged");
      } else {
        throw err;
      }
    }
  }
}

const { Stacks } = await cfn.send(
  new DescribeStacksCommand({ StackName: STACK }),
);
const outputs = Object.fromEntries(
  Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);

// 5. First-create migrations (the update path migrated pre-flip) -----------
if (isCreate) {
  await runMigrations(outputs.MigrateFunctionName);
}

// 6. Web --------------------------------------------------------------------
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
  // Assets first and never deleted, then the documents, each with its
  // Cache-Control; the old build's chunks are pruned below, after the
  // invalidation, once nothing can ask for them (#73; site-publish.mjs).
  const siteDir = path.join(repoRoot, "dist/site");
  const shipped = walkFiles(siteDir);
  const hashed = hashedAssets(
    shipped,
    readdirSync(path.join(repoRoot, "apps/web/dist/assets")),
  );
  for (const step of publishSteps({
    dir: siteDir,
    bucket: outputs.SiteBucketName,
    hashed,
  })) {
    execFileSync("aws", step, { stdio: "inherit" });
  }
  // Every web deploy still flushes the edge: objects published before
  // #73 carry no Cache-Control and sit at the edge for the policy's day,
  // and the site's own ?v= assets share one cache key per name.
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
  // Prune: an asset this build no longer ships, and no deploy has
  // shipped for PRUNE_AFTER_DAYS, can no longer be asked for by a page
  // that is still open.
  const current = new Set(shipped.filter((rel) => rel.startsWith("assets/")));
  const objects = [];
  let ContinuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: outputs.SiteBucketName,
        Prefix: "assets/",
        ContinuationToken,
      }),
    );
    objects.push(...(page.Contents ?? []));
    ContinuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (ContinuationToken);
  const prune = pruneCandidates({
    objects,
    current,
    now: Date.now(),
    days: PRUNE_AFTER_DAYS,
  });
  for (let i = 0; i < prune.length; i += 1000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: outputs.SiteBucketName,
        Delete: {
          Objects: prune.slice(i, i + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
  console.error(
    `pruned ${prune.length} asset(s) unshipped for ${PRUNE_AFTER_DAYS}+ days`,
  );
}

// Smoke gate: a deploy is not done until the
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
    "WARNING: acceptance NOT run. Pass --acceptance=<family> when a tool in that family changed, --acceptance for shared code or a release (or ACCEPTANCE=1); npm run acceptance any time.",
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
