/**
 * What a push to main has left to test (2026-11-19, a kinder CI). Main
 * takes about fifty merges a day, and its push run tested every one of
 * them again in full, journeys included: the push runs were about 40% of
 * validate's minutes. Two answers cut that without testing less:
 *
 * - `run: false` when the deploy gate (lib/ci-gate.mjs) would already
 *   pass HEAD: a pull request that was up to date when it merged leaves
 *   main with its head's tree, and its head's green `validate` is the
 *   test of those files. validate then passes on that alone.
 * - Otherwise everything runs, and the journeys run when what changed
 *   since the newest main commit with a green `validate` reaches them
 *   (e2e-needed.sh, the pull requests' rule). Not since the commit
 *   before: a queued main run is cancelled when a newer one queues, so
 *   that commit may never have been tested.
 *
 * Every doubt (an API error, no green commit nearby) answers "test it
 * all". `git(args)` returns trimmed stdout, `ghApi(path)` parsed JSON,
 * `e2eNeeded(paths)` the e2e-needed.sh answer as a boolean; all three
 * are injected so the test drives every branch without a network.
 */

import { checkState, ciGate } from "./ci-gate.mjs";

/** How far back main is searched for a green commit. */
export const MAX_BACK = 30;

/**
 * @returns {Promise<{ run: boolean, e2e: boolean, why: string }>}
 */
export async function pushPlan({ git, ghApi, e2eNeeded, repo }) {
  const all = (why) => ({ run: true, e2e: true, why });
  try {
    const gate = await ciGate({
      git,
      ghApi,
      repo,
      waitMs: 0,
      sleep: async () => {},
    });
    if (gate.ok)
      return { run: false, e2e: false, why: `already tested as ${gate.via}` };
    const ancestors = git([
      "rev-list",
      "--first-parent",
      `--max-count=${MAX_BACK}`,
      "HEAD~1",
    ])
      .split("\n")
      .filter(Boolean);
    for (const sha of ancestors) {
      if ((await checkState(ghApi, repo, sha)) !== "success") continue;
      const paths = git(["diff", "--name-only", sha, "HEAD"]);
      return {
        run: true,
        e2e: e2eNeeded(paths),
        why: `changes since green ${sha.slice(0, 8)}`,
      };
    }
    return all(`no green commit in main's last ${MAX_BACK}`);
  } catch (err) {
    return all(`could not tell (${err.message.split("\n")[0]})`);
  }
}
