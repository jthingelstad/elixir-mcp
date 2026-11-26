/**
 * A clan's stored stories, written and compared (stage 5 of the stored
 * Timeline, 2026-11-26; docs/notes/2026-11-26-timeline-story-clans.md).
 *
 * The timeline-sync lane runs refreshClanStories on a `{ v: 1,
 * story_clan, since }` wake, which only the jobs' sweep writes. With
 * TIMELINE_STORY_CLANS at `shadow` it writes the clan's rows
 * (story-store.mjs writeSubjectStories, kind `clan`) and then compares:
 * the clan built alone for the week ending at the write's `now`, at
 * comprehensive and at activity scope, beside the same week cut from the
 * rows just written (entries.mjs storedClanTimeline). One log line a
 * write, counts and story ids only. `off` writes and compares nothing.
 * No door reads clan rows yet.
 */
import { createHash } from "node:crypto";
import { buildTimeline, restoredItem, storedClanTimeline } from "./entries.mjs";
import { HOME_WEEK_MS, compareWeeks } from "./home-feed.mjs";
import {
  readClanRows,
  refreshSubjectStories,
  storySpan,
  unstored,
} from "./story-store.mjs";

/** TIMELINE_STORY_CLANS as a mode: `shadow` only when it says so. */
export const storyClansOf = (v) => (v === "shadow" ? "shadow" : "off");

/** The scopes a reader can follow a clan at, each compared. */
const SCOPES = ["comprehensive", "activity"];
/** No kind is labelled by kind alone: a clan row keeps each kind's
 *  observed instant (SUPERSET). */
const NO_EDGE_KINDS = new Set();

/** What the store holds and the comparison reads: no unstored kind and
 *  no attested fact (an account's own). */
const storedOnly = (it) => !unstored(it) && it.section !== "attested";

/** A key for one clan across log lines: never the tag. */
const clanKey = (tag) =>
  createHash("sha256").update(`clan:${tag}`).digest("hex").slice(0, 10);

/**
 * The clan's week ending `now` (observed, as Home reads it) twice: built,
 * and cut from its stored rows, at each reader scope. Rows are read once,
 * by their observed_at column (a superset of every observed window's
 * stories; story-store.mjs readClanRows), and cut per scope. Returns
 * `{ read_ms, comprehensive, activity }`, each compareWeeks' counts with
 * `build_ms` and `cut_ms`, or `{ refused }` when the rows cannot answer
 * the week (`unwritten`, `span`).
 */
export async function compareClanStories(db, tag, { now }) {
  const fromMs = now - HOME_WEEK_MS;
  const readStarted = Date.now();
  const read = await readClanRows(db, tag, { fromMs });
  if (!read.ok) return { refused: read.reason };
  const out = { read_ms: Date.now() - readStarted };
  const window = {
    fromMs,
    toMs: now,
    basis: "observed",
    timezone: "UTC",
    cap: Number.MAX_SAFE_INTEGER,
    filter: storedOnly,
  };
  for (const scope of SCOPES) {
    const buildStarted = Date.now();
    const computed = await buildTimeline(db, [{ kind: "clan", tag, scope }], {
      ...window,
      accountId: null,
      accountLines: false,
      lateCounts: false,
    });
    const buildMs = Date.now() - buildStarted;
    const cutStarted = Date.now();
    // A fresh copy a scope: a cut finishes its items in place.
    const stored = await storedClanTimeline(
      db,
      tag,
      read.items.map((it) => restoredItem(structuredClone(it))),
      { ...window, scope },
    );
    stored.stored_written = new Map([[tag, read.written_at]]);
    out[scope] = {
      ...compareWeeks(computed, stored, {
        fromMs,
        basis: "observed",
        other: "stored",
        edgeKinds: NO_EDGE_KINDS,
        saidGate: false,
        storedOf: () => tag,
      }),
      build_ms: buildMs,
      cut_ms: Date.now() - cutStarted,
    };
  }
  return out;
}

/**
 * A clan wake's run (the lane): with `mode` `shadow`, write the clan's
 * rows over its span ending `now` (a write already begun after `since`
 * serves the wake), then compare. Returns the write's counts with
 * `write_ms`, and `shadow`: the one log line's fields (no tag; `clan` is
 * a short hash), or `{ failed }` when the comparison threw, which never
 * fails the write. `{ skipped: "off" }` otherwise.
 */
export async function refreshClanStories(
  db,
  tag,
  { since = null, mode = "off", now = Date.now() } = {},
) {
  if (mode !== "shadow") return { skipped: "off" };
  const span = storySpan(now, "clan");
  const started = Date.now();
  const written = await refreshSubjectStories(db, "clan", tag, {
    since,
    span,
  });
  const writeMs = Date.now() - started;
  if (written.skipped || written.superseded)
    return { ...written, write_ms: writeMs };
  let diff;
  try {
    diff = await compareClanStories(db, tag, { now: span.toMs });
  } catch (err) {
    diff = { failed: err?.code ?? err?.name ?? "error" };
  }
  return {
    ...written,
    write_ms: writeMs,
    shadow: { clan: clanKey(tag), ...written, write_ms: writeMs, ...diff },
  };
}
