import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The Elixir Data Auditor (then Keep the Record True) stalled on an
 * ExpiredToken (2026-09-08), held the `record` lease, and blocked the next
 * run the same morning. A run that cannot do its job must hand the lease
 * back and leave a note.
 *
 * The script derives its repo root from its own location, so each test
 * drives a COPY inside a scratch git repo: the suite must never depend on
 * this checkout being clean (it is not, mid-change) and must never touch
 * a lease a real session is holding.
 */
function scratchRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "elixir-lease-"));
  mkdirSync(path.join(root, "AGENT-TEAM", "scripts"), { recursive: true });
  copyFileSync(
    path.join(here, "objective-lease.mjs"),
    path.join(root, "AGENT-TEAM", "scripts", "objective-lease.mjs"),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(path.join(root, "README.md"), "scratch\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const script = path.join(
    root,
    "AGENT-TEAM",
    "scripts",
    "objective-lease.mjs",
  );
  const at = (cwd) => ({
    run: (...args) =>
      JSON.parse(
        execFileSync(
          "node",
          [
            path.join(cwd, "AGENT-TEAM", "scripts", "objective-lease.mjs"),
            ...args,
          ],
          { cwd, encoding: "utf8" },
        ),
      ),
    fails: (...args) => {
      try {
        execFileSync(
          "node",
          [
            path.join(cwd, "AGENT-TEAM", "scripts", "objective-lease.mjs"),
            ...args,
          ],
          { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        return null;
      } catch (err) {
        return String(err.stderr ?? "");
      }
    },
  });
  return {
    root,
    git,
    at,
    run: (...args) =>
      JSON.parse(
        execFileSync("node", [script, ...args], {
          cwd: root,
          encoding: "utf8",
        }),
      ),
    fails: (...args) => {
      try {
        execFileSync("node", [script, ...args], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return null;
      } catch (err) {
        return String(err.stderr ?? "");
      }
    },
    dirty: () => writeFileSync(path.join(root, "uncommitted.txt"), "work\n"),
    clean: () => rmSync(path.join(root, "uncommitted.txt"), { force: true }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("abort releases the lease and queues a note for Jamie", () => {
  const repo = scratchRepo();
  try {
    const claimed = repo.run("claim", "record");
    assert.equal(claimed.objective, "record");

    // A reason is mandatory: "it broke" with no detail helps nobody.
    assert.match(
      repo.fails("abort", "record", "--lease-id", claimed.leaseId),
      /--reason is required/,
    );
    // Another objective's name cannot abort this lease.
    assert.match(
      repo.fails(
        "abort",
        "loop",
        "--lease-id",
        claimed.leaseId,
        "--reason",
        "x",
      ),
      /belongs to another run/,
    );

    const aborted = repo.run(
      "abort",
      "record",
      "--lease-id",
      claimed.leaseId,
      "--reason",
      "ExpiredToken on --profile jamie",
    );
    assert.equal(aborted.released, claimed.leaseId);
    assert.equal(aborted.note.objective, "record");
    assert.match(aborted.note.reason, /ExpiredToken/);
    assert.equal(aborted.note.needs, "Jamie");

    // The lease is genuinely gone, so the next objective is not blocked.
    assert.equal(repo.run("status"), null);
    const next = repo.run("claim", "loop");
    assert.equal(next.objective, "loop");
    repo.run("release", "loop", "--lease-id", next.leaseId);

    // The note survives for preflight to print, and clears on demand.
    const queued = repo.run("notes");
    assert.equal(queued.length, 1);
    assert.match(queued[0].reason, /ExpiredToken/);
    assert.equal(queued[0].heldSince, claimed.claimedAt);
    assert.deepEqual(repo.run("notes", "--clear"), queued);
    assert.deepEqual(repo.run("notes"), []);
  } finally {
    repo.dispose();
  }
});

test("abort refuses to abandon uncommitted work", () => {
  const repo = scratchRepo();
  try {
    const claimed = repo.run("claim", "guard");
    repo.dirty();
    const err = repo.fails(
      "abort",
      "guard",
      "--lease-id",
      claimed.leaseId,
      "--reason",
      "ExpiredToken",
    );
    assert.match(err, /DIRTY/);
    assert.match(err, /PR branch/);
    assert.match(err, /Report to Jamie/);
    // Still held: a dirty checkout keeps its owner, and nothing is queued.
    assert.equal(repo.run("status").leaseId, claimed.leaseId);
    assert.deepEqual(repo.run("notes"), []);

    repo.clean();
    const aborted = repo.run(
      "abort",
      "guard",
      "--lease-id",
      claimed.leaseId,
      "--reason",
      "ExpiredToken",
    );
    assert.equal(aborted.released, claimed.leaseId);
  } finally {
    repo.dispose();
  }
});

test("a second claim is refused while a lease is held", () => {
  const repo = scratchRepo();
  try {
    const first = repo.run("claim", "run");
    assert.match(repo.fails("claim", "loop"), /already held/);
    repo.run("release", "run", "--lease-id", first.leaseId);
    const second = repo.run("claim", "loop");
    repo.run("release", "loop", "--lease-id", second.leaseId);
  } finally {
    repo.dispose();
  }
});

test("every worktree of the clone shares one lease and one notes queue", () => {
  const repo = scratchRepo();
  const wt = mkdtempSync(path.join(tmpdir(), "elixir-lease-wt-"));
  try {
    repo.git("worktree", "add", "--quiet", "--detach", path.join(wt, "run"));
    const other = repo.at(path.join(wt, "run"));
    const held = repo.run("claim", "session");
    assert.match(other.fails("claim", "run"), /already held/);
    assert.equal(other.run("status").leaseId, held.leaseId);
    repo.run("release", "session", "--lease-id", held.leaseId);

    const mine = other.run("claim", "clan-run");
    assert.equal(mine.worktree, path.join(realpathSync(wt), "run"));
    assert.equal(repo.run("status").objective, "clan-run");
    other.run("release", "clan-run", "--lease-id", mine.leaseId);

    // A blocked run with no lease still leaves a note, and it outlives
    // the worktree it was written from.
    assert.match(other.fails("note", "clock"), /--reason is required/);
    assert.match(other.fails("note", "nobody", "--reason", "x"), /unknown/);
    other.run("note", "clock", "--reason", "war_current unreadable");
    repo.git("worktree", "remove", "--force", path.join(wt, "run"));
    const queued = repo.run("notes");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].objective, "clock");
    assert.equal(queued[0].heldSince, undefined);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    repo.dispose();
  }
});

test("clear-stale judges the holder's worktree, not the one it runs from", () => {
  const repo = scratchRepo();
  const wt = mkdtempSync(path.join(tmpdir(), "elixir-lease-wt-"));
  try {
    const holder = path.join(wt, "holder");
    repo.git("worktree", "add", "--quiet", "--detach", holder);
    const lease = path.join(
      repo.root,
      ".git",
      "agent-team-objective-lease.json",
    );
    writeFileSync(
      lease,
      JSON.stringify({
        objective: "record",
        leaseId: "old",
        claimedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
        worktree: holder,
      }),
    );
    assert.match(repo.fails("clear-stale", "--hours", "72"), /not yet 72/);
    writeFileSync(path.join(holder, "uncommitted.txt"), "work\n");
    assert.match(repo.fails("clear-stale", "--hours", "24"), /holder.*dirty/);
    rmSync(holder, { recursive: true, force: true });
    assert.equal(repo.run("clear-stale", "--hours", "24").leaseId, "old");
    assert.equal(repo.run("status"), null);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    repo.dispose();
  }
});
