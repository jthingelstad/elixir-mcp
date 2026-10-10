/**
 * The contract changelog — MCP-visible (agent feedback #4, Jamie +1 in
 * #5: agents need "what changed since contract X" to discover new
 * capabilities, because client-side tool schemas cache aggressively).
 *
 * One file per version, src/changes/<version>.ts, written by
 * `npm run contract:bump -- <patch|minor|major>` in the pull request that
 * moves the contract, so two parallel pull requests never edit one line.
 * The build lists them (scripts/changes-index.mjs writes the gitignored
 * src/generated/); this is the assembled list, newest first.
 */
import { CHANGES } from "./generated/changes.js";
import type { ChangelogEntry } from "./changelog-entry.js";

export type { ChangelogEntry } from "./changelog-entry.js";

// Already newest first: the build lists the files that way. A sort here
// would read as a side effect to a bundler and pull every version into
// bundles that never show the changelog (the Console's).
export const CHANGELOG: ChangelogEntry[] = CHANGES;
