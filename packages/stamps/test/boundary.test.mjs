/**
 * Where Stamps never go (#1015, acceptance: "The feed and digest contain
 * no new Stamp items"; "No first-build MCP or /api/v1 Stamp fields").
 * Earning writes no account event, so nothing reaches the feed through
 * the record; this pins the other way in, a reader of the Stamp tables or
 * the package in code that builds the feed, the digest and other mail,
 * Discord posts, MCP tools or `/api/v1`. The bell, the passport routes,
 * the player page's row and the hooks are the readers by design.
 *
 * One way in is open since 2026-11-15 (Jamie: "if you follow an account
 * you should see their passport stamps"): the timeline's people items,
 * built in packages/tools but served only when a web caller asks
 * (buildTimeline's `people`: Home, the player and account pages), never
 * to MCP, the digest, RSS or Discord. ALLOWED names those files; the
 * tools package's people-items test pins that the timeline tool serves
 * none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const NEVER = [
  "services/web-api/src/feed.mjs",
  "services/web-api/src/routes/home.mjs",
  "services/web-api/src/routes/timeline-discord.mjs",
  "services/web-api/src/sign-in-api.mjs",
  "services/jobs/src",
  "services/timeline-sync/src",
  "services/email-relay/src",
  "services/mcp/src",
  "packages/mail/src",
  "packages/syndication/src",
  "packages/tools/src",
];

const ALLOWED = new Set([
  "packages/tools/src/activity/entries.mjs",
  "packages/tools/src/activity/schemas.mjs",
  "packages/tools/src/activity/summary.mjs",
]);

const READS_STAMPS =
  /account_stamp|stamp_earned|@elixir-mcp\/stamps|packages\/stamps/;

async function files(rel) {
  const abs = path.join(root, rel);
  let info;
  try {
    info = await stat(abs);
  } catch {
    return [];
  }
  if (info.isFile()) return [abs];
  const out = [];
  for (const entry of await readdir(abs, {
    withFileTypes: true,
    recursive: true,
  }))
    if (entry.isFile() && /\.(mjs|js|ts|json|sql)$/.test(entry.name))
      out.push(path.join(entry.parentPath, entry.name));
  return out;
}

test("the feed, mail, Discord, MCP and /api/v1 read no Stamp", async () => {
  let read = 0;
  const offenders = [];
  for (const rel of NEVER)
    for (const file of await files(rel)) {
      read += 1;
      if (
        READS_STAMPS.test(await readFile(file, "utf8")) &&
        !ALLOWED.has(path.relative(root, file))
      )
        offenders.push(path.relative(root, file));
    }
  // The paths are real: a rename must move this list, not empty it.
  assert.ok(read > 50, `only ${read} files read`);
  assert.deepEqual(offenders, []);
});

test("the paths it guards exist", async () => {
  for (const rel of NEVER) assert.ok((await files(rel)).length > 0, rel);
});
