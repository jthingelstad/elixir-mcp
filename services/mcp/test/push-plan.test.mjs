/**
 * validate's plan for a push to main (infra/scripts/lib/push-plan.mjs).
 * git and GitHub are stubs: main is HEAD on top of A, B, C (newest
 * first), and each test says which commits carry a green `validate`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BACK, pushPlan } from "../../../infra/scripts/lib/push-plan.mjs";

const REPO = "jthingelstad/elixir-mcp";
const HEAD = "f".repeat(40);
const PR_HEAD = "e".repeat(40);
const [A, B, C] = ["a", "b", "c"].map((c) => c.repeat(40));
const TREE = "1".repeat(40);

function world({
  green = [],
  pending = [HEAD],
  prTree = "2".repeat(40),
  diff = "packages/ledger/src/ledger.mjs",
  ancestors = [A, B, C],
  failApi = false,
} = {}) {
  const diffs = [];
  const git = (args) => {
    const [cmd, ...rest] = args;
    if (cmd === "fetch") return "";
    if (cmd === "rev-parse") return rest[0] === "HEAD^{tree}" ? TREE : HEAD; // HEAD and origin/main
    if (cmd === "rev-list") return ancestors.join("\n");
    if (cmd === "diff") {
      diffs.push(rest[1]);
      return diff;
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  const ghApi = async (p) => {
    if (failApi) throw new Error("HTTP 502\nmore");
    if (p.endsWith("/pulls"))
      return [{ merged_at: "2026-11-19T12:00:00Z", head: { sha: PR_HEAD } }];
    if (p.includes("/git/commits/")) return { tree: { sha: prTree } };
    const sha = /commits\/([0-9a-f]{40})\/check-runs/.exec(p)[1];
    if (green.includes(sha))
      return { check_runs: [{ status: "completed", conclusion: "success" }] };
    if (pending.includes(sha))
      return { check_runs: [{ status: "in_progress", conclusion: null }] };
    return { check_runs: [] };
  };
  const e2eNeeded = (paths) =>
    paths.split("\n").some((p) => p.startsWith("apps/web/"));
  return { git, ghApi, e2eNeeded, repo: REPO, diffs };
}

test("push plan: a tree already tested as a pull request head runs nothing more", async () => {
  const w = world({ green: [PR_HEAD], prTree: TREE });
  assert.deepEqual(await pushPlan(w), {
    run: false,
    e2e: false,
    why: `already tested as PR head ${PR_HEAD.slice(0, 8)}`,
  });
});

test("push plan: a green pull request head with another tree tests the combination", async () => {
  const w = world({ green: [PR_HEAD, A] });
  const plan = await pushPlan(w);
  assert.equal(plan.run, true);
  assert.equal(plan.e2e, false);
  assert.deepEqual(w.diffs, [A]);
});

test("push plan: the journeys run when what changed since the newest green commit reaches them", async () => {
  // A was never tested (its queued run was cancelled), so the diff is from B.
  const w = world({ green: [B, C], diff: "apps/web/src/home/home.js" });
  assert.deepEqual(await pushPlan(w), {
    run: true,
    e2e: true,
    why: `changes since green ${B.slice(0, 8)}`,
  });
  assert.deepEqual(w.diffs, [B]);
});

test("push plan: no green commit nearby, or any API error, tests it all", async () => {
  assert.deepEqual(await pushPlan(world()), {
    run: true,
    e2e: true,
    why: `no green commit in main's last ${MAX_BACK}`,
  });
  const failed = await pushPlan(world({ failApi: true }));
  assert.equal(failed.run, true);
  assert.equal(failed.e2e, true);
  assert.match(failed.why, /^could not tell \(HTTP 502\)$/);
});
