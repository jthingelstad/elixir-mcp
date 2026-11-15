#!/usr/bin/env node
/**
 * Hold the production lock for a whole batch of `npm run op` calls
 * (#440; lib/production-lock.mjs holdForBatch):
 *
 *   npm run op:batch -- --purpose "<what it writes, and why>" -- <command> [args...]
 *   npm run op:batch -- --help
 *
 * Takes the lock once (holder `batch`), runs the command with the lock's
 * id in ELIXIR_PRODUCTION_LOCK_ID, and releases the lock when the
 * command ends, however it ends. Each `npm run op` inside runs under the
 * batch's lock instead of taking its own, so no deploy starts between
 * two steps. Exits with the command's code, or 3 when production is
 * locked by someone else (nothing is run).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holdForBatch, lockFileFor } from "./lib/production-lock.mjs";

export const BATCH_USAGE = `usage: npm run op:batch -- --purpose "<text>" -- <command> [args...]

  Takes the production lock once for the whole command and releases it
  when the command ends (a signal is passed on to the command first).
  Every \`npm run op\` the command runs works under that lock, so a
  multi-step backfill holds it from its first step to its last.
  Exit 3: production is locked by someone else; nothing was run. Wait.

  npm run op:batch -- --purpose "repair X, resumable" -- sh -c '
    npm run op -- "{\\"repair_x\\": {\\"limit\\": 500}}" &&
    npm run op -- "{\\"repair_x\\": {\\"limit\\": 500, \\"after\\": 1234}}"'
  npm run op:batch -- --purpose "backfill Y" -- ./my-backfill.sh`;

/** @param {string[]} argv */
export function parseBatchArgs(argv) {
  const out = {
    help: false,
    purpose: null,
    command: null,
    args: [],
    errors: [],
  };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--") {
      [out.command = null, ...out.args] = rest;
      break;
    }
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--purpose") out.purpose = rest.shift() ?? "";
    else if (arg.startsWith("--purpose=")) out.purpose = arg.slice(10);
    else out.errors.push(`unknown argument ${arg}`);
  }
  if (out.help) return out;
  if (!out.purpose?.trim())
    out.errors.push("--purpose is required: what the batch writes, and why");
  if (!out.command) out.errors.push("a command after -- is required");
  return out;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const parsed = parseBatchArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(BATCH_USAGE);
    process.exit(0);
  }
  if (parsed.errors.length) {
    console.error(
      `op:batch: ${parsed.errors.join("; ")}; nothing was run.\n\n${BATCH_USAGE}`,
    );
    process.exit(2);
  }
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const git = (...a) =>
    execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim();
  process.exitCode = await holdForBatch({
    file: lockFileFor(repoRoot),
    purpose: parsed.purpose,
    command: parsed.command,
    args: parsed.args,
    worktree: git("rev-parse", "--show-toplevel"),
    head: git("rev-parse", "HEAD"),
  });
}
