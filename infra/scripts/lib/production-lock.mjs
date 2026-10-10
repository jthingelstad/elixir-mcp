/**
 * The production lock (working model, 2026-10-10): one holder at a time
 * for anything that writes to Elixir's production, taken in code by the
 * writers themselves (deploy.mjs, and `npm run op` for a write op), so it
 * no longer depends on a session remembering to claim a lease. It
 * replaces AGENT-TEAM/scripts/objective-lease.mjs: no objective keys, no
 * queued notes, no clear-stale and no force flag.
 *
 * The lock is one JSON file in the clone's COMMON git directory
 * (`git rev-parse --git-common-dir`), so the main checkout and every
 * linked worktree see the same one. It is created by linking a fully
 * written temporary file into place: link(2) fails with EEXIST when the
 * name exists, like an O_EXCL open, and a reader never sees a lock that
 * is half written.
 *
 * A lock whose process is gone from this host is released with a warning
 * on the next acquire, so a crashed or killed deploy never wedges the
 * next one. A live holder's lock is never taken, and only the holder
 * (the same lock_id) releases it. Everything here is synchronous so the
 * release can run in a process 'exit' handler, the one place that also
 * sees process.exit().
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  linkSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname as osHostname } from "node:os";
import path from "node:path";

export const LOCK_FILE = "elixir-production-lock.json";

/** The lock file for the clone that holds `cwd`, in its common git
 *  directory. */
export function lockFileFor(cwd) {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  // Real path: one clone reached through a symlink is still one lock.
  return path.join(realpathSync(path.resolve(cwd, common)), LOCK_FILE);
}

/** Whether a process with this pid exists on this host. EPERM means it
 *  exists but belongs to someone else. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const central = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

/** "2026-10-10T15:04:05Z (2026-10-10 10:04:05 CDT)": stored UTC, read
 *  in US Central. */
export function utcAndCentral(when) {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return String(when);
  const parts = Object.fromEntries(
    central.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${d.toISOString().replace(/\.\d{3}Z$/, "Z")} (${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second} ${parts.timeZoneName})`;
}

/** Who holds the lock, in one paragraph a person can act on. */
export function describeHolder(lock) {
  return [
    `held by ${lock.holder} (pid ${lock.pid} on ${lock.hostname})`,
    `  since ${utcAndCentral(lock.started_at)}`,
    `  doing ${lock.purpose}`,
    `  from ${lock.worktree} at ${String(lock.head ?? "unknown").slice(0, 12)}`,
  ].join("\n");
}

function readLock(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    // Never written by this module (it links a complete file): someone
    // edited it by hand. Refuse rather than guess who holds it.
    throw new Error(
      `the production lock ${file} is not JSON; read it and remove it by hand only if nothing is writing to production`,
    );
  }
}

/** A lock its process left behind: on this host, and the pid is gone. */
function abandoned(lock, host, alive) {
  return lock.hostname === host && !alive(lock.pid);
}

/**
 * Remove an abandoned lock, guarded so two acquirers that both saw it
 * cannot remove a fresh lock the other made in between: the guard is an
 * exclusive create, and under it the lock is read again and removed only
 * if it is still the abandoned one. A guard older than a minute is from
 * a process that died inside these few synchronous calls.
 */
function reclaim(file, lockId) {
  const guard = `${file}.reclaim`;
  try {
    writeFileSync(guard, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      if (Date.now() - statSync(guard).mtimeMs > 60_000) unlinkSync(guard);
    } catch {
      // Gone already: the other reclaimer finished.
    }
    return false;
  }
  try {
    const now = readLock(file);
    if (now?.lock_id !== lockId) return false;
    unlinkSync(file);
    return true;
  } finally {
    unlinkSync(guard);
  }
}

/**
 * Take the lock, or say who has it.
 *
 * @param {{ file: string, holder: string, purpose: string,
 *   worktree?: string, head?: string, pid?: number, hostname?: string,
 *   now?: () => Date, alive?: (pid: number) => boolean,
 *   warn?: (line: string) => void }} options
 * @returns {{ ok: true, lock: object } | { ok: false, lock: object, reason: string }}
 */
export function acquireLock({
  file,
  holder,
  purpose,
  worktree = process.cwd(),
  head = null,
  pid = process.pid,
  hostname = osHostname(),
  now = () => new Date(),
  alive = pidAlive,
  warn = (line) => console.warn(line),
}) {
  if (!/^(deploy|op:[\w+.-]+)$/.test(holder))
    throw new Error(
      `production lock holder ${JSON.stringify(holder)}: use deploy or op:<name>`,
    );
  const lock = {
    lock_id: randomUUID(),
    holder,
    purpose: String(purpose),
    pid,
    hostname,
    started_at: now().toISOString(),
    worktree,
    head,
  };
  const tmp = `${file}.${lock.lock_id}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  try {
    // A reclaim and a racing acquire can each cost one pass; a handful
    // is plenty, and a lock still in the way after them is a live one.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        linkSync(tmp, file);
        return { ok: true, lock };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      const current = readLock(file);
      if (!current) continue; // released between the link and the read
      if (abandoned(current, hostname, alive)) {
        if (reclaim(file, current.lock_id))
          warn(
            `production lock: released an abandoned lock (its process is gone):\n${describeHolder(current)}`,
          );
        continue;
      }
      return {
        ok: false,
        lock: current,
        reason: `production is locked; ${describeHolder(current)}\nWait for it to finish. A lock is released by its holder, or automatically once its process has exited.`,
      };
    }
    const current = readLock(file);
    return {
      ok: false,
      lock: current,
      reason: current
        ? `production is locked; ${describeHolder(current)}`
        : "production lock: could not take the lock after several tries; try again",
    };
  } finally {
    unlinkSync(tmp);
  }
}

/** The live holder, or null. An abandoned lock is released on the way
 *  (with the same warning acquire prints) and reads as free. */
export function lockHolder({
  file,
  hostname = osHostname(),
  alive = pidAlive,
  warn = (line) => console.warn(line),
}) {
  const current = readLock(file);
  if (!current) return null;
  if (abandoned(current, hostname, alive)) {
    if (reclaim(file, current.lock_id))
      warn(
        `production lock: released an abandoned lock (its process is gone):\n${describeHolder(current)}`,
      );
    const after = readLock(file);
    return after && !abandoned(after, hostname, alive) ? after : null;
  }
  return current;
}

/**
 * Release the lock this holder took. Refuses (throws) when the lock is
 * someone else's; a lock already gone is a no-op, so a release in both a
 * finally and an exit handler is safe.
 *
 * @returns {boolean} true when this call removed the lock
 */
export function releaseLock({ file, lockId }) {
  const current = readLock(file);
  if (!current) return false;
  if (current.lock_id !== lockId)
    throw new Error(
      `production lock: not released, it is not this holder's; ${describeHolder(current)}`,
    );
  unlinkSync(file);
  return true;
}

/**
 * Hold the lock until this process ends, however it ends: a normal
 * finish, process.exit() (deploy.mjs exits from a dozen places, which a
 * finally block never sees), an uncaught error, or SIGINT, SIGTERM and
 * SIGHUP. Returns release(), which is idempotent.
 */
export function holdUntilExit({ file, lock, log = (l) => console.error(l) }) {
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    try {
      if (releaseLock({ file, lockId: lock.lock_id }))
        log(`production lock released (${lock.holder}).`);
    } catch (error) {
      log(String(error?.message ?? error));
    }
  };
  process.on("exit", release);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ])
    process.on(signal, () => {
      log(
        `${signal}: stopping and releasing the production lock. Work already sent to AWS (a stack update, a running migration) carries on there; check it before the next write.`,
      );
      release();
      process.exit(code);
    });
  return release;
}
