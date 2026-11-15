/**
 * #512: one ORDER BY for a player's latest snapshot row, and no reader
 * with its own. The behaviour against real ingest is pinned in
 * packages/tools/test/latest-snapshot.test.mjs and the web-api route
 * tests; this file pins the fragment and keeps the old orderings out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { latestSnapshotOrder } from "../src/latest-snapshot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

test("the fragment: date for the index, then the stamp, then daily", () => {
  assert.equal(
    latestSnapshotOrder(),
    "snapshot_date desc, observed_at desc nulls last, snapshot_kind = 'daily' desc",
  );
  assert.equal(
    latestSnapshotOrder({ alias: "s", stamp: "profile_observed_at" }),
    "s.snapshot_date desc, s.profile_observed_at desc nulls last, s.snapshot_kind = 'daily' desc",
  );
  assert.throws(() => latestSnapshotOrder({ stamp: "snapshot_kind" }));
  assert.throws(() => latestSnapshotOrder({ alias: "s; drop" }));
});

async function* sources(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "test")
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(mjs|js|jsx|ts)$/.test(e.name)) yield p;
  }
}

test("no reader orders snapshots by kind name or keeps its own latest order", async () => {
  const offenders = [];
  for (const top of ["packages", "services", "apps"]) {
    for await (const file of sources(path.join(root, top))) {
      if (file.endsWith(path.join("record", "src", "latest-snapshot.mjs")))
        continue;
      const text = await readFile(file, "utf8");
      if (
        /snapshot_kind\s+desc/.test(text) ||
        /snapshot_date\s+desc\s*,\s*(\w+\.)?(profile_|roster_)?observed_at\s+desc/.test(
          text,
        )
      )
        offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "use latestSnapshotOrder (@elixir-mcp/record/latest-snapshot)",
  );
});
