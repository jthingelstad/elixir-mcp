#!/usr/bin/env node
/**
 * One ops-Lambda invoke, with the production lock around a write
 * (lib/ops-invoke.mjs has the rules; lib/production-lock.mjs the lock).
 *
 *   npm run op -- '{"stats": true}'
 *   npm run op -- '{"shape_census": true}' --function jobs
 *   npm run op -- --help
 *
 * Inside `npm run op:batch` (op-batch.mjs) it runs under the batch's
 * lock instead of taking its own.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  FUNCTIONS,
  lambdaClientConfig,
  parseOpArgs,
  runOp,
} from "./lib/ops-invoke.mjs";
import {
  acquireLock,
  batchLockFromEnv,
  describeHolder,
  holdUntilExit,
  lockFileFor,
  lockHolder,
} from "./lib/production-lock.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const argv = process.argv.slice(2);
// The client is built for the function the arguments name; a bad
// --function is refused by runOp before anything is sent.
const { fn } = parseOpArgs(argv);
const config = lambdaClientConfig(
  Object.hasOwn(FUNCTIONS, fn) ? fn : "migrate",
);
const git = (...a) =>
  execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim();

process.exitCode = await runOp({
  argv,
  whoami: async () =>
    (
      await new STSClient({
        region: config.region,
        profile: config.profile,
        maxAttempts: 1,
      }).send(new GetCallerIdentityCommand({}))
    ).Arn,
  lambda: new LambdaClient(config),
  InvokeCommand,
  lockFile: lockFileFor(repoRoot),
  batchLock: () => batchLockFromEnv({ file: lockFileFor(repoRoot) }),
  acquireLock,
  lockHolder,
  holdUntilExit,
  describe: describeHolder,
  worktree: git("rev-parse", "--show-toplevel"),
  head: git("rev-parse", "HEAD"),
});
