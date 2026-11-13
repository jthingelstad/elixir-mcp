/**
 * The real-tag ratchet: no real player's tag in this public repository,
 * except King Thing and POAP KINGS, and until the captured ones are
 * replaced, never more of them than today. What counts as a tag, and why,
 * is `infra/scripts/lib/no-real-tags.mjs`. Every tag in this file is
 * invented and listed in `docs/invented-tags.json`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  NAMED_TAGS,
  PINNED_FILES,
  allowedTags,
  census,
  compare,
  countIn,
  lowered,
  tagsIn,
} from "../infra/scripts/lib/no-real-tags.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const none = new Set();

test("a bare tag counts once, in canonical form", () => {
  assert.deepEqual(
    [...tagsIn("seen #0PYLQ2, then #0pylq2 and #oPYLQ2")],
    ["#0PYLQ2"],
  );
  assert.deepEqual([...tagsIn("/home/player/%230GRJCUV")], ["#0GRJCUV"]);
  assert.equal(countIn("#0PYLQ2 #0GRJCUV #0PYLQ2", none), 2);
});

test("colours, issue numbers, anchors and entities are not tags", () => {
  for (const text of [
    "color: #000; background: #2c2c2c; border: #fff #C0C0C0 #28c",
    "fixed in #868 and PR #2089",
    "see [the rules](#url) and #color and #glory",
    "&#8212; and &#x2C;",
    "word#0PYLQ2 and #0PYLQ2-suffix and a-#0PYLQ2",
    "#0PYLQ2X is too wide an alphabet; #PY is too short",
  ])
    assert.deepEqual([...tagsIn(text)], [], text);
});

test("a lower-case token counts only with a digit", () => {
  assert.deepEqual([...tagsIn("#0q2l8")], ["#0Q2L8"]);
  assert.deepEqual([...tagsIn("#pully")], []);
});

test("a keyed value counts with or without its #, hex or not", () => {
  const json = JSON.stringify({
    tag: "0YY9P",
    player_tag: "#0LUVR2",
    clanTag: "#0C2C8",
    eventTag: "#0Q2L8",
    name: "#0GRJCUV is in a name, so it still counts as bare",
    title: "abc",
  });
  assert.deepEqual(
    [...tagsIn(json)].sort(),
    ["#0C2C8", "#0GRJCUV", "#0LUVR2", "#0Q2L8", "#0YY9P"].sort(),
  );
  assert.deepEqual([...tagsIn("{ tag: 'not a tag' }")], []);
  // Codex on #882: a multi-word snake_case key, value without its #.
  assert.deepEqual(
    [...tagsIn('{"previous_player_tag":"0PYLQ2"}')],
    ["#0PYLQ2"],
  );
  assert.deepEqual(
    [...tagsIn('{"participant_clan_tag": "0LUVR2"}')],
    ["#0LUVR2"],
  );
});

test("the two named tags and the invented list are allowed", () => {
  const allowed = allowedTags(root);
  for (const tag of NAMED_TAGS) assert.ok(allowed.has(tag));
  assert.equal(countIn(`${NAMED_TAGS.join(" ")} #0PYLQ2 #0GRJCUV`, allowed), 0);
  assert.equal(countIn('{"player_tag": "#0C2C8"}', allowed), 0);
  assert.equal(countIn('{"player_tag": "#0C2C8"}', none), 1);
});

test("compare and lowered ratchet one way", () => {
  const baseline = { "a.json": 3, "b.json": 2 };
  const counts = { "a.json": 4, "b.json": 1, "c.json": 1, "pin.sql": 2 };
  const { rose, fell, pinned } = compare(counts, baseline, { "pin.sql": 1 });
  assert.deepEqual(
    rose.map((r) => r.file),
    ["a.json", "c.json"],
  );
  assert.deepEqual(
    fell.map((r) => r.file),
    ["b.json"],
  );
  assert.deepEqual(pinned, [{ file: "pin.sql", have: 2, want: 1 }]);
  assert.deepEqual(lowered({ "a.json": 9, "c.json": 1 }, baseline), {
    "a.json": 3,
  });
});

test("no file holds more real-looking tags than the baseline", () => {
  const baseline = JSON.parse(
    readFileSync(path.join(root, "docs/no-real-tags.baseline.json"), "utf8"),
  ).files;
  for (const file of Object.keys(PINNED_FILES))
    assert.ok(!(file in baseline), `${file} is pinned, never in the baseline`);
  const { rose, fell, pinned } = compare(census(root), baseline);
  const how =
    "A tag-shaped string that is not King Thing's, POAP KINGS' or invented was added. " +
    "Many players are minors: never put a real player's tag in this repository. " +
    "Invent one over the alphabet 0289PYLQGRJCUV starting #0, list it in docs/invented-tags.json, " +
    "and use it instead. `node infra/scripts/no-real-tags.mjs` names the files.";
  assert.deepEqual(
    rose.map((r) => `${r.file}: ${r.have} (baseline ${r.was})`),
    [],
    how,
  );
  assert.deepEqual(
    pinned,
    [],
    "a pinned migration changed: migrations are immutable",
  );
  if (fell.length > 0)
    console.log(
      `no-real-tags: ${fell.length} files fell below the baseline; ` +
        "lower it with `node infra/scripts/no-real-tags.mjs --update`",
    );
});
