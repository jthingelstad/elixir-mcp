/**
 * The catalog is one source of truth: the code's eleven definitions match
 * the design's catalog.json field for field, ids are stable and unique,
 * ladders climb, and the module imports nothing (so the web app can take
 * it without server code).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_VERSION,
  FACT_CAPS,
  PROFILE_STEPS,
  STAMPS,
  STAMP_IDS,
  levelFor,
  stampById,
} from "../src/catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

test("the code catalog matches the design catalog field for field", async () => {
  const design = JSON.parse(
    await readFile(
      path.join(root, "docs/design/passport/catalog.json"),
      "utf8",
    ),
  );
  assert.equal(STAMPS.length, 11);
  assert.deepEqual(
    STAMP_IDS,
    design.map((d) => d.id),
  );
  for (const d of design) {
    const code = stampById(d.id);
    for (const [key, value] of Object.entries(d))
      assert.deepEqual(code[key], value, `${d.id}.${key}`);
    assert.equal(code.optional, d.optional === true, `${d.id}.optional`);
  }
});

test("ladders and caps are the specified ones", () => {
  assert.equal(CATALOG_VERSION, 1);
  assert.deepEqual(stampById("played_together").thresholds, [1, 5, 20]);
  assert.deepEqual(stampById("cheerleader").thresholds, [3, 15, 50]);
  assert.deepEqual(stampById("storyteller").thresholds, [1, 5, 20]);
  assert.deepEqual(FACT_CAPS, {
    played_together: 20,
    cheerleader: 50,
    storyteller: 20,
  });
  for (const s of STAMPS)
    for (let i = 1; i < s.thresholds.length; i++)
      assert.ok(s.thresholds[i] > s.thresholds[i - 1], s.id);
  assert.equal(new Set(STAMP_IDS).size, STAMP_IDS.length);
  for (const id of STAMP_IDS) assert.match(id, /^[a-z][a-z_]{2,31}$/);
});

test("levelFor counts thresholds reached", () => {
  assert.equal(levelFor("cheerleader", 2), 0);
  assert.equal(levelFor("cheerleader", 3), 1);
  assert.equal(levelFor("cheerleader", 49), 2);
  assert.equal(levelFor("cheerleader", 50), 3);
  assert.equal(levelFor("cheerleader", 500), 3);
  assert.equal(levelFor("mutual", 1), 1);
  assert.equal(levelFor("nope", 9), 0);
});

test("the profile list is the six specified steps", () => {
  assert.deepEqual(
    PROFILE_STEPS.map((s) => s.id),
    [
      "add_player",
      "verify_player",
      "picture",
      "follow_active",
      "digest",
      "map",
    ],
  );
});

test("the catalog module imports nothing, so a browser can take it", async () => {
  const src = await readFile(path.join(here, "../src/catalog.mjs"), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\bDate\.now\(|new Date\(|process\./);
});

test("definitions are frozen", () => {
  assert.throws(() => {
    STAMPS[0].name = "Changed";
  }, TypeError);
  assert.throws(() => {
    STAMPS[8].thresholds.push(99);
  }, TypeError);
});
