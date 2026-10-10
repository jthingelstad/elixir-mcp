/**
 * The deploy record (working model, 2026-10-10). Nothing recorded which
 * revision production runs: the stack holds content-named bundles, not
 * commits, and the site lane never updates the stack at all. So every
 * successful deploy now writes `deploys/production.json` to the code
 * bucket (every lane writes there already), and the next deploy reads it
 * back: the commits between that revision and this one are what this
 * deploy shipped for the first time. Each pull request those commits
 * came from gets one comment saying when it went live, at which commit,
 * with which contract versions, and what acceptance said.
 *
 * Every outside effect is injected (`git(args)` returns trimmed stdout;
 * `ghApi(path)` parsed JSON; `ghPost(path, body)` posts), so the tests
 * drive it offline, as they do the CI gate. A failure here warns and
 * never fails a deploy that is already live.
 */

import { utcAndCentral } from "./production-lock.mjs";

export const DEPLOY_RECORD_KEY = "deploys/production.json";
export const deployHistoryKey = (deployedAt, sha) =>
  `deploys/history/${deployedAt.replace(/[:.]/g, "-")}-${sha.slice(0, 12)}.json`;

/** More than this many commits in one deploy is not a normal range;
 *  past it, the PRs are not looked up one commit at a time. */
export const MAX_COMMITS = 300;

const marker = (sha) => `<!-- elixir-deploy-record sha=${sha} -->`;

/**
 * The commits `to` adds over the previously deployed `from`, oldest
 * first.
 *
 * @returns {{ ok: true, commits: string[] } | { ok: false, reason: string }}
 */
export function shippedCommits({ git, from, to }) {
  if (!from)
    return {
      ok: false,
      reason:
        "no earlier deploy is recorded; this deploy is recorded, and the next one comments on what it ships",
    };
  if (from === to) return { ok: true, commits: [] };
  try {
    git(["cat-file", "-e", `${from}^{commit}`]);
  } catch {
    try {
      git(["fetch", "--quiet", "origin"]);
      git(["cat-file", "-e", `${from}^{commit}`]);
    } catch {
      return {
        ok: false,
        reason: `the last deployed commit ${from.slice(0, 12)} is not in this clone`,
      };
    }
  }
  try {
    git(["merge-base", "--is-ancestor", from, to]);
  } catch {
    return {
      ok: false,
      reason: `the last deployed commit ${from.slice(0, 12)} is not an ancestor of ${to.slice(0, 12)} (a rollback, or a break-glass deploy off main)`,
    };
  }
  const listed = git(["rev-list", "--reverse", `${from}..${to}`]);
  const commits = listed ? listed.split("\n") : [];
  if (commits.length > MAX_COMMITS)
    return {
      ok: false,
      reason: `${commits.length} commits since the last deploy (more than ${MAX_COMMITS})`,
    };
  return { ok: true, commits };
}

/**
 * The merged pull requests into main that carry these commits, each
 * with its commits in this deploy, ordered by number.
 */
export async function shippedPulls({ ghApi, repo, commits }) {
  const byNumber = new Map();
  for (const sha of commits) {
    const pulls = await ghApi(`repos/${repo}/commits/${sha}/pulls`);
    for (const pr of pulls ?? []) {
      if (!pr?.merged_at || pr?.base?.ref !== "main") continue;
      const entry = byNumber.get(pr.number) ?? {
        number: pr.number,
        title: pr.title,
        commits: [],
      };
      entry.commits.push(sha);
      byNumber.set(pr.number, entry);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** The versions production serves, read from the published site: the
 *  MCP contract from /tools.json and the JSON API from its OpenAPI
 *  document. null where a read fails. */
export async function liveVersions({ fetch, base }) {
  const read = async (url, pick) => {
    try {
      const res = await fetch(url, {
        headers: { "cache-control": "no-cache" },
      });
      return res.ok ? (pick(await res.json()) ?? null) : null;
    } catch {
      return null;
    }
  };
  return {
    contract: await read(`${base}/tools.json`, (j) => j?.contract_version),
    api: await read(
      `${base}/docs/integration-api.json`,
      (j) => j?.info?.version,
    ),
  };
}

const versionLine = (live, declared) =>
  live === null
    ? `unknown (could not read it live; this commit declares ${declared})`
    : live === declared
      ? `${live}`
      : `${live} (this commit declares ${declared})`;

/** One PR's comment. */
export function commentBody({
  repo,
  sha,
  deployedAt,
  lane,
  live,
  declared,
  acceptance,
  prCommits,
}) {
  const link = (s) =>
    `[\`${s.slice(0, 8)}\`](https://github.com/${repo}/commit/${s})`;
  return [
    marker(sha),
    `**Deployed to production** ${utcAndCentral(deployedAt)}.`,
    "",
    `- Commit: ${link(sha)}${lane ? ` (${lane} lane)` : ""}; this PR's: ${prCommits.map(link).join(", ")}`,
    `- MCP contract: ${versionLine(live.contract, declared.contract)}`,
    `- JSON API: ${versionLine(live.api, declared.api)}`,
    `- Acceptance: ${acceptance}`,
  ].join("\n");
}

/**
 * Comment on each PR once per deployed commit: a PR whose comments
 * already carry this deploy's marker is skipped, so a re-run never
 * comments twice. A failure on one PR warns and moves on.
 *
 * @returns {Promise<{ commented: number[], skipped: number[], failed: number[] }>}
 */
export async function commentOnPulls({
  ghApi,
  ghPost,
  repo,
  sha,
  pulls,
  bodyFor,
  warn = () => {},
}) {
  const out = { commented: [], skipped: [], failed: [] };
  for (const pr of pulls) {
    try {
      const comments = await ghApi(
        `repos/${repo}/issues/${pr.number}/comments?per_page=100`,
      );
      if ((comments ?? []).some((c) => c?.body?.includes(marker(sha)))) {
        out.skipped.push(pr.number);
        continue;
      }
      await ghPost(`repos/${repo}/issues/${pr.number}/comments`, {
        body: bodyFor(pr),
      });
      out.commented.push(pr.number);
    } catch (error) {
      out.failed.push(pr.number);
      warn(
        `deploy record: could not comment on #${pr.number}: ${error?.message ?? error}`,
      );
    }
  }
  return out;
}
