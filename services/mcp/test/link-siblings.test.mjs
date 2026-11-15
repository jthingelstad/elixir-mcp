/**
 * scripts/link-siblings.sh (#457): a worktree made away from the main
 * checkout gets its ../<repo> siblings as links, only repositories, and
 * never at the cost of anything already there. Scratch directories only.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/link-siblings.sh",
);

function layout(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "siblings-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projects = path.join(root, "projects");
  const repo = (name, git = "dir") => {
    const dir = path.join(projects, name);
    mkdirSync(dir, { recursive: true });
    if (git === "dir") mkdirSync(path.join(dir, ".git"));
    if (git === "file") writeFileSync(path.join(dir, ".git"), "gitdir: x\n");
    return dir;
  };
  const source = repo("elixir-mcp");
  repo("cr-agent-api-docs");
  repo("drop.poapkings.com", "file");
  repo("notes", "none"); // not a repository
  const worktree = path.join(root, "codex", "wt1", "elixir-mcp");
  mkdirSync(worktree, { recursive: true });
  return { root, projects, source, worktree, parent: path.dirname(worktree) };
}

const run = (source, worktree) =>
  spawnSync("bash", [SCRIPT, source, worktree], { encoding: "utf8" });

test("link-siblings: links each missing sibling repository beside the worktree", (t) => {
  const { projects, source, worktree, parent } = layout(t);
  const r = run(source, worktree);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(parent).sort(), [
    "cr-agent-api-docs",
    "drop.poapkings.com",
    "elixir-mcp",
  ]);
  for (const name of ["cr-agent-api-docs", "drop.poapkings.com"]) {
    assert.ok(lstatSync(path.join(parent, name)).isSymbolicLink(), name);
    assert.equal(
      readlinkSync(path.join(parent, name)),
      path.join(projects, name),
    );
  }
  // The worktree itself is never replaced by a link to the main checkout.
  assert.ok(lstatSync(worktree).isDirectory());
  assert.match(r.stdout, /linked 2 sibling repositories/);
});

test("link-siblings: idempotent, and never overwrites what is there", (t) => {
  const { source, worktree, parent } = layout(t);
  // A real checkout of one sibling, and another session's own link.
  mkdirSync(path.join(parent, "cr-agent-api-docs"));
  writeFileSync(path.join(parent, "cr-agent-api-docs", "mine"), "x");
  symlinkSync("/nowhere", path.join(parent, "drop.poapkings.com"));
  const r = run(source, worktree);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lstatSync(path.join(parent, "cr-agent-api-docs")).isDirectory());
  assert.deepEqual(readdirSync(path.join(parent, "cr-agent-api-docs")), [
    "mine",
  ]);
  assert.equal(
    readlinkSync(path.join(parent, "drop.poapkings.com")),
    "/nowhere",
  );
  assert.equal(r.stdout, "");

  rmSync(path.join(parent, "drop.poapkings.com"));
  assert.equal(run(source, worktree).status, 0);
  const before = readdirSync(parent).sort();
  const again = run(source, worktree);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, "");
  assert.deepEqual(readdirSync(parent).sort(), before);
});

test("link-siblings: a worktree beside the main checkout is left alone", (t) => {
  const { projects, source } = layout(t);
  const beside = path.join(projects, "elixir-mcp-wt");
  mkdirSync(beside);
  const before = readdirSync(projects).sort();
  const r = run(source, beside);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(projects).sort(), before);
});

test("link-siblings: worktree-setup.sh runs it before installing", () => {
  const setup = spawnSync(
    "grep",
    [
      "-n",
      "link-siblings.sh",
      path.join(path.dirname(SCRIPT), "worktree-setup.sh"),
    ],
    { encoding: "utf8" },
  );
  assert.match(
    setup.stdout,
    /bash "\$worktree\/scripts\/link-siblings\.sh" "\$source_tree" "\$worktree"/,
  );
});
