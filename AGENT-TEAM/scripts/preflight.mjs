import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read metadata directly: a busy checkout's lease helper may itself be edited.
function metadata(filename, fallback) {
  try {
    return readFileSync(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

/**
 * Edit eligibility for THIS checkout (WORKFLOW.md, "One worktree per
 * run"). A run's own linked worktree is eligible clean and at
 * origin/main, detached or on a fresh branch; the main checkout keeps the
 * older rule (clean, on main, in sync). The deploy lease no longer blocks
 * edits: it is reported, for the run that intends to deploy, from the
 * common git directory every worktree shares.
 */
export function inspectCheckout(root) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    }).trim();
  const reasons = [];
  const attempt = (label, ...args) => {
    try {
      return git(...args);
    } catch {
      reasons.push(label);
      return null;
    }
  };
  attempt("remote synchronization unknown", "fetch", "origin", "--prune");
  let gitDir = null;
  let commonDir = null;
  try {
    gitDir = path.resolve(root, git("rev-parse", "--git-dir"));
    commonDir = path.resolve(root, git("rev-parse", "--git-common-dir"));
  } catch {
    reasons.push("git metadata unknown");
  }
  const worktree = gitDir && gitDir !== commonDir ? "linked" : "main";
  let branch = null;
  try {
    branch = git("symbolic-ref", "--quiet", "--short", "HEAD");
  } catch {
    if (worktree === "main") reasons.push("detached HEAD");
  }
  if (worktree === "main" && branch && branch !== "main")
    reasons.push("not on main");
  if (worktree === "linked" && branch === "main")
    reasons.push("main is the main checkout's branch");
  const status = attempt("worktree state unknown", "status", "--porcelain");
  if (status) reasons.push("dirty worktree");
  if (worktree === "main") {
    const upstream = attempt(
      "upstream unknown",
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    );
    if (upstream && upstream !== "origin/main") reasons.push("wrong upstream");
  }
  const counts = attempt(
    "upstream comparison unknown",
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...origin/main",
  );
  if (counts) {
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    if (ahead) reasons.push("pre-existing commits ahead");
    if (behind) reasons.push("behind origin/main");
  }
  let deployLease = null;
  let queuedNotes = 0;
  if (commonDir) {
    try {
      deployLease = JSON.parse(
        metadata(
          path.join(commonDir, "agent-team-objective-lease.json"),
          "null",
        ),
      );
      const notes = metadata(
        path.join(commonDir, "agent-team-queued-notes.jsonl"),
        "",
      ).trim();
      queuedNotes = notes
        ? notes.split("\n").map((line) => JSON.parse(line)).length
        : 0;
    } catch {
      reasons.push("lease or queued-note metadata unreadable");
    }
  }
  return {
    worktree,
    mutation: reasons.length ? "blocked" : "eligible",
    reasons,
    deployLease: deployLease && {
      objective: deployLease.objective,
      claimedAt: deployLease.claimedAt,
      worktree: deployLease.worktree ?? null,
    },
    queuedNotes,
  };
}

async function publicStatus() {
  const response = await fetch(
    "https://elixir.poapkings.com/api/public/status",
    {
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error("public status unavailable");
  const data = await response.json();
  if (!data.health || typeof data.health.ok !== "boolean")
    throw new Error("invalid public status");
  return data.health;
}

export async function preflight(root, probe = publicStatus) {
  const checkout = inspectCheckout(root);
  try {
    const health = await probe();
    return { ...checkout, observation: "available", health };
  } catch {
    return { ...checkout, observation: "unavailable", health: null };
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const result = await preflight(root);
    console.log(
      `OBSERVATION=${result.observation} (public status only; other authorized reads may remain available)`,
    );
    console.log(
      `MUTATION=${result.mutation} (edit eligibility of this ${result.worktree === "linked" ? "run's worktree" : "main checkout"}; authority and deployment readiness are separate)`,
    );
    console.log(
      result.deployLease
        ? `DEPLOY_LEASE=held by ${result.deployLease.objective} since ${result.deployLease.claimedAt} (edits and PRs proceed; a deploy waits)`
        : "DEPLOY_LEASE=free",
    );
    console.log(JSON.stringify(result));
    if (result.queuedNotes)
      console.log(
        "Queued notes need review; transcribe them into docs/NOTES.md in a PR, then clear them.",
      );
    if (result.mutation === "blocked")
      console.log(
        result.worktree === "linked"
          ? "Continue safe read-only review with trusted tools; a clean worktree behind origin/main may `git checkout --detach origin/main` and preflight again. Never publish pre-existing work."
          : "Continue safe read-only review with trusted tools; do not mutate or publish pre-existing work. Scheduled runs edit in their own worktree, never here.",
      );
    process.exitCode = result.mutation === "blocked" ? 1 : 0;
  } catch {
    console.error(
      "Preflight could not run; checkout eligibility is unknown. Remain read-only.",
    );
    process.exitCode = 2;
  }
}
