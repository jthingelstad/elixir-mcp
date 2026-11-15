/**
 * The runner's arguments (#645): --help prints the usage and runs
 * nothing, and an unknown flag is refused rather than ignored (on
 * 2026-10-21 `--help` started the whole suite). Parsed only: nothing
 * here reaches the door.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RUN_USAGE, parseRunArgs } from "./run.mjs";

test("acceptance args: --help asks for the usage", () => {
  for (const argv of [["--help"], ["-h"], ["--family", "battles", "--help"]])
    assert.equal(parseRunArgs(argv).help, true, argv.join(" "));
  for (const flag of [
    "--gym",
    "--only",
    "--family",
    "--json",
    "--no-pace",
    "--update-shapes",
    "--reason",
  ])
    assert.ok(RUN_USAGE.includes(flag), flag);
});

test("acceptance args: the flags the deploy, the skills and the README use", () => {
  assert.deepEqual(parseRunArgs([]).errors, []);
  const family = parseRunArgs(["--family", "battles"]);
  assert.equal(family.family, "battles");
  assert.deepEqual(family.errors, []);
  const gym = parseRunArgs([
    "--gym",
    "--only",
    "gym/304.1",
    "--json",
    "--no-pace",
  ]);
  assert.deepEqual(
    [gym.gym, gym.only, gym.json, gym.noPace, gym.errors],
    [true, "gym/304.1", true, true, []],
  );
  const shapes = parseRunArgs([
    "--update-shapes",
    "--reason",
    "tool grew a field",
  ]);
  assert.deepEqual(
    [shapes.updateShapes, shapes.reason, shapes.errors],
    [true, "tool grew a field", []],
  );
});

test("acceptance args: an unknown flag, a missing value or an unreasoned shape update is refused", () => {
  for (const [argv, re] of [
    [["--hlep"], /unknown argument --hlep/],
    [["budgets"], /unknown argument budgets/],
    [["--only"], /--only needs a value/],
    [["--family", "--json"], /--family needs a value/],
    [["--update-shapes"], /--update-shapes needs --reason/],
  ])
    assert.ok(
      parseRunArgs(argv).errors.some((e) => re.test(e)),
      argv.join(" "),
    );
  // A flag taken for a missing value is still read as a flag.
  assert.equal(parseRunArgs(["--family", "--json"]).json, true);
});

test("acceptance args: help and a refusal are decided before the env is read or the door made", () => {
  const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  const main = source.slice(source.indexOf("if (isMain)"));
  const at = (s) => {
    const i = main.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  assert.ok(at("parsed.help") < at("loadEnv()"));
  assert.ok(at("parsed.errors.length") < at("loadEnv()"));
  assert.ok(at("loadEnv()") < at("makeDoor("));
});
