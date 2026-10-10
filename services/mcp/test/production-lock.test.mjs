/**
 * The production lock (infra/scripts/lib/production-lock.mjs): one
 * holder, refused contention that names the holder, release by the
 * holder only, an abandoned lock reclaimed, and an exclusive create that
 * lets exactly one of many racing processes in.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireLock,
  describeHolder,
  lockFileFor,
  lockHolder,
  releaseLock,
  utcAndCentral,
} from "../../../infra/scripts/lib/production-lock.mjs";

const LIB = new URL(
  "../../../infra/scripts/lib/production-lock.mjs",
  import.meta.url,
).href;

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "prod-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, "elixir-production-lock.json") };
}

const quiet = { warn: () => {}, alive: () => true, hostname: "host-a" };

test("production lock: one holder; a second is refused and told who, since when, doing what, from where", (t) => {
  const { file } = scratch(t);
  const first = acquireLock({
    ...quiet,
    file,
    holder: "deploy",
    purpose: "deploy.mjs --acceptance=clans",
    worktree: "/w/one",
    head: "a".repeat(40),
    pid: 4242,
    now: () => new Date("2026-10-10T15:04:05.000Z"),
  });
  assert.equal(first.ok, true);
  for (const key of [
    "lock_id",
    "holder",
    "purpose",
    "pid",
    "hostname",
    "started_at",
    "worktree",
    "head",
  ])
    assert.ok(Object.hasOwn(first.lock, key), key);

  const second = acquireLock({
    ...quiet,
    file,
    holder: "op:vacuum",
    purpose: "a write",
  });
  assert.equal(second.ok, false);
  assert.equal(second.lock.lock_id, first.lock.lock_id);
  for (const part of [
    "deploy",
    "pid 4242 on host-a",
    "2026-10-10T15:04:05Z",
    "2026-10-10 10:04:05 CDT",
    "deploy.mjs --acceptance=clans",
    "/w/one",
    "aaaaaaaaaaaa",
  ])
    assert.ok(second.reason.includes(part), `${part} in ${second.reason}`);
  // The refused acquire leaves the holder's lock exactly as it was.
  assert.equal(lockHolder({ ...quiet, file }).lock_id, first.lock.lock_id);
});

test("production lock: only the holder releases it, and a second release is a no-op", (t) => {
  const { file } = scratch(t);
  const { lock } = acquireLock({
    ...quiet,
    file,
    holder: "deploy",
    purpose: "x",
  });
  assert.throws(
    () => releaseLock({ file, lockId: "someone-else" }),
    /not this holder's/,
  );
  assert.ok(existsSync(file));
  assert.equal(releaseLock({ file, lockId: lock.lock_id }), true);
  assert.equal(existsSync(file), false);
  assert.equal(releaseLock({ file, lockId: lock.lock_id }), false);
  assert.equal(
    acquireLock({ ...quiet, file, holder: "op:stats", purpose: "y" }).ok,
    true,
  );
});

test("production lock: a lock whose process is gone from this host is released with a warning; a live one never is", (t) => {
  const { file } = scratch(t);
  acquireLock({
    ...quiet,
    file,
    holder: "deploy",
    purpose: "crashed",
    pid: 999_999,
  });
  const dead = (pid) => pid !== 999_999;

  // Another host's lock: its pid means nothing here, so it stands.
  const elsewhere = acquireLock({
    file,
    holder: "deploy",
    purpose: "next",
    hostname: "host-b",
    alive: dead,
    warn: () => {},
  });
  assert.equal(elsewhere.ok, false);

  // A live pid stands.
  assert.equal(
    acquireLock({ ...quiet, file, holder: "deploy", purpose: "next" }).ok,
    false,
  );

  const warnings = [];
  const next = acquireLock({
    file,
    holder: "deploy",
    purpose: "next",
    hostname: "host-a",
    alive: dead,
    warn: (l) => warnings.push(l),
  });
  assert.equal(next.ok, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /abandoned lock/);
  assert.match(warnings[0], /crashed/);
  assert.equal(lockHolder({ ...quiet, file }).purpose, "next");

  // lockHolder reclaims the same way and then reads as free.
  releaseLock({ file, lockId: next.lock.lock_id });
  acquireLock({ ...quiet, file, holder: "deploy", purpose: "x", pid: 999_999 });
  assert.equal(
    lockHolder({ file, hostname: "host-a", alive: dead, warn: () => {} }),
    null,
  );
  assert.equal(existsSync(file), false);
});

test("production lock: holders are deploy or op:<name>, nothing looser", (t) => {
  const { file } = scratch(t);
  for (const holder of ["session", "run", "", "op:"])
    assert.throws(
      () => acquireLock({ ...quiet, file, holder, purpose: "x" }),
      /use deploy or op/,
    );
  assert.equal(readdirSync(path.dirname(file)).length, 0);
});

test("production lock: of many processes racing for it, exactly one gets it", async (t) => {
  const { dir, file } = scratch(t);
  const racers = 12;
  const child = `
    import { acquireLock } from ${JSON.stringify(LIB)};
    const r = acquireLock({ file: ${JSON.stringify(file)}, holder: "deploy",
      purpose: "race", alive: () => true, warn: () => {} });
    process.stdout.write(r.ok ? "won" : "lost");`;
  const results = await Promise.all(
    Array.from(
      { length: racers },
      () =>
        new Promise((resolve, reject) => {
          const p = spawn(
            process.execPath,
            ["--input-type=module", "-e", child],
            { stdio: ["ignore", "pipe", "inherit"] },
          );
          let out = "";
          p.stdout.on("data", (d) => (out += d));
          p.on("error", reject);
          p.on("close", () => resolve(out));
        }),
    ),
  );
  assert.equal(results.filter((r) => r === "won").length, 1, results.join());
  assert.equal(results.filter((r) => r === "lost").length, racers - 1);
  // No temporary file is left beside the lock.
  assert.deepEqual(readdirSync(dir), [path.basename(file)]);
});

test("production lock: released when the holding process exits, by process.exit or by SIGTERM", async (t) => {
  const { file } = scratch(t);
  const run = (tail) =>
    new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { acquireLock, holdUntilExit } from ${JSON.stringify(LIB)};
           const r = acquireLock({ file: ${JSON.stringify(file)}, holder: "deploy", purpose: "x", warn: () => {} });
           if (!r.ok) process.exit(9);
           holdUntilExit({ file: ${JSON.stringify(file)}, lock: r.lock, log: () => {} });
           process.stdout.write("held\\n");
           ${tail}`,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      p.stdout.on("data", () => {
        assert.ok(existsSync(file));
        if (tail.includes("setInterval")) p.kill("SIGTERM");
      });
      p.on("close", (code, signal) => resolve({ code, signal }));
    });
  assert.equal((await run("process.exit(1);")).code, 1);
  assert.equal(existsSync(file), false);
  assert.equal((await run("setInterval(() => {}, 1000);")).code, 143);
  assert.equal(existsSync(file), false);
  assert.equal((await run("throw new Error('boom');")).code, 1);
  assert.equal(existsSync(file), false);
});

test("production lock: the main checkout and its worktrees share one lock file", (t) => {
  const { dir } = scratch(t);
  const repo = path.join(dir, "repo");
  const git = (cwd, ...a) =>
    execFileSync("git", a, { cwd, encoding: "utf8", stdio: "pipe" });
  execFileSync("git", ["init", "-q", repo]);
  git(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "x",
  );
  git(repo, "worktree", "add", "-q", path.join(dir, "wt"));
  const main = lockFileFor(repo);
  assert.equal(lockFileFor(path.join(dir, "wt")), main);
  assert.equal(path.basename(main), "elixir-production-lock.json");
  assert.equal(path.basename(path.dirname(main)), ".git");
});

test("production lock: times read in UTC and US Central", () => {
  assert.equal(
    utcAndCentral("2026-01-15T18:00:00.000Z"),
    "2026-01-15T18:00:00Z (2026-01-15 12:00:00 CST)",
  );
  assert.equal(
    utcAndCentral("2026-10-10T04:30:00Z"),
    "2026-10-10T04:30:00Z (2026-10-09 23:30:00 CDT)",
  );
  assert.match(
    describeHolder({
      holder: "op:vacuum",
      pid: 1,
      hostname: "h",
      started_at: "2026-10-10T04:30:00Z",
      purpose: "p",
      worktree: "/w",
      head: null,
    }),
    /op:vacuum[\s\S]*CDT[\s\S]*doing p[\s\S]*from \/w at unknown/,
  );
});
