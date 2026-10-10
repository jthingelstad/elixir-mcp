import { useState, useRef, useEffect } from "react";
import { LogTable, useClock, noun } from "@elixir-mcp/ui";
import { useMyTimeline, useTimelineEvidence } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";
import { TimelineDiscord } from "./TimelineDiscord.jsx";

/**
 * The timeline: what happened to the players and clans you track, the
 * same items a connection reads with elixir_timeline.
 *
 * Its own rail item between Overview and Explore (Jamie, 2026-09-23):
 * it is the thing a reader most often opens the console to ask, and it
 * had been Activity's first view, one level down beside the call log.
 * Still a LogTable, because it is still a log, and newest first as the
 * timeline is everywhere: a newsfeed (contract 7.0.0). Above it, the
 * switch that cross-posts it to a Discord channel (2026-10-10).
 */
export function Timeline() {
  const { stamp } = useClock();
  const scoped = Boolean(useScope());
  const timelineQuery = useMyTimeline();
  const timeline = timelineQuery.data ?? null;
  const more = timeline?.timeline_more ?? 0;
  const [selected, setSelected] = useState(null);
  const [offset, setOffset] = useState(0);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const restoreTriggerRef = useRef(false);
  useEffect(() => {
    if (selected) {
      panelRef.current?.focus({ preventScroll: true });
      panelRef.current?.scrollIntoView({ block: "start" });
    } else if (restoreTriggerRef.current) {
      restoreTriggerRef.current = false;
      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus({ preventScroll: true });
        triggerRef.current.scrollIntoView({
          block: "center",
          inline: "nearest",
        });
      }
    }
  }, [selected]);
  const closeEvidence = () => {
    restoreTriggerRef.current = true;
    setSelected(null);
  };
  const evidenceQuery = useTimelineEvidence(
    selected
      ? {
          evidence_item_id: selected.id,
          from: selected.window.from,
          to: selected.window.to,
          expected_evidence_version: selected.evidence.version,
          evidence_offset: String(offset),
        }
      : null,
  );
  const evidence =
    evidenceQuery.isSuccess && !evidenceQuery.isFetching
      ? evidenceQuery.data
      : null;
  const viewEvidence = (it) => {
    triggerRef.current = document.activeElement;
    setOffset(0);
    setSelected({ ...it, window: timeline.window });
  };
  const rows = (timeline?.timeline ?? []).map((it) => {
    // Unread is a state of the row: past the account's read pointer, or
    // everything when no connection has ever marked it.
    const unread =
      !timeline?.read_to || String(it.at) > String(timeline.read_to);
    return [
      stamp(it.at),
      it.subject_name ?? it.subject_tag ?? "your account",
      // The item's own "Sat 11:18" lead carries no zone; the WHEN column
      // already says the time in yours (DECISIONS: the console tells time
      // in the account's zone), so the sentence starts after it.
      String(it.text ?? "").replace(/^[A-Z][a-z]{2} \d{2}:\d{2} /, ""),
      unread ? { text: "unread", tone: "accent-bright" } : "read",
      it.evidence
        ? {
            text:
              it.evidence.kind === "session" ? "View games" : "View crossing",
            action: () => viewEvidence(it),
          }
        : "",
    ];
  });
  return (
    <LogTable
      loading={timelineQuery.isPending}
      error={
        timelineQuery.isError
          ? "The timeline could not be read just now; try again shortly."
          : null
      }
      title="Timeline"
      note={
        scoped
          ? "What happened to the clans and players this agent tracks, last seven days, newest first. The same items it reads with elixir_timeline."
          : "What happened to the players and clans you track, last seven days, newest first. The same items a connection reads with elixir_timeline."
      }
      above={
        <>
          <TimelineDiscord />
          {selected ? (
            <section
              aria-label="Timeline evidence"
              ref={panelRef}
              tabIndex={-1}
              className="mb-6 space-y-3 border-b border-rule pb-5"
            >
              <h2 className="text-lg">Recorded evidence</h2>
              <p className="break-words">{selected.text}</p>
              <button
                className="btn btn--sm"
                type="button"
                onClick={closeEvidence}
              >
                Close evidence
              </button>
              {evidenceQuery.isFetching ? (
                <p role="status">Reading recorded games…</p>
              ) : null}
              {evidenceQuery.isError ? (
                <div role="alert">
                  <p>
                    This evidence is unavailable or changed. Refresh the
                    timeline and open it again.
                  </p>
                  <button
                    className="btn btn--sm"
                    type="button"
                    onClick={() => {
                      closeEvidence();
                      timelineQuery.refetch();
                    }}
                  >
                    Refresh timeline
                  </button>
                </div>
              ) : null}
              {evidence ? (
                <>
                  <p>
                    Observed {stamp(evidence.observed_at)}.
                    {evidence.observed_at_basis === "legacy_window"
                      ? " This is the legacy observation window; its proof attachment time was not recorded."
                      : ""}
                  </p>
                  {evidence.kind === "session" ? (
                    <>
                      {typeof selected.facts?.battles === "number" ? (
                        <p>
                          The summary covers {selected.facts.battles}{" "}
                          {noun(selected.facts.battles, "game")}
                          {selected.facts.ended_at
                            ? `, ending ${stamp(selected.facts.ended_at)}`
                            : ""}
                          .
                        </p>
                      ) : null}
                      <p>
                        {evidence.count} recorded games
                        {evidence.from
                          ? ` from ${stamp(evidence.from)}`
                          : ""}{" "}
                        through {stamp(evidence.through)}.
                        {selected.kind === "session_standout"
                          ? " This evidence ends at the latest milestone reached in this update; the summary can include later games in the same sitting."
                          : ""}{" "}
                        {evidence.open
                          ? "The summarized sitting was still open at this read."
                          : "The summarized sitting was closed at this read."}
                      </p>
                      <p>
                        Capture completeness is unknown.{" "}
                        {evidence.completeness === "anchor_bound"
                          ? "The bounded search may omit the beginning of this sitting."
                          : "These are the recorded games from the sitting’s observed beginning."}
                      </p>
                    </>
                  ) : (
                    <p>
                      {evidence.status === "proved"
                        ? "This recorded game proves the crossing."
                        : "The change was observed, but its crossing game is unknown or unavailable."}
                    </p>
                  )}
                  <ol className="space-y-2" start={offset + 1}>
                    {evidence.battles.map((b) => (
                      <li key={b.battle_id}>
                        <a
                          href={b.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {stamp(b.at)} · {b.mode_group ?? "Recorded"} ·{" "}
                          {b.outcome ?? "Outcome unknown"} · Open recorded game
                        </a>
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
            </section>
          ) : null}
        </>
      }
      cols={[
        ["WHEN", "left"],
        ["WHO", "left"],
        ["WHAT", "left"],
        ["STATE", "left"],
        ["EVIDENCE", "left"],
      ]}
      rows={rows}
      monoCols={[0]}
      wrapCols={[2]}
      filters={[
        { key: "who", label: "Who", col: 1 },
        { key: "state", label: "State", col: 3 },
      ]}
      empty="Nothing in the last seven days — everything you track appears here while its notify switch is on."
      footnote={`Reading this page never moves a connection's read pointer: unread here means unread by your connections, not by you.${more > 0 ? ` A busy week: the ${rows.length} newest are shown, and ${more.toLocaleString()} more this week are not.` : ""}`}
    />
  );
}
