/**
 * The deploy record (infra/scripts/lib/deploy-record.mjs) and where
 * deploy.mjs takes the production lock. git and GitHub are stubs; the
 * structural checks read deploy.mjs's source, as infra-controls does.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_COMMITS,
  commentBody,
  commentOnPulls,
  deployHistoryKey,
  liveVersions,
  shippedCommits,
  shippedPulls,
} from "../../../infra/scripts/lib/deploy-record.mjs";

const REPO = "jthingelstad/elixir-mcp";
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

/** git with a linear history A..D; anything else fails like git does. */
function fakeGit({ history = [A, B, C, D], missing = [] } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    const [cmd, ...rest] = args;
    if (cmd === "fetch") return "";
    if (cmd === "cat-file") {
      const sha = rest[1].replace("^{commit}", "");
      if (missing.includes(sha) || !history.includes(sha))
        throw new Error("missing");
      return "";
    }
    if (cmd === "merge-base") {
      const [, from, to] = rest;
      if (history.indexOf(from) > history.indexOf(to))
        throw new Error("not an ancestor");
      return "";
    }
    if (cmd === "rev-list") {
      const [from, to] = rest[1].split("..");
      return history
        .slice(history.indexOf(from) + 1, history.indexOf(to) + 1)
        .join("\n");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git, calls };
}

test("deploy record: the commits this deploy shipped are those after the last deployed one", () => {
  const { git } = fakeGit();
  assert.deepEqual(shippedCommits({ git, from: A, to: D }), {
    ok: true,
    commits: [B, C, D],
  });
  assert.deepEqual(shippedCommits({ git, from: D, to: D }), {
    ok: true,
    commits: [],
  });
  // No record yet: nothing to compare with, so no comments this time.
  const first = shippedCommits({ git, from: null, to: D });
  assert.equal(first.ok, false);
  assert.match(first.reason, /no earlier deploy/);
  // A rollback, or a deploy off main: not a forward range.
  assert.match(
    shippedCommits({ git, from: D, to: B }).reason,
    /not an ancestor/,
  );
  // An unknown commit is fetched for once, then given up on.
  const lost = fakeGit({ missing: [A] });
  assert.match(
    shippedCommits({ git: lost.git, from: A, to: D }).reason,
    /not in this clone/,
  );
  assert.ok(lost.calls.includes("fetch --quiet origin"));
  // A range far past a normal deploy is not looked up commit by commit.
  const long = Array.from({ length: MAX_COMMITS + 2 }, (_, i) =>
    String(i).padStart(40, "0"),
  );
  assert.match(
    shippedCommits({
      git: fakeGit({ history: long }).git,
      from: long[0],
      to: long.at(-1),
    }).reason,
    /more than/,
  );
});

test("deploy record: commits map to the merged PRs into main that carry them, once each", async () => {
  const pullsFor = {
    [B]: [
      { number: 12, title: "two", merged_at: "t", base: { ref: "main" } },
      // A PR that carried the commit but never merged, or into a branch.
      { number: 9, title: "closed", merged_at: null, base: { ref: "main" } },
      { number: 8, title: "other", merged_at: "t", base: { ref: "x" } },
    ],
    [C]: [{ number: 12, title: "two", merged_at: "t", base: { ref: "main" } }],
    [D]: [{ number: 11, title: "one", merged_at: "t", base: { ref: "main" } }],
  };
  const asked = [];
  const pulls = await shippedPulls({
    ghApi: async (p) => {
      asked.push(p);
      return pullsFor[p.split("/")[4]] ?? [];
    },
    repo: REPO,
    commits: [B, C, D],
  });
  assert.deepEqual(asked, [
    `repos/${REPO}/commits/${B}/pulls`,
    `repos/${REPO}/commits/${C}/pulls`,
    `repos/${REPO}/commits/${D}/pulls`,
  ]);
  assert.deepEqual(pulls, [
    { number: 11, title: "one", commits: [D] },
    { number: 12, title: "two", commits: [B, C] },
  ]);
});

test("deploy record: the comment says when (UTC and Central), which commit, which versions, and acceptance", () => {
  const body = commentBody({
    repo: REPO,
    sha: D,
    deployedAt: "2026-10-10T20:15:00.000Z",
    lane: "platform",
    live: { contract: "11.7.2", api: "3.1.0" },
    declared: { contract: "11.7.2", api: "3.2.0" },
    acceptance: "passed (`--acceptance=clans`)",
    prCommits: [B, C],
  });
  assert.ok(body.startsWith(`<!-- elixir-deploy-record sha=${D} -->`));
  for (const part of [
    "2026-10-10T20:15:00Z",
    "2026-10-10 15:15:00 CDT",
    `https://github.com/${REPO}/commit/${D}`,
    "platform lane",
    "`bbbbbbbb`",
    "`cccccccc`",
    "MCP contract: 11.7.2\n",
    "JSON API: 3.1.0 (this commit declares 3.2.0)",
    "Acceptance: passed (`--acceptance=clans`)",
  ])
    assert.ok(body.includes(part), `${part} in\n${body}`);
  assert.match(
    commentBody({
      repo: REPO,
      sha: D,
      deployedAt: "2026-10-10T20:15:00Z",
      live: { contract: null, api: null },
      declared: { contract: "11.7.2", api: "3.1.0" },
      acceptance: "not run",
      prCommits: [D],
    }),
    /MCP contract: unknown \(could not read it live; this commit declares 11\.7\.2\)[\s\S]*Acceptance: not run/,
  );
});

test("deploy record: one comment per PR per deploy, and a failure only warns", async () => {
  const posted = [];
  const warnings = [];
  const existing = {
    11: [{ body: `<!-- elixir-deploy-record sha=${D} -->\nold` }],
    12: [{ body: `<!-- elixir-deploy-record sha=${C} -->` }, { body: "hi" }],
    13: "fail",
  };
  const result = await commentOnPulls({
    ghApi: async (p) => {
      const n = Number(p.match(/issues\/(\d+)\//)[1]);
      if (existing[n] === "fail") throw new Error("HTTP 502");
      return existing[n] ?? [];
    },
    ghPost: async (p, body) => posted.push([p, body.body]),
    repo: REPO,
    sha: D,
    pulls: [{ number: 11 }, { number: 12 }, { number: 13 }, { number: 14 }],
    bodyFor: (pr) => `body for #${pr.number}`,
    warn: (l) => warnings.push(l),
  });
  assert.deepEqual(result, {
    commented: [12, 14],
    skipped: [11],
    failed: [13],
  });
  assert.deepEqual(posted, [
    [`repos/${REPO}/issues/12/comments`, "body for #12"],
    [`repos/${REPO}/issues/14/comments`, "body for #14"],
  ]);
  assert.match(warnings.join("\n"), /#13: HTTP 502/);
});

test("deploy record: live versions come from the published site; a failed read is null", async () => {
  const seen = [];
  const live = await liveVersions({
    base: "https://e.example",
    fetch: async (url) => {
      seen.push(url);
      if (url.endsWith("/tools.json"))
        return { ok: true, json: async () => ({ contract_version: "11.7.2" }) };
      return { ok: false, json: async () => ({}) };
    },
  });
  assert.deepEqual(live, { contract: "11.7.2", api: null });
  assert.deepEqual(seen, [
    "https://e.example/tools.json",
    "https://e.example/docs/integration-api.json",
  ]);
  assert.deepEqual(
    await liveVersions({
      base: "https://e.example",
      fetch: async () => {
        throw new Error("offline");
      },
    }),
    { contract: null, api: null },
  );
  assert.equal(
    deployHistoryKey("2026-10-10T20:15:00.123Z", D),
    `deploys/history/2026-10-10T20-15-00-123Z-${D.slice(0, 12)}.json`,
  );
});

test("deploy.mjs takes the production lock after the CI gate, break-glass included, before anything is built or sent", async () => {
  const source = await readFile(
    new URL("../../../infra/scripts/deploy.mjs", import.meta.url),
    "utf8",
  );
  const gateEnd = source.indexOf("CI gate passed for");
  const lock = source.indexOf("acquireLock({");
  assert.ok(gateEnd > 0 && lock > gateEnd);
  for (const first of ["new STSClient(", "buildAll(", ".send(", "spawnSync("])
    assert.ok(lock < source.indexOf(first), first);
  // Not inside the break-glass branch: the gate's if/else has closed.
  const between = source.slice(source.indexOf("if (args.breakGlass)"), lock);
  const opens = (between.match(/{/g) ?? []).length;
  const closes = (between.match(/}/g) ?? []).length;
  assert.equal(opens, closes, "the lock is taken at the top level");
  // Held until the process ends, however it ends.
  assert.ok(source.indexOf("holdUntilExit(") > lock);
  // The record is written after the smoke and the acceptance gate.
  const record = source.indexOf("DEPLOY_RECORD_KEY, deployHistoryKey");
  assert.ok(record > source.indexOf("SMOKE FAILED"));
  assert.ok(record > source.indexOf("ACCEPTANCE FAILED"));
  assert.ok(record < source.indexOf("releaseLock();"));
});
