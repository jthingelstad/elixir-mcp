import { useState, useRef, useEffect } from "react";
import { LogTable, useClock, noun, TagText } from "@elixir-mcp/ui";
import { useMyTimeline, useTimelineEvidence } from "../../lib/queries.js";
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
    // The pointer is an instant the record LEARNED things by, so the
    // row's is observed_at (an item learned late happened before it).
    const unread =
      !timeline?.read_to ||
      String(it.observed_at ?? it.at) > String(timeline.read_to);
    return [
      stamp(it.at),
      it.subject_name ?? it.subject_tag ?? "your account",
      // Time-free (11.8.0): the WHEN column says the time in the
      // account's zone (DECISIONS: the console tells time in it).
      String(it.text ?? ""),
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
      note="The last seven days, newest first."
      actions={<TimelineDiscord />}
      renderRow={(row) => {
        const proof = row[4];
        const state = row[3];
        return (
          <>
            <time className="timeline-list__time">{row[0]}</time>
            <div>
              <span className="timeline-list__subject">
                <TagText>{row[1]}</TagText>
              </span>
              <p className="timeline-list__text">
                <TagText>{row[2]}</TagText>
              </p>
            </div>
            <div className="timeline-list__actions">
              {typeof state === "object" && state?.text === "unread" ? (
                <span className="text-[12px] text-ink-faint">
                  Unread by connections
                </span>
              ) : null}
              {typeof proof === "object" && proof?.action ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={proof.action}
                >
                  {proof.text}
                </button>
              ) : null}
            </div>
          </>
        );
      }}
      above={
        <>
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
      footnote={`Unread means unread by your connections. Viewing this page leaves their place unchanged.${more > 0 ? ` A busy week: the ${rows.length} newest are shown, and ${more.toLocaleString()} more this week are not.` : ""}`}
    />
  );
}
