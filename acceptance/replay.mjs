/**
 * A door that answers from captured calls, so a case can be run against
 * what the product answered on a day it was wrong ("prove it bites",
 * acceptance/README.md). Captures are the archive bucket's objects
 * (packages/tools/src/capture.mjs): `{ request: { tool, arguments },
 * response }`, the response being the tool body - or the error body the
 * caller saw. A read the captures do not hold answers `not_captured`,
 * which fails the case for the right reason.
 */

import { participationObjects } from "../packages/tools/src/participation-table.mjs";

/** The numbered contract versions a replay still reads, frozen: version
 *  numbers ended on 2026-11-23, and a capture since carries the tool
 *  fingerprint (`tools.<12 hex>`), which is after every one of them. A
 *  capture with no version at all is from before the first. */
const SINCE = Object.freeze({
  TIMELINE_BASIS: [11, 8], // #373: the timeline gained basis
  RENAMES: [12, 0], // DECISIONS "Follow, never track"
});

function before(c, [major, minor]) {
  const v = c.contract_version;
  if (typeof v === "string" && v.startsWith("tools.")) return false;
  const [m, n] = String(v ?? "0.0")
    .split(".")
    .map(Number);
  return m < major || (m === major && n < minor);
}

/** Before 11.8.0 the timeline had one basis, observed (#373): a capture
 *  from then is the read a case pinning basis observed makes. */
function asCalled(c) {
  const args = c.request.arguments ?? {};
  return c.request.tool === "elixir_timeline" &&
    before(c, SINCE.TIMELINE_BASIS) &&
    !("basis" in args)
    ? { ...args, basis: "observed" }
    : args;
}

/** 12.0.0 renamed five tools with no alias (DECISIONS "Follow, never
 *  track"): a capture from before then answers the case that calls the
 *  tool by its name now. The captures themselves keep the name they were
 *  recorded under. */
const RENAMED_IN_12 = {
  elixir_track_player: "elixir_follow_player",
  elixir_track_clan: "elixir_follow_clan",
  players_timeline: "players_series",
  clans_timeline: "clans_series",
  clans_members_timeline: "clans_members_series",
};

export function calledAs(c) {
  return before(c, SINCE.RENAMES)
    ? (RENAMED_IN_12[c.request.tool] ?? c.request.tool)
    : c.request.tool;
}

export function replayDoor(captures, { tools = [] } = {}) {
  const key = (tool, args) => `${tool}:${canonical(args ?? {})}`;
  const index = new Map(
    captures.map((c) => [key(calledAs(c), asCalled(c)), c]),
  );
  return {
    async toolsList() {
      return tools;
    },
    async call(tool, args = {}) {
      const c = index.get(key(tool, args));
      if (!c)
        return {
          body: {
            error: {
              code: "not_captured",
              message: `no capture of ${tool} ${JSON.stringify(args)}`,
            },
          },
          isError: true,
          ms: null,
        };
      const isError = Boolean(c.response?.error && !c.response?.notes);
      // As the live door does (door.mjs): a table reads as its objects.
      return {
        body: participationObjects(c.response),
        raw: c.response,
        isError,
        ms: c.timings?.db_ms ?? 0,
      };
    },
  };
}

/** JSON with keys sorted at every level, so argument order never decides
 *  whether a capture matches. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
