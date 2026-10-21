#!/usr/bin/env node
/**
 * Deploy (run with AWS_PROFILE=cloud-engineer). The deploy is
 * DEPLOY_PHASES below, run in order: the worktree and CI gate checks,
 * the production lock (lib/production-lock.mjs, taken after the gate and
 * held to the end), the account, build -> upload -> the app's immutable
 * assets -> lane -> the endpoint grant check -> MIGRATE (the migrate
 * bundle is pushed ahead of the flip, so a failed migration stops the
 * deploy before any code changes) -> vocabulary import -> stack update
 * -> the endpoint grant -> site publish, invalidation and prune ->
 * smoke -> acceptance when asked -> the deploy record and its PR
 * comments. Each phase says when it runs: on --create the stack comes
 * first and migrations run after it; when no Lambda bundle and not the
 * template changed, the SITE lane skips the migrate push, the
 * migrations and the stack update (lib/deploy-lane.mjs); --platform
 * takes the whole path anyway. The tests read the list itself
 * (services/mcp/test/infra-controls.test.mjs), and the deploy record
 * carries each phase's seconds.
 *
 *   node infra/scripts/deploy.mjs --create   # first deploy (GATED)
 *   node infra/scripts/deploy.mjs            # update
 *   node infra/scripts/deploy.mjs --skip-web # code/infra only
 *   node infra/scripts/deploy.mjs --help     # every flag; deploys nothing
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GetWebFunctionRevisionCommand,
  LambdaWebClient,
} from "@aws-sdk/client-lambda-web";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
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
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  LambdaClient,
  InvokeCommand,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { versionsIn } from "../../packages/contracts/scripts/changes-index.mjs";
import { buildAll } from "./build.mjs";
import {
  buildParameters,
  originRotation,
  webBuildParameters,
} from "./parameters.mjs";
import {
  DEPLOY_USAGE,
  argumentRefusal,
  parseDeployArgs,
} from "./lib/deploy-args.mjs";
import { ciGate } from "./lib/ci-gate.mjs";
import {
  acquireLock,
  holdUntilExit,
  lockFileFor,
} from "./lib/production-lock.mjs";
import {
  DEPLOY_RECORD_KEY,
  commentBody,
  commentOnPulls,
  deployHistoryKey,
  deployTiming,
  liveVersions,
  shippedCommits,
  shippedPulls,
  toSeconds,
} from "./lib/deploy-record.mjs";
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
  listObjects,
  md5,
  publish,
  publishPlan,
  pruneCandidates,
  readPublished,
  referencedAssets,
  siteAssetsKey,
  writeAssetManifest,
  writePublished,
} from "./lib/site-publish.mjs";
import {
  checkWebEndpointGrants,
  grantWebEndpoints,
} from "./lib/web-release.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
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

/** Every file under a directory with its MD5, keyed as `prefix + path`. */
async function hashTree(root, prefix = "") {
  const out = [];
  for (const rel of walkFiles(root))
    out.push({
      rel: `${prefix}${rel.split(path.sep).join("/")}`,
      md5: md5(await readFile(path.join(root, rel))),
    });
  return out;
}

const git = (...a) =>
  execFileSync("git", a, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A phase's way of ending the deploy with an exit code and a message,
 *  as `process.exit` did; anything else thrown is a crash (exit 1). */
export class DeployExit extends Error {
  /** @param {number} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The migrate Lambda applies every pending migration (`{}`). */
async function runMigrations(d, functionName) {
  console.error("running migrations via the migrate lambda...");
  const invoked = await d.lambda.send(
    new InvokeCommand({ FunctionName: functionName, Payload: "{}" }),
  );
  const migrateResult = JSON.parse(
    Buffer.from(invoked.Payload).toString() || "null",
  );
  if (invoked.FunctionError)
    throw new DeployExit(1, `MIGRATE FAILED: ${JSON.stringify(migrateResult)}`);
  console.error(`migrations: ${JSON.stringify(migrateResult)}`);
}

const platformUpdate = (d) => !d.isCreate && d.lane === "platform";
const update = (d) => !d.isCreate;
const web = (d) => !d.args.skipWeb;

/**
 * The deploy, in order. Each phase runs when its `when` says (always
 * without one), against one state object `d` that the phases before it
 * filled in, and is timed for the deploy record. A phase ends the deploy
 * by throwing DeployExit; the phases after it never run.
 *
 * @type {{ name: string, when?: (d: any) => boolean, run: (d: any) => Promise<void> }[]}
 */
export const DEPLOY_PHASES = [
  {
    // Deploy what is committed (DECISIONS "One worktree per run": deploy
    // from a clean worktree). The build bundles the working tree as it
    // is, so an edit that was never committed would ship with no trace
    // in git. Untracked files (local progress files, caches) are not the
    // build's and do not count.
    name: "worktree",
    async run() {
      const dirty = git("status", "--porcelain", "--untracked-files=no");
      if (dirty)
        throw new DeployExit(
          2,
          `deploy: the worktree has uncommitted changes; commit them first. Nothing was deployed.\n${dirty}`,
        );
    },
  },
  {
    // Deploy only what main holds and CI passed (the PR workflow,
    // 2026-09-26; lib/ci-gate.mjs). --break-glass is for GitHub being
    // unreachable, never for a red check. The gate can wait minutes for
    // a check still running; the record says how long.
    name: "ci-gate",
    async run(d) {
      if (d.args.breakGlass) {
        console.warn(
          "deploy: WARNING --break-glass: the CI gate is skipped; record why in a docs/notes/ fragment.",
        );
        return;
      }
      const gate = await ciGate({
        git: (a) =>
          execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim(),
        ghApi: async (p) =>
          JSON.parse(execFileSync("gh", ["api", p], { encoding: "utf8" })),
        repo: GITHUB_REPO,
        log: (line) => console.log(line),
      });
      if (!gate.ok) throw new DeployExit(2, `deploy: ${gate.reason}`);
      console.log(
        `deploy: CI gate passed for ${gate.sha.slice(0, 8)} (validate green on ${gate.via}).`,
      );
    },
  },
  {
    // The production lock (lib/production-lock.mjs), --break-glass
    // included: GitHub being down is no reason for two deploys at once.
    // Taken after the checks that only read (arguments, the worktree,
    // the CI gate) and before the account is read or anything is built,
    // so a refused deploy stops in seconds and nothing is built or sent
    // without it. Held to the end: the deploy record is a production
    // write too. Released when this process ends, however it ends
    // (holdUntilExit).
    name: "lock",
    async run(d) {
      d.headSha = git("rev-parse", "HEAD");
      const lockFile = lockFileFor(repoRoot);
      const locked = acquireLock({
        file: lockFile,
        holder: "deploy",
        purpose: `deploy.mjs ${d.argv.join(" ") || "(update)"}`.trim(),
        worktree: git("rev-parse", "--show-toplevel"),
        head: d.headSha,
      });
      if (!locked.ok)
        throw new DeployExit(
          3,
          `deploy: ${locked.reason}\nNothing was deployed.`,
        );
      d.releaseLock = holdUntilExit({ file: lockFile, lock: locked.lock });
      console.error(`deploy: production lock taken (${lockFile}).`);
    },
  },
  {
    // The caller, and the code bucket's versioning. Web revisions
    // require an immutable source version. The bootstrap code bucket
    // predates Web Functions; enabling versioning is one deployment
    // write, inside the production lock. Never suspend it or expire
    // referenced versions.
    name: "account",
    async run(d) {
      const caller = await new STSClient({ region: REGION }).send(
        new GetCallerIdentityCommand({}),
      );
      if (
        caller.Account !== "999153317627" ||
        !caller.Arn?.includes(
          "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
        )
      )
        throw new Error("deploy requires the cloud-engineer account and role");
      d.accountId = caller.Account;
      d.codeBucket = `elixir-mcp-code-${d.accountId}`;
      d.cfn = new CloudFormationClient({ region: REGION });
      d.s3 = new S3Client({ region: REGION });
      d.lambda = new LambdaClient({ region: REGION });
      const versioning = await d.s3.send(
        new GetBucketVersioningCommand({ Bucket: d.codeBucket }),
      );
      if (versioning.Status !== "Enabled") {
        await d.s3.send(
          new PutBucketVersioningCommand({
            Bucket: d.codeBucket,
            VersioningConfiguration: { Status: "Enabled" },
          }),
        );
      }
    },
  },
  {
    name: "build",
    async run(d) {
      console.error("building lambda bundles...");
      d.artifacts = await buildAll();
    },
  },
  {
    name: "upload",
    async run(d) {
      const codeVersions = {};
      const codeKeys = {};
      for (const { name, zipPath, dir } of d.artifacts) {
        // Named by content, not by the zip's bytes (zip stamps mtimes):
        // the same code keeps its key and the stack sees no change for it.
        const key = codeKey(name, bundleFingerprint(dir));
        // Reuse the existing immutable object when content is unchanged.
        // Uploading it on every run creates a new VersionId and
        // needlessly replaces revisions.
        let version;
        try {
          version = (
            await d.s3.send(
              new HeadObjectCommand({ Bucket: d.codeBucket, Key: key }),
            )
          ).VersionId;
        } catch (error) {
          if (!["NotFound", "NoSuchKey"].includes(error.name)) throw error;
        }
        if (!version || version === "null") {
          const uploaded = await d.s3.send(
            new PutObjectCommand({
              Bucket: d.codeBucket,
              Key: key,
              Body: await readFile(zipPath),
            }),
          );
          version = uploaded.VersionId;
        }
        if (!version || version === "null")
          throw new Error(`No immutable source version for ${name}`);
        codeVersions[name] = version;
        codeKeys[name] = key;
        console.error(`uploaded ${key}`);
      }
      d.codeKeys = codeKeys;
      d.required = {
        CodeBucket: d.codeBucket,
        WebApiCodeVersion: codeVersions["web-api"],
        McpCodeVersion: codeVersions.mcp,
        CollectorCodeVersion: codeVersions.collector,
        ...webBuildParameters(codeKeys),
        WebApiCodeKey: codeKeys["web-api"],
        McpCodeKey: codeKeys.mcp,
        SchedulerCodeKey: codeKeys.scheduler,
        EmailRelayCodeKey: codeKeys["email-relay"],
        MigrateCodeKey: codeKeys.migrate,
        JobsCodeKey: codeKeys.jobs,
        CollectorCodeKey: codeKeys.collector,
        TimelineSyncCodeKey: codeKeys["timeline-sync"],
      };
      d.templateBody = await readFile(
        path.join(repoRoot, "infra/template.yaml"),
        "utf8",
      );
    },
  },
  {
    // The native HTML bundle names these assets. Publish before
    // CloudFormation routes its revision; an old browser's immutable
    // chunks stay in the bucket. Only what changed is uploaded, with the
    // headers the site phase gives the same files (lib/site-publish.mjs),
    // so the site phase finds them published. This deploy's manifest of
    // the assets it ships is written here, before the switch: a later
    // deploy's prune never takes an asset a deploy in its window shipped.
    name: "assets",
    async run(d) {
      const bucket = `elixir-mcp-site-${d.accountId}`;
      const viteDir = path.join(repoRoot, "apps/web/dist/assets");
      const files = await hashTree(viteDir, "assets/");
      d.published = await readPublished(d.s3, d.codeBucket);
      const plan = publishPlan({
        files,
        listing: await listObjects(d.s3, bucket, { prefix: "assets/" }),
        published: d.published,
        hashed: hashedAssets(
          files.map((f) => f.rel),
          readdirSync(viteDir),
        ),
      });
      const result = await publish({
        s3: d.s3,
        bucket,
        plan,
        read: (rel) =>
          readFile(path.join(viteDir, rel.slice("assets/".length))),
      });
      Object.assign(d.published, result.entries);
      await writePublished(d.s3, d.codeBucket, d.published);
      d.assetManifestKey = siteAssetsKey(d.startedAt, d.headSha);
      await writeAssetManifest(d.s3, d.codeBucket, {
        key: d.assetManifestKey,
        sha: d.headSha,
        assets: files.map((f) => f.rel),
      });
      console.error(
        `app assets: ${result.uploaded} uploaded, ${result.unchanged + result.confirmed} unchanged.`,
      );
    },
  },
  {
    // lib/deploy-lane.mjs: the live stack's code keys and template
    // against this build's. A deploy that changes neither ships the
    // site alone: nothing to migrate, nothing for CloudFormation to do.
    name: "lane",
    when: update,
    async run(d) {
      const { Stacks: live } = await d.cfn.send(
        new DescribeStacksCommand({ StackName: STACK }),
      );
      d.liveOutputs = Object.fromEntries(
        (live[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
      );
      const { TemplateBody: liveTemplate } = await d.cfn.send(
        new GetTemplateCommand({ StackName: STACK, TemplateStage: "Original" }),
      );
      const choice = chooseLane({
        codeKeys: d.required,
        liveParameters: live[0].Parameters,
        template: d.templateBody,
        liveTemplate,
        platform: d.args.platform,
        parameterChange:
          Object.keys(d.args.params).length > 0 || d.args.rotateOriginSecret,
      });
      d.lane = choice.lane;
      console.error(
        d.lane === "site"
          ? "lane: site - no Lambda bundle and not the template changed; no migrations, no stack update."
          : `lane: platform - changed: ${choice.changed.join(", ")}.`,
      );
    },
  },
  {
    // Read-only, before anything is migrated or switched: the CloudFront
    // grant on each live Web Function endpoint is written outside
    // CloudFormation (the "grants" phase), so nothing else notices it
    // drift. A missing or foreign one stops the deploy here instead of
    // after the switch (lib/web-release.mjs).
    name: "grants-check",
    when: update,
    async run(d) {
      const check = await checkWebEndpointGrants({
        web: new LambdaWebClient({ region: REGION, maxAttempts: 1 }),
        outputs: d.liveOutputs,
        distributionArn: `arn:aws:cloudfront::${d.accountId}:distribution/${d.liveOutputs.SiteDistributionId}`,
      });
      if (!check.ok)
        throw new DeployExit(
          2,
          [
            "deploy: a Web Function endpoint's CloudFront grant is not the deploy's own; refused before any migration or revision switch:",
            ...check.problems.map((p) => `  - ${p}`),
            "Access changed outside a deploy: find who changed it before anything restores it (an access change outside a deploy is Jamie's to approve).",
          ].join("\n"),
        );
      console.error(
        `endpoint grants checked: ${JSON.stringify(check.receipt)}`,
      );
    },
  },
  {
    // Migrate BEFORE the flip (sol-6 F2). Migrations are
    // expand-and-contract by policy: applying them first means the
    // currently-serving code (which tolerates the expanded schema by
    // construction) never races a schema it predates, and a failed
    // migration stops the deploy before any application code flips. On
    // --create the stack doesn't exist yet; migrations run after it.
    name: "migrate-push",
    when: platformUpdate,
    async run(d) {
      console.error("pushing migrate bundle ahead of the stack flip...");
      await d.lambda.send(
        new UpdateFunctionCodeCommand({
          FunctionName: "elixir-mcp-migrate",
          S3Bucket: d.codeBucket,
          S3Key: d.codeKeys.migrate,
        }),
      );
      await waitUntilFunctionUpdatedV2(
        { client: d.lambda, maxWaitTime: 120 },
        { FunctionName: "elixir-mcp-migrate" },
      );
    },
  },
  {
    // --verify-reference-seed: after the operator code is pushed and
    // before migrations and the vocabulary refresh, compare every live
    // reference seed column with the seed, read-only.
    name: "seed-check",
    when: (d) => d.args.verifyReferenceSeed,
    async run(d) {
      d.verifiedReferenceSeed = await prepareReferenceSeedRefresh(d.lambda);
    },
  },
  {
    name: "migrate",
    when: platformUpdate,
    async run(d) {
      await runMigrations(d, "elixir-mcp-migrate");
    },
  },
  {
    // The archetype vocabulary rides every deploy, site lane included
    // (0147): the Lambdas have no internet, so this checkout's sibling
    // cr-agent-api-docs is the source, and its commit is the version.
    name: "vocabulary",
    when: update,
    async run(d) {
      console.error(
        "importing the archetype vocabulary from ../cr-agent-api-docs...",
      );
      const vocabulary =
        d.verifiedReferenceSeed?.vocabulary ?? readVocabulary();
      saveVocabularySnapshot(vocabulary);
      if (d.verifiedReferenceSeed) await d.verifiedReferenceSeed.refresh();
      else await importReferenceSeed(d.lambda, vocabulary);
    },
  },
  {
    // The stack (the platform lane, --create included): the revision
    // switch.
    name: "stack",
    when: (d) => d.lane === "platform",
    async run(d) {
      // Inline TemplateBody caps at 51,200 bytes and the template passed
      // it on 2026-09-09; by URL the cap is 1 MB. The object rides the
      // code bucket under its content hash, like the bundles.
      const templateKey = `templates/${createHash("sha256").update(d.templateBody).digest("hex").slice(0, 16)}.yaml`;
      await d.s3.send(
        new PutObjectCommand({
          Bucket: d.codeBucket,
          Key: templateKey,
          Body: d.templateBody,
          ContentType: "application/x-yaml",
        }),
      );
      const templateUrl = `https://${d.codeBucket}.s3.${REGION}.amazonaws.com/${templateKey}`;
      await d.cfn.send(
        new ValidateTemplateCommand({ TemplateURL: templateUrl }),
      );

      // --param=Key=Value: one-time explicit values for PRESERVED
      // parameters (a parameter's first deploy cannot UsePreviousValue).
      const paramOverrides = { ...d.args.params };

      // --rotate-origin-secret (docs/SECRETS.md): the current value is
      // read from the deployed web door, since the stack masks NoEcho
      // parameters, and held in this process only. The template makes
      // CloudFront wait for every door, so they accept the new value
      // before any edge sends it.
      if (d.args.rotateOriginSecret) {
        const { Stacks: rotationStack } = await d.cfn.send(
          new DescribeStacksCommand({ StackName: STACK }),
        );
        const revisionId = rotationStack[0].Outputs.find(
          (o) => o.OutputKey === "WebApiWebRevisionId",
        )?.OutputValue;
        if (!revisionId)
          throw new Error(
            "Rotate only after the native migration has deployed",
          );
        const revision = await new LambdaWebClient({ region: REGION }).send(
          new GetWebFunctionRevisionCommand({
            functionName: "elixir-mcp-web-api-web",
            revisionId,
          }),
        );
        const vars = revision.serviceConfig?.environmentVariables ?? {};
        if (vars.ORIGIN_SECRET_PREVIOUS)
          throw new DeployExit(
            2,
            "deploy: the last origin rotation has not been cleared; deploy with --param=OriginSecretPrevious= first. The code is uploaded and migrated; the stack is unchanged.",
          );
        Object.assign(paramOverrides, originRotation(vars.ORIGIN_SECRET));
        console.error("rotating the origin secret (values not shown)...");
      }

      if (d.isCreate) {
        console.error("creating stack (this starts billing: RDS ~$15/mo)...");
        await d.cfn.send(
          new CreateStackCommand({
            StackName: STACK,
            TemplateURL: templateUrl,
            Parameters: buildParameters(d.required, {}),
            Capabilities: ["CAPABILITY_NAMED_IAM"],
            Tags: stackTags(d.accountId),
          }),
        );
        await waitUntilStackCreateComplete(
          { client: d.cfn, maxWaitTime: 2400 },
          { StackName: STACK },
        );
        return;
      }
      console.error("updating stack...");
      // Which parameters the live stack already carries: a SECRET
      // parameter absent here is on its first deploy and gets minted,
      // never reset.
      const { Stacks: current } = await d.cfn.send(
        new DescribeStacksCommand({ StackName: STACK }),
      );
      const existingKeys = (current[0].Parameters ?? []).map(
        (p) => p.ParameterKey,
      );
      try {
        await d.cfn.send(
          new UpdateStackCommand({
            StackName: STACK,
            TemplateURL: templateUrl,
            Parameters: buildParameters(
              d.required,
              null,
              paramOverrides,
              existingKeys,
            ),
            Capabilities: ["CAPABILITY_NAMED_IAM"],
            Tags: stackTags(d.accountId),
          }),
        );
        await waitUntilStackUpdateComplete(
          { client: d.cfn, maxWaitTime: 2400 },
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
    },
  },
  {
    // The stack's outputs, then the exact CloudFront grant on each Web
    // Function endpoint, read back with the endpoint's pinned revision
    // (lib/web-release.mjs; the registry's ResourcePolicy type cannot
    // express it).
    name: "grants",
    async run(d) {
      const { Stacks } = await d.cfn.send(
        new DescribeStacksCommand({ StackName: STACK }),
      );
      d.outputs = Object.fromEntries(
        Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]),
      );
      const webRelease = await grantWebEndpoints({
        web: new LambdaWebClient({ region: REGION, maxAttempts: 1 }),
        outputs: d.outputs,
        distributionArn: `arn:aws:cloudfront::${d.accountId}:distribution/${d.outputs.SiteDistributionId}`,
      });
      console.error(`web revisions verified: ${JSON.stringify(webRelease)}`);
    },
  },
  {
    // First-create migrations (the update path migrated pre-flip).
    name: "first-migrations",
    when: (d) => d.isCreate,
    async run(d) {
      await runMigrations(d, d.outputs.MigrateFunctionName);
    },
  },
  {
    name: "public-stats",
    when: (d) => d.lane === "platform",
    async run(d) {
      const snapshot = await d.lambda.send(
        new InvokeCommand({
          FunctionName: "elixir-mcp-jobs",
          Payload: JSON.stringify({ public_stats: true }),
        }),
      );
      if (snapshot.FunctionError)
        throw new Error(
          "Public statistics snapshot failed; inspect the jobs log",
        );
      console.error("public statistics snapshot published");
    },
  },
  {
    // Card art first (2026-10-08): what the bucket holds, then each form
    // the live catalog names that it lacks, so the art the card responses
    // carry answers and a fresh worktree ships the whole mirror. A
    // failure warns and ships what the bucket held: never a reason to
    // stop a deploy.
    name: "card-art",
    when: web,
    async run(d) {
      try {
        execFileSync(
          "node",
          [
            path.join(repoRoot, "infra/scripts/mirror-card-art.mjs"),
            "--seed-bucket",
            d.outputs.SiteBucketName,
          ],
          { cwd: repoRoot, stdio: "inherit" },
        );
      } catch (err) {
        console.error(`WARNING: card art mirror failed: ${err.message}`);
      }
    },
  },
  {
    // Two builds merged into one tree, validated before anything is
    // uploaded: dead sitemap entries, dangling llms.txt links, a missing
    // app shell, a missing asset or a file with no content type fail
    // here instead of on the live site. The build phase built the
    // contract, the docs corpus and the app moments ago, so only the
    // static site builds here (--prebuilt). Then only what changed is
    // published: assets first and never deleted, then the documents,
    // each with its Content-Type and Cache-Control, then the documents
    // the build no longer has are deleted; the old build's chunks are
    // pruned after the invalidation, once nothing can ask for them (#73;
    // lib/site-publish.mjs).
    name: "site",
    when: web,
    async run(d) {
      console.error("building the site (app + static)...");
      execFileSync(
        "node",
        [path.join(repoRoot, "infra/scripts/build-site.mjs"), "--prebuilt"],
        { cwd: repoRoot, stdio: "inherit" },
      );
      const siteDir = path.join(repoRoot, "dist/site");
      const files = await hashTree(siteDir);
      d.siteFiles = files.map((f) => f.rel);
      const bucket = d.outputs.SiteBucketName;
      const plan = publishPlan({
        files,
        listing: await listObjects(d.s3, bucket),
        published: d.published,
        hashed: hashedAssets(
          d.siteFiles,
          readdirSync(path.join(repoRoot, "apps/web/dist/assets")),
        ),
        removeMissing: true,
      });
      const result = await publish({
        s3: d.s3,
        bucket,
        plan,
        read: (rel) => readFile(path.join(siteDir, rel)),
      });
      const removed = new Set(plan.remove);
      d.published = Object.fromEntries(
        Object.entries({ ...d.published, ...result.entries }).filter(
          ([key]) => !removed.has(key),
        ),
      );
      await writePublished(d.s3, d.codeBucket, d.published);
      await writeAssetManifest(d.s3, d.codeBucket, {
        key: d.assetManifestKey,
        sha: d.headSha,
        assets: d.siteFiles.filter((rel) => rel.startsWith("assets/")),
      });
      console.error(
        `site: ${files.length} files; ${result.uploaded} uploaded, ${result.unchanged + result.confirmed} unchanged, ${result.removed} removed.`,
      );
    },
  },
  {
    // Every web deploy still flushes the edge: objects published before
    // #73 carry no Cache-Control and sit at the edge for the policy's
    // day, and the site's own ?v= assets share one cache key per name.
    // The distribution is the stack's own output (2026-10-21), not a
    // search of the account's distributions by comment.
    name: "invalidate",
    when: web,
    async run(d) {
      const DistributionId = d.outputs.SiteDistributionId;
      if (!DistributionId) {
        console.warn(
          "WARNING: the stack has no SiteDistributionId output; nothing invalidated.",
        );
        return;
      }
      await new CloudFrontClient({ region: REGION }).send(
        new CreateInvalidationCommand({
          DistributionId,
          InvalidationBatch: {
            CallerReference: String(Date.now()),
            Paths: { Quantity: 1, Items: ["/*"] },
          },
        }),
      );
      console.error(`invalidated ${DistributionId}`);
    },
  },
  {
    // Prune: an asset this build does not ship, that no deploy in the
    // last PRUNE_AFTER_DAYS shipped (their manifests), and that was not
    // uploaded in that window, can no longer be asked for by a page that
    // is still open. Any doubt about what is referenced (a manifest that
    // cannot be read, this deploy's own not listed) prunes nothing.
    name: "prune",
    when: web,
    async run(d) {
      const now = Date.now();
      let referenced;
      try {
        referenced = await referencedAssets(d.s3, d.codeBucket, {
          now,
          days: PRUNE_AFTER_DAYS,
          own: d.assetManifestKey,
        });
      } catch (err) {
        console.warn(
          `WARNING: no prune this deploy; the asset manifests could not be read: ${err?.message ?? err}`,
        );
        return;
      }
      const listing = await listObjects(d.s3, d.outputs.SiteBucketName, {
        prefix: "assets/",
      });
      const prune = pruneCandidates({
        objects: [...listing].map(([Key, o]) => ({
          Key,
          LastModified: o.lastModified,
        })),
        current: new Set(
          d.siteFiles.filter((rel) => rel.startsWith("assets/")),
        ),
        referenced,
        now,
        days: PRUNE_AFTER_DAYS,
      });
      for (let i = 0; i < prune.length; i += 1000) {
        await d.s3.send(
          new DeleteObjectsCommand({
            Bucket: d.outputs.SiteBucketName,
            Delete: {
              Objects: prune.slice(i, i + 1000).map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }
      console.error(
        `pruned ${prune.length} asset(s) no deploy has shipped for ${PRUNE_AFTER_DAYS}+ days`,
      );
    },
  },
  {
    // Smoke gate: a deploy is not done until the read-only checks pass
    // against the live doors.
    name: "smoke",
    async run() {
      const smoke = spawnSync(
        process.execPath,
        [path.join(here, "smoke.mjs")],
        { stdio: "inherit" },
      );
      if (smoke.status !== 0)
        throw new DeployExit(
          1,
          "SMOKE FAILED - the stack deployed but the doors misbehave.",
        );
    },
  },
  {
    // Acceptance gate (2026-09-21): the deployed product against the
    // real record, read-only, as a read-only agent principal -
    // invariants the fixture tests cannot see (live data shape, live
    // scale). Opt-in per deploy (Jamie, 2026-09-21: ~4.5 minutes and a
    // pass of heavy reads on the shared micro, so it is turned on when
    // wanted, not on every deploy): `--acceptance` on the command line
    // or ACCEPTANCE=1 in the environment. Without it the deploy says so
    // in one line. A red case fails the deploy; a missing token file
    // warns. --acceptance=<family> runs only that family's cases
    // (2026-09-23: a full pass on every deploy of a sweep drained the
    // database's EBS byte balance). Plain --acceptance is the whole
    // suite, for releases that touch shared code.
    name: "acceptance",
    async run(d) {
      const acceptanceEnv = path.join(repoRoot, "acceptance/.env");
      const acceptanceFamily = d.args.acceptanceFamily;
      const wantAcceptance =
        d.args.acceptance || process.env.ACCEPTANCE === "1";
      d.acceptanceResult = "not run";
      if (!wantAcceptance) {
        console.log(
          "WARNING: acceptance NOT run. Pass --acceptance=<family> when a tool in that family changed, --acceptance for shared code or a release (or ACCEPTANCE=1); npm run acceptance any time.",
        );
      } else if (existsSync(acceptanceEnv)) {
        const acceptance = spawnSync(
          process.execPath,
          [
            path.join(repoRoot, "acceptance/run.mjs"),
            ...(acceptanceFamily ? ["--family", acceptanceFamily] : []),
          ],
          { stdio: "inherit" },
        );
        if (acceptance.status !== 0)
          throw new DeployExit(
            1,
            "ACCEPTANCE FAILED - the deploy is live but an invariant broke; fix forward or roll back.",
          );
        d.acceptanceResult = acceptanceFamily
          ? `passed (\`--acceptance=${acceptanceFamily}\`)`
          : "passed (the whole suite)";
      } else {
        d.acceptanceResult =
          "not run (no acceptance/.env on the deploying machine)";
        console.warn(
          "acceptance: skipped - no acceptance/.env on this machine (see acceptance/README.md).",
        );
      }
    },
  },
  {
    // The deploy record (lib/deploy-record.mjs): what is live, how long
    // each phase took, and a comment on each PR this deploy shipped for
    // the first time. The previous record says where the last deploy
    // stopped. Nothing here fails a deploy that is already live; it
    // warns.
    name: "record",
    async run(d) {
      try {
        await writeRecord(d);
      } catch (err) {
        console.warn(`WARNING: deploy record failed: ${err?.message ?? err}`);
      }
    },
  },
];

async function writeRecord(d) {
  const { s3, codeBucket, headSha, lane } = d;
  const deployedAt = new Date().toISOString();
  let previous = null;
  try {
    const got = await s3.send(
      new GetObjectCommand({ Bucket: codeBucket, Key: DEPLOY_RECORD_KEY }),
    );
    previous = JSON.parse(await got.Body.transformToString());
  } catch (err) {
    if (err?.name !== "NoSuchKey") throw err;
  }
  const declared = {
    // The highest file in src/changes/ is CONTRACT_VERSION.
    contract: versionsIn(
      readdirSync(path.join(repoRoot, "packages/contracts/src/changes")),
    )[0],
    api: JSON.parse(
      await readFile(
        path.join(repoRoot, "packages/contracts/integration-api.openapi.json"),
        "utf8",
      ),
    ).info.version,
  };
  const live = await liveVersions({
    fetch,
    base: "https://elixir.poapkings.com",
  });
  const timing = deployTiming({
    startedAt: d.startedAt,
    recordedAt: deployedAt,
    breakGlass: d.args.breakGlass,
    phases: d.phases,
  });
  const record = {
    sha: headSha,
    deployed_at: deployedAt,
    lane,
    contract_version: live.contract ?? declared.contract,
    api_version: live.api ?? declared.api,
    acceptance: d.acceptanceResult,
    previous_sha: previous?.sha ?? null,
    ...timing,
  };
  // Recorded before the comments: a comment that fails must not leave
  // the next deploy counting this one's commits again.
  for (const Key of [DEPLOY_RECORD_KEY, deployHistoryKey(deployedAt, headSha)])
    await s3.send(
      new PutObjectCommand({
        Bucket: codeBucket,
        Key,
        Body: `${JSON.stringify(record, null, 2)}\n`,
        ContentType: "application/json",
      }),
    );
  console.error(`deploy record: ${headSha.slice(0, 12)} written.`);
  const range = shippedCommits({
    git: (a) => git(...a),
    from: previous?.sha ?? null,
    to: headSha,
  });
  if (!range.ok) {
    console.warn(`deploy record: no PR comments; ${range.reason}.`);
    return;
  }
  const ghApi = async (p) =>
    JSON.parse(execFileSync("gh", ["api", p], { encoding: "utf8" }));
  const ghPost = async (p, body) =>
    execFileSync("gh", ["api", "-X", "POST", p, "--input", "-"], {
      input: JSON.stringify(body),
      encoding: "utf8",
    });
  const pulls = await shippedPulls({
    ghApi,
    repo: GITHUB_REPO,
    commits: range.commits,
  });
  const result = await commentOnPulls({
    ghApi,
    ghPost,
    repo: GITHUB_REPO,
    sha: headSha,
    pulls,
    bodyFor: (pr) =>
      commentBody({
        repo: GITHUB_REPO,
        sha: headSha,
        deployedAt,
        lane,
        live,
        declared,
        acceptance: d.acceptanceResult,
        prCommits: pr.commits,
        timing,
      }),
    warn: (line) => console.warn(line),
  });
  console.error(
    `deploy record: ${range.commits.length} commit(s) shipped; commented on ${result.commented.map((n) => `#${n}`).join(", ") || "no PR"}${result.skipped.length ? `; already commented: ${result.skipped.map((n) => `#${n}`).join(", ")}` : ""}.`,
  );
}

/**
 * Run the phases in order, each when its `when` allows, timing each
 * into `d.phases` ({ name, seconds }) as it ends.
 */
export async function runPhases(phases, d, { now = Date.now } = {}) {
  d.phases ??= [];
  for (const phase of phases) {
    if (phase.when && !phase.when(d)) continue;
    const started = now();
    await phase.run(d);
    d.phases.push({ name: phase.name, seconds: toSeconds(now() - started) });
  }
}

/**
 * The deploy: its arguments are refused before any phase (so before the
 * first AWS call), then DEPLOY_PHASES. Returns the exit code.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @param {{ phases?: typeof DEPLOY_PHASES, now?: () => number }} [options]
 */
export async function deploy(
  argv,
  { phases = DEPLOY_PHASES, now = Date.now } = {},
) {
  // The deploy's start, before the CI gate: the record measures the
  // gate's wait from here.
  const startedAt = new Date(now()).toISOString();
  // Refuse anything but a known flag before the first AWS call: an
  // unknown one used to be ignored, so `--help` deployed production
  // (2026-09-25).
  const args = parseDeployArgs(argv);
  if (args.help) {
    console.log(DEPLOY_USAGE);
    return 0;
  }
  const refusal = argumentRefusal(args);
  if (refusal) {
    console.error(refusal);
    return 2;
  }
  const d = {
    argv,
    args,
    isCreate: args.create,
    lane: "platform",
    startedAt,
    phases: [],
  };
  try {
    await runPhases(phases, d, { now });
  } catch (error) {
    if (!(error instanceof DeployExit)) throw error;
    console.error(error.message);
    return error.code;
  }
  d.releaseLock?.();
  if (d.outputs) {
    console.log("\ndeploy complete.");
    console.log(
      `site + mcp door: https://${d.outputs.SiteDistributionDomain}  (CNAME elixir.poapkings.com here)`,
    );
    console.log(`connect URL: https://elixir.poapkings.com/mcp`);
    console.log(`alarm topic: ${d.outputs.AlarmTopicArn}`);
  }
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const code = await deploy(process.argv.slice(2));
  if (code !== 0) process.exit(code);
}
