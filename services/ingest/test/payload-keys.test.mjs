import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  PAYLOAD_KEYS,
  payloadPaths,
  dispositionOf,
  expectedPaths,
} from "../src/payload-keys.mjs";
import { repoRoot } from "./helpers.mjs";

test("every manifest entry has exactly one disposition", () => {
  for (const [endpoint, fields] of Object.entries(PAYLOAD_KEYS)) {
    assert.ok(Object.keys(fields).length > 0, `${endpoint} is empty`);
    for (const [field, d] of Object.entries(fields)) {
      const kinds = ["to", "derived", "dropped"].filter(
        (k) => typeof d[k] === "string" && d[k].length > 0,
      );
      assert.equal(
        kinds.length,
        1,
        `${endpoint} ${field}: one of to/derived/dropped, got ${kinds.join("+") || "none"}`,
      );
    }
  }
});

test("every field of every fixture payload is named by the manifest", async () => {
  const root = path.join(repoRoot, "fixtures");
  const unnamed = [];
  let walked = 0;
  for (const endpoint of await readdir(root)) {
    const dir = path.join(root, endpoint);
    if (!(await stat(dir)).isDirectory()) continue;
    assert.ok(PAYLOAD_KEYS[endpoint], `no manifest for endpoint ${endpoint}`);
    for (const file of await readdir(dir)) {
      const payload = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      walked += 1;
      for (const p of payloadPaths(payload))
        if (!dispositionOf(endpoint, p)) unnamed.push(`${endpoint} ${p}`);
    }
  }
  assert.ok(walked >= 13, `walked ${walked} fixtures`);
  assert.deepEqual(
    unnamed,
    [],
    "a field the API sends with no disposition: name it in payload-keys.mjs, with where it lands or why not",
  );
});

test("the manifest's non-optional fields all appear in the fixtures they describe", async () => {
  // The inverse: an entry the fixtures never show is either optional
  // (marked) or a manifest typo. Endpoints without a fixture are
  // written from Appendix D and checked by the nightly census instead.
  const root = path.join(repoRoot, "fixtures");
  for (const endpoint of await readdir(root)) {
    const dir = path.join(root, endpoint);
    if (!(await stat(dir)).isDirectory()) continue;
    const seen = new Set();
    for (const file of await readdir(dir)) {
      const payload = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      for (const p of payloadPaths(payload)) seen.add(p);
    }
    const missing = expectedPaths(endpoint).filter((p) => !seen.has(p));
    assert.deepEqual(
      missing,
      [],
      `${endpoint}: manifest fields no fixture carries (mark optional or fix the path)`,
    );
  }
});

test("payloadPaths spells arrays, maps and scalar arrays the manifest's way", () => {
  const paths = payloadPaths({
    a: 1,
    b: [
      { c: 2, d: [3, 4] },
      { c: 5, d: [] },
    ],
    progress: { "": { t: 0 }, x_202609: { t: 1, arena: { id: 2 } } },
    e: {},
    f: null,
  });
  assert.deepEqual([...paths].sort(), [
    "a",
    "b[].c",
    "b[].d[]",
    "f",
    "progress.*.arena.id",
    "progress.*.t",
  ]);
});

test("a profile with no Path of Legends history sends the three season results as null, and the manifest names the null (feedback #67-#69)", () => {
  // The census walks a null as the bare path; each has a disposition.
  const paths = payloadPaths({
    currentPathOfLegendSeasonResult: null,
    lastPathOfLegendSeasonResult: null,
    bestPathOfLegendSeasonResult: null,
  });
  for (const p of paths) {
    const d = dispositionOf("player", p);
    assert.ok(d, `player.${p} has no disposition`);
    assert.ok(d.optional, `player.${p} is optional`);
    assert.match(d.to, /null when the player has no Path of Legends history/);
  }
});
