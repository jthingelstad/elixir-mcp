import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WEIGHT,
  WEIGHTS,
  defaultJobs,
  nodeMismatch,
  parseShard,
  plan,
  units,
} from "../../../infra/scripts/test.mjs";
import {
  openedDocs,
  specClosure,
} from "../../../infra/scripts/lib/e2e-inputs.mjs";
import {
  SPEC_WEIGHTS,
  e2eShard,
  specs as e2eSpecs,
} from "../../../infra/scripts/e2e-shard.mjs";

/**
 * The CI tooling (2026-10-21): infra/scripts/e2e-needed.sh, which decides
 * whether a pull request runs the browser journeys, and
 * infra/scripts/test.mjs, the one test runner `npm run verify` and CI's
 * test shards share. A wrong `false` from e2e-needed.sh skips the
 * journeys silently; a unit the shards drop is a test nobody runs.
 */
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const e2eNeeded = (paths) =>
  execFileSync("sh", ["infra/scripts/e2e-needed.sh"], {
    cwd: repoRoot,
    input: paths.map((p) => `${p}\n`).join(""),
  })
    .toString()
    .trim();

test("e2e-needed: what builds, serves or lands in the journeys' tree says true", () => {
  for (const p of [
    "apps/web/src/views/Battle.jsx",
    "apps/web/e2e/clan/clan.spec.ts",
    "apps/web/playwright.config.ts",
    "packages/ui/src/flash.ts",
    "packages/client/src/index.ts",
    "packages/design/src/index.css",
    "packages/clan-web/src/views/Actions.jsx",
    "packages/clan-engine/src/index.mjs",
    "packages/contracts/src/index.ts",
    "packages/record/src/index.mjs",
    "packages/mail/src/render.mjs",
    "packages/auth/src/session.mjs",
    "services/web-api/src/app-pages.mjs",
    "services/web-api/src/routes/battle-activity.mjs",
    "services/email-relay/src/templates.mjs",
    "infra/scripts/build.mjs",
    "infra/scripts/build-site.mjs",
    "infra/scripts/serve-site.mjs",
    "infra/scripts/e2e-shard.mjs",
    "package.json",
    "package-lock.json",
    ".node-version",
    ".github/workflows/validate.yml",
    "apps/site/src/index.njk",
    "apps/site/src/_includes/base.njk",
    "apps/site/eleventy.config.mjs",
    "apps/site/src/docs/quickstart.md",
  ])
    assert.equal(e2eNeeded([p]), "true", p);
});

test("e2e-needed: what never reaches a journey says false", () => {
  for (const p of [
    "services/web-api/src/routes/public.mjs",
    "services/mcp/src/handler.mjs",
    "services/jobs/src/index.mjs",
    "services/email-relay/src/index.mjs",
    "packages/tools/src/registry.mjs",
    "packages/http/src/database.mjs",
    "db/migrations/0300_example.sql",
    "infra/template.yaml",
    "infra/scripts/deploy.mjs",
    "infra/scripts/test.mjs",
    "apps/site/src/docs/glossary.md",
    "apps/site/src/_data/updates.js",
    "apps/site/src/_data/updates/2026-10-21-01-example.md",
    "apps/site/test/site.test.mjs",
    "apps/web/AGENTS.md",
    "docs/notes/2026-10-21-ci-speed.md",
    ".github/dependabot.yml",
  ])
    assert.equal(e2eNeeded([p]), "false", p);
  assert.equal(e2eNeeded([]), "false", "no paths");
});

test("e2e-needed: one path that needs the journeys is enough, wherever it sits", () => {
  assert.equal(
    e2eNeeded(["db/migrations/0300_example.sql", "packages/ui/src/Icon.tsx"]),
    "true",
  );
  assert.equal(
    e2eNeeded(["apps/site/src/docs/quickstart.md", "infra/template.yaml"]),
    "true",
  );
  assert.equal(
    e2eNeeded(["infra/template.yaml", "apps/site/src/docs/glossary.md"]),
    "false",
  );
});

test("e2e-needed says true for every repository file a journey imports, and every doc page one opens", async () => {
  // Derived, not listed: a spec that starts importing another file (or a
  // page it bundles that does) fails here until e2e-needed.sh names it.
  const closure = await specClosure(repoRoot);
  assert.ok(
    closure.includes("services/web-api/src/app-pages.mjs"),
    "the closure follows the entries a spec bundles (native-ssr)",
  );
  assert.ok(closure.length > 100, `closure of ${closure.length} files`);
  const docs = openedDocs(repoRoot);
  assert.ok(docs.includes("apps/site/src/docs/quickstart.md"));
  const missed = [...closure, ...docs].filter((p) => e2eNeeded([p]) !== "true");
  assert.deepEqual(missed, []);
});

test("test runner: every workspace with a test script is a unit, and root is one", async () => {
  const all = units(repoRoot);
  const names = all.map((u) => u.name);
  assert.equal(new Set(names).size, names.length, "unit names are unique");
  assert.ok(names.includes("root"));
  for (const n of ["web", "tools", "migrate", "clan-web", "web-api", "site"])
    assert.ok(names.includes(n), n);
  const pkg = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  );
  assert.equal(pkg.scripts.test, "node infra/scripts/test.mjs");
  assert.equal(pkg.scripts.pretest, undefined, "the runner builds once");
  // A weight for a unit that no longer exists is a stale table.
  for (const n of Object.keys(WEIGHTS)) assert.ok(names.includes(n), n);
});

test("test runner: shards cover every unit exactly once, deterministically and balanced", () => {
  const names = units(repoRoot).map((u) => u.name);
  for (const count of [1, 2, 3, 4]) {
    const shards = plan(names, count);
    assert.equal(shards.length, count);
    assert.deepEqual(shards.flat().sort(), [...names].sort());
    assert.deepEqual(plan([...names].reverse(), count), shards);
    const load = (s) =>
      s.reduce((t, n) => t + (WEIGHTS[n] ?? DEFAULT_WEIGHT), 0);
    const loads = shards.map(load);
    const heaviest = Math.max(...Object.values(WEIGHTS));
    assert.ok(
      Math.max(...loads) - Math.min(...loads) <= heaviest,
      `loads ${loads.join(", ")}`,
    );
  }
  // An unknown unit still lands somewhere.
  assert.deepEqual(plan(["a-new-workspace"], 3), [["a-new-workspace"], [], []]);
});

test("test runner: --shard, the pool and the Node check", () => {
  assert.deepEqual(parseShard("2/3"), { index: 2, count: 3 });
  for (const bad of ["0/3", "4/3", "3", "a/b", "", undefined])
    assert.throws(() => parseShard(bad), /--shard/);
  assert.equal(defaultJobs(1), 2);
  assert.equal(defaultJobs(4), 2);
  assert.equal(defaultJobs(10), 5);
  assert.equal(defaultJobs(64), 6);
  assert.equal(nodeMismatch("24.22.0", repoRoot), null);
  assert.deepEqual(nodeMismatch("26.12.0", repoRoot), {
    want: "24",
    have: "26.12.0",
  });
});

test("e2e shards: every spec file in exactly one, balanced, and never an empty one", () => {
  const all = e2eSpecs(repoRoot);
  assert.ok(all.length > 20, `${all.length} specs`);
  // A weight for a spec that no longer exists is a stale table.
  for (const s of Object.keys(SPEC_WEIGHTS)) assert.ok(all.includes(s), s);
  const shards = [1, 2, 3].map((i) => e2eShard(`${i}/3`, repoRoot));
  assert.deepEqual(
    shards.flat().sort(),
    all.map((s) => `apps/web/e2e/${s}`).sort(),
  );
  const load = (files) =>
    files.reduce(
      (t, f) => t + (SPEC_WEIGHTS[f.replace("apps/web/e2e/", "")] ?? 1),
      0,
    );
  const loads = shards.map(load);
  assert.ok(
    Math.max(...loads) - Math.min(...loads) <=
      Math.max(...Object.values(SPEC_WEIGHTS)),
    `loads ${loads.join(", ")}`,
  );
  assert.throws(() => e2eShard(`40/40`, repoRoot), /no spec files/);
});

test("validate runs the runner's shards and the journeys' shards it names, and gates on all of them", async () => {
  const workflow = await readFile(
    path.join(repoRoot, ".github/workflows/validate.yml"),
    "utf8",
  );
  const job = (name) =>
    workflow
      .split(/^ {2}(?=[a-z][\w-]*:\s*$)/m)
      .find((block) => block.startsWith(`${name}:`)) ?? "";
  const shards = (block) =>
    JSON.parse(/^\s+shard: (\[[\d, ]+\])$/m.exec(block)?.[1] ?? "[]");
  assert.deepEqual(shards(job("test")), [1, 2, 3]);
  assert.match(
    job("test"),
    /node infra\/scripts\/test\.mjs --shard \$\{\{ matrix\.shard \}\}\/3/,
  );
  assert.deepEqual(shards(job("e2e")), [1, 2, 3]);
  assert.match(
    job("e2e"),
    /node infra\/scripts\/e2e-shard\.mjs \$\{\{ matrix\.shard \}\}\/3/,
  );
  assert.doesNotMatch(job("e2e"), /--shard/, "Playwright's count split");
  assert.match(job("static"), /npm run verify:static/);
  assert.match(job("static"), /node infra\/scripts\/build\.mjs/);
  assert.match(
    job("validate"),
    /needs: \[changes, static, test, e2e\]/,
    "validate needs every job",
  );
  for (const result of ["CHANGES", "STATIC", "TEST"])
    assert.match(job("validate"), new RegExp(`test "\\$${result}" = success`));
  assert.match(job("validate"), /test "\$E2E" = skipped/);
  // Every Node is the repository's Node.
  const setups = workflow.match(/uses: actions\/setup-node@/g) ?? [];
  const pinned = workflow.match(/node-version-file: \.node-version/g) ?? [];
  assert.equal(setups.length, 3);
  assert.equal(pinned.length, setups.length);
  assert.doesNotMatch(workflow, /node-version: /);
  // verify locally is static, the runner, and the bundles: CI's three parts.
  const pkg = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  );
  assert.equal(
    pkg.scripts.verify,
    "npm run verify:static && npm test && node infra/scripts/build.mjs",
  );
  assert.equal(pkg.engines.node, "24.x");
});

test("a flaky journey fails CI; the retry stays, for its trace", async () => {
  const config = await readFile(
    path.join(repoRoot, "apps/web/playwright.config.ts"),
    "utf8",
  );
  assert.match(config, /retries: process\.env\.CI \? 1 : 0/);
  assert.match(config, /failOnFlakyTests: !!process\.env\.CI/);
});
