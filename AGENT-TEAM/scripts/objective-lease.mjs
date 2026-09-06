#!/usr/bin/env node
/**
 * Checkout lease: serializes every mutating actor on this clone —
 * objective runs AND interactive sessions. The lease is an exclusive-
 * create JSON file inside .git (never committed, survives nothing but
 * this checkout). Claim before the first mutation, check before edit
 * and before push, release only with a clean worktree.
 *
 *   node AGENT-TEAM/scripts/objective-lease.mjs claim <run|record|loop|guard|session>
 *   node AGENT-TEAM/scripts/objective-lease.mjs check <objective> --lease-id <id>
 *   node AGENT-TEAM/scripts/objective-lease.mjs release <objective> --lease-id <id>
 *   node AGENT-TEAM/scripts/objective-lease.mjs status
 *   node AGENT-TEAM/scripts/objective-lease.mjs clear-stale --hours <n>
 *
 * clear-stale refuses dirty worktrees and young leases; never infer
 * staleness from age plus a clean tree by hand — use this command so
 * the clear is recorded with proof.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  closeSync,
  constants,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OBJECTIVES = new Set(["run", "record", "loop", "guard", "session"]);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const LEASE_PATH = path.resolve(
  REPO_ROOT,
  execFileSync("git", ["rev-parse", "--git-dir"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim(),
  "agent-team-objective-lease.json",
);

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function assertObjective(objective) {
  if (!OBJECTIVES.has(objective)) {
    throw new Error(
      `unknown objective ${JSON.stringify(objective)}; choose run, record, loop, guard, or session`,
    );
  }
}

function readLease() {
  try {
    return JSON.parse(readFileSync(LEASE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`lease file is unreadable: ${error.message}`);
  }
}

function claim(objective) {
  assertObjective(objective);
  const payload = {
    objective,
    leaseId: randomUUID(),
    claimedAt: new Date().toISOString(),
    holderId:
      process.env.CODEX_THREAD_ID ??
      process.env.CLAUDE_SESSION_ID ??
      "untracked-manual-holder",
    holderPid: process.ppid,
    hostname: hostname(),
    startingHead: git(["rev-parse", "HEAD"]),
  };
  let fd;
  try {
    fd = openSync(
      LEASE_PATH,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `checkout lease is already held: ${JSON.stringify(readLease())}`,
      );
    }
    throw error;
  }
  try {
    writeFileSync(fd, `${JSON.stringify(payload)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  return payload;
}

function assertOwner(objective, leaseId) {
  assertObjective(objective);
  if (!leaseId) throw new Error("--lease-id is required");
  const current = readLease();
  if (!current) throw new Error("checkout lease is not held");
  if (current.objective !== objective || current.leaseId !== leaseId) {
    throw new Error(
      `checkout lease belongs to another run: ${JSON.stringify({
        objective: current.objective,
        claimedAt: current.claimedAt,
        holderId: current.holderId,
      })}`,
    );
  }
  return current;
}

function release(objective, leaseId) {
  const current = assertOwner(objective, leaseId);
  if (git(["status", "--porcelain"]))
    throw new Error("refusing to release a lease while the worktree is dirty");
  unlinkSync(LEASE_PATH);
  return current;
}

function clearStale(hours) {
  if (!Number.isFinite(hours) || hours <= 0)
    throw new Error("--hours must be a positive number");
  const current = readLease();
  if (!current) throw new Error("no checkout lease exists");
  const ageMs = Date.now() - Date.parse(current.claimedAt);
  if (!Number.isFinite(ageMs)) throw new Error("lease has no valid claimedAt");
  if (ageMs < hours * 3600_000)
    throw new Error(`lease is not yet ${hours} hours old`);
  if (git(["status", "--porcelain"]))
    throw new Error(
      "worktree is dirty; a stale-looking lease over uncommitted work needs the manual inspected clear (see README)",
    );
  unlinkSync(LEASE_PATH);
  return current;
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [, , command, objective] = process.argv;
try {
  switch (command) {
    case "claim":
      console.log(JSON.stringify(claim(objective)));
      break;
    case "check":
      console.log(JSON.stringify(assertOwner(objective, arg("--lease-id"))));
      break;
    case "release":
      console.log(JSON.stringify(release(objective, arg("--lease-id"))));
      break;
    case "status":
      console.log(JSON.stringify(readLease()));
      break;
    case "clear-stale":
      console.log(JSON.stringify(clearStale(Number(arg("--hours")))));
      break;
    default:
      console.error(
        "usage: objective-lease.mjs <claim|check|release|status|clear-stale> [objective] [--lease-id id] [--hours n]",
      );
      process.exit(2);
  }
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
