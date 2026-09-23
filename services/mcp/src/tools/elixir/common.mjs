/** Shared by the elixirTools tools in this directory: the helpers,
 *  argument schemas and notes more than one of them uses. Split out of
 *  tools/elixir.mjs (2026-09-23), one file per tool. */

import { docsRef } from "../shared.mjs";

export const RECORDING_DOCS = docsRef("recording", "added-means-recorded");
export const FEED_DOCS = docsRef("timeline");
// Leave room below the protocol's 48k cap for the invoker's request, quota and
// pending-hint metadata. Feedback text and its maintainer response may each be
// 4k, so a row-count limit alone cannot make this result safe.
export const FEEDBACK_PAGE_MAX_CHARS = 40_000;
