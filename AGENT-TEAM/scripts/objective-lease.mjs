#!/usr/bin/env node
/**
 * Deploy lease: serializes the actors that change production from this
 * clone. Edits need no lease (WORKFLOW.md, "One worktree per run": every
 * run edits in its own worktree and lands a pull request); a deploy, a
 * migration or a write through an ops lambda does. The lease is an
 * exclusive-create JSON file in the clone's COMMON git directory, so the
 * main checkout and every linked worktree see the same one (it lived in
 * each checkout's own .git until 2026-09-29, when runs shared a checkout).
 * Claim before the production change, check before it, release once it
 * is verified.
 *
 *   node AGENT-TEAM/scripts/objective-lease.mjs claim <key>
 *   node AGENT-TEAM/scripts/objective-lease.mjs check <key> --lease-id <id>
 *   node AGENT-TEAM/scripts/objective-lease.mjs release <key> --lease-id <id>
 *   node AGENT-TEAM/scripts/objective-lease.mjs abort <key> --lease-id <id> --reason "<text>"
 *   node AGENT-TEAM/scripts/objective-lease.mjs note <key> --reason "<text>"
 *   node AGENT-TEAM/scripts/objective-lease.mjs status
 *   node AGENT-TEAM/scripts/objective-lease.mjs notes [--clear]
 *   node AGENT-TEAM/scripts/objective-lease.mjs clear-stale --hours <n>
 *
 * Keys are the objectives' (README.md): run, record, loop, guard;
 * Clan's clan-run, clan-judge, clan-loop, clan-guard; the domain team's
 * clock and game; session for an interactive session.
 *
 * abort is the blocked-run exit: it releases the lease AND queues a note
 * for Jamie; note queues one without a lease. The Elixir Data Auditor
 * (then Keep the Record True) stalled on an ExpiredToken (2026-09-08),
 * held the lease, and blocked the next run the same morning: a run that
 * cannot do its job must not keep the lease hostage. Notes live beside
 * the lease in the common directory, so they outlive the run's worktree.
 *
 * clear-stale refuses young leases and a holder's worktree that still has
 * uncommitted changes; never infer staleness from age by hand, use this
 * command so the clear is recorded with proof.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OBJECTIVES = new Set([
  "run",
  "record",
  "loop",
  "guard",
  "clan-run",
  "clan-judge",
  "clan-loop",
  "clan-guard",
  "clock",
  "game",
  "session",
]);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const COMMON_DIR = path.resolve(
  REPO_ROOT,
  execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim(),
);
const LEASE_PATH = path.join(COMMON_DIR, "agent-team-objective-lease.json");
const NOTES_PATH = path.join(COMMON_DIR, "agent-team-queued-notes.jsonl");

function git(args, cwd = REPO_ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function assertObjective(objective) {
  if (!OBJECTIVES.has(objective)) {
    throw new Error(
      `unknown lease key ${JSON.stringify(objective)}; choose one of ${[...OBJECTIVES].join(", ")}`,
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
    worktree: git(["rev-parse", "--show-toplevel"]),
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
        `deploy lease is already held: ${JSON.stringify(readLease())}`,
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
  if (!current) throw new Error("deploy lease is not held");
  if (current.objective !== objective || current.leaseId !== leaseId) {
    throw new Error(
      `deploy lease belongs to another run: ${JSON.stringify({
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

/**
 * A blocked run's exit: hand the lease back and leave a note.
 *
 * Queued notes live OUTSIDE git (beside the lease, in the common git
 * directory) on purpose. A blocked run may have no credentials and be
 * mid-anything, and its worktree is discarded when it ends; preflight
 * prints the notes, so the next run and Jamie both see them.
 */
function queue(objective, reason, heldSince) {
  if (!reason)
    throw new Error("--reason is required: say what blocked the run");
  const note = {
    at: new Date().toISOString(),
    objective,
    reason: String(reason).slice(0, 500),
    ...(heldSince ? { heldSince } : {}),
    hostname: hostname(),
    needs: "Jamie",
  };
  appendFileSync(NOTES_PATH, `${JSON.stringify(note)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return note;
}

function abort(objective, leaseId, reason) {
  const current = assertOwner(objective, leaseId);
  if (!reason)
    throw new Error("--reason is required: say what blocked the run");
  if (git(["status", "--porcelain"])) {
    throw new Error(
      "worktree is DIRTY: an aborting run must not abandon uncommitted work " +
        "(its worktree is discarded when it ends). Push it to a PR branch first, " +
        "or Report to Jamie with the reason and leave the lease held.",
    );
  }
  const note = queue(objective, reason, current.claimedAt);
  unlinkSync(LEASE_PATH);
  return { released: current.leaseId, note };
}

function note(objective, reason) {
  assertObjective(objective);
  return queue(objective, reason);
}

/** Queued notes, newest last. --clear consumes them (a run that has
 *  transcribed them into docs/NOTES.md empties the queue). */
function notes(clear) {
  let queued = [];
  try {
    queued = readFileSync(NOTES_PATH, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (clear && queued.length > 0) unlinkSync(NOTES_PATH);
  return queued;
}

function clearStale(hours) {
  if (!Number.isFinite(hours) || hours <= 0)
    throw new Error("--hours must be a positive number");
  const current = readLease();
  if (!current) throw new Error("no deploy lease exists");
  const ageMs = Date.now() - Date.parse(current.claimedAt);
  if (!Number.isFinite(ageMs)) throw new Error("lease has no valid claimedAt");
  if (ageMs < hours * 3600_000)
    throw new Error(`lease is not yet ${hours} hours old`);
  // The holder's worktree, when it still exists; a lease from before
  // 2026-09-29 names none and was claimed in this checkout.
  const tree = current.worktree ?? REPO_ROOT;
  if (existsSync(tree) && git(["status", "--porcelain"], tree))
    throw new Error(
      `the holder's worktree ${tree} is dirty; a stale-looking lease over uncommitted work needs the manual inspected clear (see README)`,
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
    case "abort":
      console.log(
        JSON.stringify(abort(objective, arg("--lease-id"), arg("--reason"))),
      );
      break;
    case "note":
      console.log(JSON.stringify(note(objective, arg("--reason"))));
      break;
    case "notes":
      console.log(JSON.stringify(notes(process.argv.includes("--clear"))));
      break;
    case "status":
      console.log(JSON.stringify(readLease()));
      break;
    case "clear-stale":
      console.log(JSON.stringify(clearStale(Number(arg("--hours")))));
      break;
    default:
      console.error(
        "usage: objective-lease.mjs <claim|check|release|abort|note|status|notes|clear-stale> [key] [--lease-id id] [--reason text] [--hours n] [--clear]",
      );
      process.exit(2);
  }
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
