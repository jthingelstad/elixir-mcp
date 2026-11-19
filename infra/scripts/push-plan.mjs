#!/usr/bin/env node
/**
 * validate's `changes` job on a push to main: prints `run=` and `e2e=`
 * lines for $GITHUB_OUTPUT (lib/push-plan.mjs says what they mean) and
 * a `why` line for the log. Needs GH_TOKEN and GITHUB_REPOSITORY, and a
 * checkout with main's history (fetch-depth: 0).
 *
 *   node infra/scripts/push-plan.mjs >> "$GITHUB_OUTPUT"
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pushPlan } from "./lib/push-plan.mjs";

const git = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const ghApi = async (path) =>
  JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
const e2eNeeded = (paths) =>
  execFileSync(
    "sh",
    [fileURLToPath(new URL("./e2e-needed.sh", import.meta.url))],
    { encoding: "utf8", input: paths ? `${paths}\n` : "" },
  ).trim() === "true";

const plan = await pushPlan({
  git,
  ghApi,
  e2eNeeded,
  repo: process.env.GITHUB_REPOSITORY,
});
console.error(`push plan: run=${plan.run} e2e=${plan.e2e} (${plan.why})`);
console.log(`run=${plan.run}`);
console.log(`e2e=${plan.e2e}`);
