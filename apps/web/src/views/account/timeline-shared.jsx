import { useEffect, useRef, useState } from "react";
import { TagText, noun, useClock } from "@elixir-mcp/ui";
import { gameLine, shownAt } from "../../home/logic.js";
import { useMarkTimelineSeen } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";

/**
 * What both Timeline pages share: the place a visit opens from, and one item's
 * recorded evidence.
 *
 * The Console keeps its own place in the feed (Jamie, 2026-10-20: "timeline
 * should be independent of what agents have seen via MCP"). Showing the page
 * moves that place to the window it showed; "new" is drawn from the place as
 * it stood when the page opened, so it holds still while the place moves
 * underneath it.
 */
export function useTimelinePlace(timeline) {
  const agent = useScope();
  const seenTo = timeline?.seen_to ?? null;
  const to = timeline?.window?.to ?? null;
  // The place as this visit found it: taken from the first read, per
  // console (an agent's console keeps the agent's place).
  const [opened, setOpened] = useState(null);
  if (timeline && (opened === null || opened.agent !== agent))
    setOpened({ agent, seenTo });
  const openedMs = opened?.seenTo ? Date.parse(opened.seenTo) : null;
  // Once per window end shown: a refused or failed write is not retried
  // until the page shows a later window.
  const markSeen = useMarkTimelineSeen();
  const markedRef = useRef(null);
  useEffect(() => {
    if (!to || markedRef.current === to) return;
    if (seenTo && Date.parse(seenTo) >= Date.parse(to)) return;
    markedRef.current = to;
    markSeen(to);
  }, [to, seenTo, markSeen]);
  return { openedMs };
}

/** A row under a day's heading: only the time, and whose clock when the
 *  account has named none. */
export function useRowTime() {
  const { clock, zone } = useClock();
  return (ts) => `${clock(ts)}${zone ? "" : " UTC"}`;
}

/** One item's evidence: the wording of what was read, and its games. */
export function TimelineEvidence({
  selected,
  query,
  offset,
  setOffset,
  onRefresh,
  underDay = false,
}) {
  const { when, day } = useClock();
  const rowTime = useRowTime();
  // Under a day's heading a game of that day needs only its time.
  const headed = underDay ? day(shownAt(selected)) : null;
  const gameTime = (at) => (day(at) === headed ? rowTime(at) : when(at));
  const evidence = query.isSuccess && !query.isFetching ? query.data : null;
  return (
    <>
      {query.isFetching ? <p role="status">Reading recorded games…</p> : null}
      {query.isError ? (
        <div role="alert">
          <p>
            This evidence is unavailable or changed. Refresh the timeline and
            open it again.
          </p>
          <button className="btn btn--sm" type="button" onClick={onRefresh}>
            Refresh timeline
          </button>
        </div>
      ) : null}
      {evidence ? (
        <>
          <p>
            Read {when(evidence.observed_at)}.
            {evidence.observed_at_basis === "legacy_window"
              ? " This is the older reading window; the time this proof was attached was not kept."
              : ""}
          </p>
          {evidence.kind === "session" ? (
            <>
              {typeof selected.facts?.battles === "number" ? (
                <p>
                  The summary covers {selected.facts.battles}{" "}
                  {noun(selected.facts.battles, "game")}
                  {selected.facts.ended_at
                    ? `, ending ${when(selected.facts.ended_at)}`
                    : ""}
                  .
                </p>
              ) : null}
              <p>
                {evidence.count} recorded games
                {evidence.from
                  ? ` from ${when(evidence.from)}`
                  : ""} through {when(evidence.through)}.
                {selected.kind === "session_standout"
                  ? " This evidence ends at the latest milestone reached in this update; the summary can include later games in the same sitting."
                  : ""}{" "}
                {evidence.open
                  ? "The summarized sitting was still open at this read."
                  : "The summarized sitting was closed at this read."}
              </p>
              <p>
                Whether every game was read is unknown.{" "}
                {evidence.completeness === "anchor_bound"
                  ? "The bounded search may omit the beginning of this sitting."
                  : "These are the recorded games from the start of the sitting as Elixir read it."}
              </p>
            </>
          ) : (
            <p>
              {evidence.status === "proved"
                ? "This recorded game proves the crossing."
                : "Elixir read the change, but the game that crossed it is unknown or unavailable."}
            </p>
          )}
          <ol className="space-y-2" start={offset + 1}>
            {evidence.battles.map((b) => (
              <li key={b.battle_id} className="kit-row">
                <span className="kit-row__main">
                  <a href={b.url} target="_blank" rel="noopener noreferrer">
                    <TagText>{gameLine(b)}</TagText>
                  </a>
                </span>
                <span className="kit-row__right">{gameTime(b.at)}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-4">
            {offset > 0 ? (
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                Previous games
              </button>
            ) : null}
            {evidence.next_offset !== null ? (
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => setOffset(evidence.next_offset)}
              >
                Next games
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
