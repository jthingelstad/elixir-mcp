#!/usr/bin/env node
/**
 * The spec files one CI journey shard runs, balanced on measured time.
 *
 *   npm run e2e -- $(node infra/scripts/e2e-shard.mjs 2/3)
 *
 * Playwright's own `--shard` cuts the ordered test list into equal
 * COUNTS, and the slowest specs sort last: on 2026-10-21 shard 3/3 ran
 * 192 s against 93 s and 103 s for the other two, and validate waited on
 * it. Here whole spec files are spread longest first onto the lightest
 * shard (test.mjs's `plan`, the same rule as the test shards); inside a
 * shard Playwright still runs every test in parallel (`fullyParallel`).
 * A spec not in SPEC_WEIGHTS weighs 1 and lands on the lightest shard;
 * add it when it proves slow.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseShard, plan, repoRoot } from "./test.mjs";

const E2E = "apps/web/e2e";

/** Seconds of test time per spec, both projects (wide and narrow), from
 *  a full local run on 2026-10-21, rounded. Only the order and rough
 *  size matter. Keyed by path under apps/web/e2e. */
export const SPEC_WEIGHTS = {
  "responsive-reflow.spec.ts": 75,
  "year-activity.spec.ts": 71,
  "signin-return.spec.ts": 34,
  "ladder.spec.ts": 33,
  "clan/roles-readiness.spec.ts": 30,
  "recorder-onboarding.spec.ts": 25,
  "clan/clan.spec.ts": 18,
  "capture-truthfulness.spec.ts": 17,
  "console.spec.ts": 16,
  "tracking-read-recovery.spec.ts": 15,
  "clan/awards-readiness.spec.ts": 9,
  "clan/removal-safety.spec.ts": 8,
  "clan/season.spec.ts": 7,
  "interface-second-pass.spec.ts": 7,
  "mail-layout.spec.ts": 6,
  "clan/delivery.spec.ts": 6,
  "clan/our-voice.spec.ts": 6,
  "cards.spec.ts": 6,
  "clan/landing.spec.ts": 5,
  "signup.spec.ts": 5,
  "clan/picker.spec.ts": 4,
  "clan/reopen.spec.ts": 4,
  "player-battle-share.spec.ts": 4,
  "clan/departure-draft.spec.ts": 4,
  "battle.spec.ts": 4,
  "signup-news.spec.ts": 3,
  "timeline-evidence.spec.ts": 3,
  "interface-cleanup.spec.ts": 3,
  "clan/draft-voice.spec.ts": 3,
  "clan/browse-context.spec.ts": 3,
  "clan/member-readiness.spec.ts": 2,
  "home.spec.ts": 2,
  "clan/readiness.spec.ts": 2,
  "native-ssr.spec.ts": 2,
  "email.spec.ts": 1,
};

/** Every spec file, as a path under apps/web/e2e, sorted. */
export function specs(root = repoRoot) {
  const base = path.join(root, E2E);
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory()
        ? walk(p)
        : name.endsWith(".spec.ts")
          ? [path.relative(base, p).split(path.sep).join("/")]
          : [];
    });
  return walk(base).sort();
}

/** The spec files shard `text` ("2/3") runs, as repository paths. Throws
 *  on an empty shard: no file arguments would run every journey. */
export function e2eShard(text, root = repoRoot) {
  const { index, count } = parseShard(text);
  const files = plan(specs(root), count, SPEC_WEIGHTS)[index - 1];
  if (!files.length)
    throw new Error(`e2e shard ${text} has no spec files; use fewer shards`);
  return files.map((f) => `${E2E}/${f}`).sort();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(e2eShard(process.argv[2]).join(" "));
  } catch (err) {
    console.error(`e2e-shard: ${err.message}`);
    process.exit(2);
  }
}
