/**
 * A deploy never modifies a tracked file (2026-11-13). The vocabulary
 * step rewrote fixtures/card-roles.snapshot.json on every deploy: its
 * source_commit was the sibling cr-agent-api-docs' HEAD, which moves with
 * any commit there. The snapshot is now a pure function of the
 * vocabulary, the deploy only checks it, and the deploy checks the tree
 * after its build and again at its end.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEPLOY_PHASES,
  changedTrackedFiles,
} from "../../../infra/scripts/deploy.mjs";
import {
  SNAPSHOT_PATH,
  saveVocabularySnapshot,
  snapshotIsCurrent,
  snapshotText,
} from "../../../infra/scripts/lib/reference-vocabulary.mjs";

const vocabulary = {
  roles: [{ id: 26000000, name: "Knight" }],
  aliases: [],
  unattested: [],
  roles_version: "2026-09-25T15:03:30.000Z",
  source_commit: "d".repeat(40),
};

test("the snapshot is a pure function of the vocabulary", async (t) => {
  t.mock.method(console, "error", () => {});
  assert.equal(snapshotText(vocabulary), snapshotText({ ...vocabulary }));
  const dir = await mkdtemp(path.join(tmpdir(), "vocab-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "snapshot.json");
  assert.equal(snapshotIsCurrent(vocabulary, file), false, "missing file");
  saveVocabularySnapshot(vocabulary, file);
  assert.equal(snapshotIsCurrent(vocabulary, file), true);
  assert.equal(
    snapshotIsCurrent({ ...vocabulary, source_commit: "e".repeat(40) }, file),
    false,
  );
});

test("the vocabulary phase warns about a stale snapshot and never writes it", async (t) => {
  const before = await readFile(SNAPSHOT_PATH, "utf8");
  const warnings = [];
  t.mock.method(console, "warn", (line) => warnings.push(line));
  t.mock.method(console, "error", () => {});
  let refreshed = 0;
  const phase = DEPLOY_PHASES.find((p) => p.name === "vocabulary");
  await phase.run({
    verifiedReferenceSeed: {
      vocabulary: { ...vocabulary, source_commit: "f".repeat(40) },
      refresh: async () => {
        refreshed += 1;
      },
    },
  });
  assert.equal(refreshed, 1);
  assert.equal(await readFile(SNAPSHOT_PATH, "utf8"), before);
  assert.match(warnings.join("\n"), /card-roles\.snapshot\.json is behind/);
  assert.match(warnings.join("\n"), /--snapshot-only/);
});

test("changed tracked files are read from git status, untracked ignored", () => {
  let asked;
  const files = changedTrackedFiles((...args) => {
    asked = args;
    return " M fixtures/card-roles.snapshot.json\nM  infra/x.mjs";
  });
  assert.deepEqual(asked, ["status", "--porcelain", "--untracked-files=no"]);
  assert.deepEqual(files, [
    " M fixtures/card-roles.snapshot.json",
    "M  infra/x.mjs",
  ]);
  assert.deepEqual(
    changedTrackedFiles(() => ""),
    [],
  );
});

test("the build phase checks the tree before anything is uploaded", () => {
  const names = DEPLOY_PHASES.map((p) => p.name);
  assert.ok(names.indexOf("build") < names.indexOf("upload"));
  const build = DEPLOY_PHASES.find((p) => p.name === "build");
  assert.match(build.run.toString(), /changedTrackedFiles/);
  assert.match(build.run.toString(), /DeployExit/);
});

test("the end-of-deploy check names the files and exits 1, after every phase that writes", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (line) => errors.push(line));
  const names = DEPLOY_PHASES.map((p) => p.name);
  const at = names.indexOf("clean-tree");
  assert.ok(at > names.indexOf("site"));
  assert.ok(at > names.indexOf("vocabulary"));
  assert.ok(at > names.indexOf("acceptance"));
  assert.equal(names[at + 1], "record", "the record still runs");
  const phase = DEPLOY_PHASES[at];
  const clean = { changedTrackedFiles: () => [] };
  await phase.run(clean);
  assert.equal(clean.exitCode, undefined);
  const dirty = {
    changedTrackedFiles: () => [" M fixtures/card-roles.snapshot.json"],
  };
  await phase.run(dirty);
  assert.equal(dirty.exitCode, 1);
  assert.match(errors.join("\n"), /must never modify a tracked file/);
  assert.match(errors.join("\n"), /fixtures\/card-roles\.snapshot\.json/);
});
