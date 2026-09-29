import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { preflight } from "./preflight.mjs";

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-preflight-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (root, ...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git(dir, "init", "--bare", "--initial-branch=main", "origin");
  git(dir, "clone", path.join(dir, "origin"), "work");
  const root = path.join(dir, "work");
  const run = (...args) => git(root, ...args);
  run("config", "user.name", "fixture");
  run("config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(root, "README.md"), "fixture\n");
  run("add", ".");
  run("commit", "-m", "fixture");
  run("push", "-u", "origin", "main");
  return { root, git: run };
}
const healthy = async () => ({ ok: true });

test("clean synchronized main is eligible; unavailable health is a separate finding", async (t) => {
  const { root } = fixture(t);
  assert.equal((await preflight(root, healthy)).mutation, "eligible");
  const r = await preflight(root, async () => {
    throw new Error("offline");
  });
  assert.equal(r.observation, "unavailable");
  assert.equal(r.mutation, "eligible");
});

test("a held deploy lease is reported, not a block; a dirty helper blocks without executing", async (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, "AGENT-TEAM/scripts"), { recursive: true });
  writeFileSync(
    path.join(root, "AGENT-TEAM/scripts/objective-lease.mjs"),
    'throw new Error("must never execute dirty helper");',
  );
  writeFileSync(
    path.join(root, ".git/agent-team-objective-lease.json"),
    JSON.stringify({ objective: "record", claimedAt: "2026-09-29T11:00:00Z" }),
  );
  let observed = false;
  const r = await preflight(root, async () => {
    observed = true;
    return { ok: true };
  });
  assert.equal(observed, true);
  assert.equal(r.observation, "available");
  assert.equal(r.mutation, "blocked");
  assert.deepEqual(r.reasons, ["dirty worktree"]);
  assert.equal(r.deployLease.objective, "record");
});

function linked(t, git) {
  const tree = mkdtempSync(path.join(tmpdir(), "mcp-preflight-wt-"));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const wt = path.join(tree, "work");
  git("worktree", "add", "--quiet", "--detach", wt, "origin/main");
  return wt;
}

test("a run's own worktree, detached at origin/main, is eligible and sees the shared deploy lease", async (t) => {
  const { root, git } = fixture(t);
  writeFileSync(
    path.join(root, ".git/agent-team-objective-lease.json"),
    JSON.stringify({ objective: "run", claimedAt: "2026-09-29T11:00:00Z" }),
  );
  writeFileSync(
    path.join(root, ".git/agent-team-queued-notes.jsonl"),
    `${JSON.stringify({ objective: "record", reason: "ExpiredToken" })}\n`,
  );
  const wt = linked(t, git);
  const r = await preflight(wt, healthy);
  assert.equal(r.worktree, "linked");
  assert.equal(r.mutation, "eligible");
  assert.equal(r.deployLease.objective, "run");
  assert.equal(r.queuedNotes, 1);
  // A fresh branch for the run's PR is still eligible.
  execFileSync("git", ["switch", "--quiet", "-c", "record/fix"], { cwd: wt });
  assert.equal((await preflight(wt, healthy)).mutation, "eligible");
});

for (const state of ["dirty", "ahead", "behind"]) {
  test(`a run's own worktree that is ${state} is blocked`, async (t) => {
    const { root, git } = fixture(t);
    const wt = linked(t, git);
    const inWt = (...args) =>
      execFileSync("git", args, { cwd: wt, encoding: "utf8", stdio: "pipe" });
    if (state === "dirty") writeFileSync(path.join(wt, "README.md"), "x\n");
    if (state === "ahead") {
      writeFileSync(path.join(wt, "README.md"), "x\n");
      inWt("commit", "-qam", "earlier run's work");
    }
    if (state === "behind") {
      writeFileSync(path.join(root, "README.md"), "moved\n");
      git("commit", "-qam", "main moved");
      git("push", "-q");
    }
    const r = await preflight(wt, healthy);
    assert.equal(r.worktree, "linked");
    assert.equal(r.mutation, "blocked");
  });
}

for (const state of [
  "ahead",
  "behind",
  "detached",
  "wrong-branch",
  "no-upstream",
  "fetch-failure",
  "bad-lease",
]) {
  test(`${state} cannot permit mutation or suppress independent observation`, async (t) => {
    const { root, git } = fixture(t);
    if (state === "ahead" || state === "behind") {
      writeFileSync(path.join(root, "README.md"), "changed\n");
      git("add", ".");
      git("commit", "-m", "change");
      if (state === "behind") {
        git("push");
        git("reset", "--hard", "HEAD~1");
      }
    }
    if (state === "detached") git("checkout", "--detach");
    if (state === "wrong-branch") git("checkout", "-b", "other");
    if (state === "no-upstream") git("branch", "--unset-upstream");
    if (state === "fetch-failure")
      git("remote", "set-url", "origin", path.join(root, "missing"));
    if (state === "bad-lease")
      writeFileSync(
        path.join(root, ".git/agent-team-objective-lease.json"),
        "invalid json",
      );
    const r = await preflight(root, healthy);
    assert.equal(r.mutation, "blocked");
    assert.equal(r.observation, "available");
  });
}
