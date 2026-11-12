import { useState, useRef, useEffect } from "react";
import { Icon, LogTable, useClock, TagText } from "@elixir-mcp/ui";
import { useMyTimeline, useTimelineEvidence } from "../../lib/queries.js";
import { TimelineEvidence, useTimelinePlace } from "./timeline-shared.jsx";
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
 *
 * The Console keeps its own place in it (Jamie, 2026-10-20: "timeline
 * should be independent of what agents have seen via MCP"). Showing the
 * page moves that place to the window it showed, which clears the rail's
 * dot; it never moves what a connection has read, and a connection's
 * mark_read never moves it. The "New since your last visit" rule is
 * drawn from the place as it stood when the page opened, so it holds
 * still while the place moves underneath it.
 */
export function Timeline({ crumb = null } = {}) {
  const { when } = useClock();
  const timelineQuery = useMyTimeline();
  const timeline = timelineQuery.data ?? null;
  const more = timeline?.timeline_more ?? 0;
  const { openedMs } = useTimelinePlace(timeline);
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
  const viewEvidence = (it) => {
    triggerRef.current = document.activeElement;
    setOffset(0);
    setSelected({ ...it, window: timeline.window });
  };
  const rows = (timeline?.timeline ?? []).map((it) => {
    // New is a state of the row: learned since the place this visit
    // opened from. The place is an instant the record LEARNED things
    // by, so the row's is observed_at (an item learned late happened
    // before it). A first visit has no place, and marks nothing new.
    const state =
      openedMs === null
        ? ""
        : Date.parse(it.observed_at ?? it.at) > openedMs
          ? { text: "new", tone: "accent-bright" }
          : "earlier";
    return [
      when(it.sort_at ?? it.at),
      it.subject_name ?? it.subject_tag ?? "your account",
      // Time-free (11.8.0): the WHEN column says the time in the
      // account's zone (DECISIONS: the app tells time in it).
      String(it.text ?? ""),
      state,
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
          ? "The timeline could not be read just now. Try again shortly."
          : null
      }
      crumb={crumb}
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
              {typeof state === "object" && state?.text === "new" ? (
                <span className="timeline-list__new">New</span>
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
              className="mb-6 space-y-3 pb-5"
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
              <TimelineEvidence
                selected={selected}
                query={evidenceQuery}
                offset={offset}
                setOffset={setOffset}
                onRefresh={() => {
                  closeEvidence();
                  timelineQuery.refetch();
                }}
              />
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
        ...(openedMs === null
          ? []
          : [{ key: "state", label: "State", col: 3 }]),
      ]}
      divider={openedMs === null ? null : NEW_SINCE}
      empty="Nothing in the last seven days. Everything you track appears here while its notify switch is on."
      footnote={`New means learned since you last opened this page. Opening it clears the Timeline dot and changes nothing your connections have read.${more > 0 ? ` A busy week: the ${rows.length} newest are shown, and ${more.toLocaleString()} more this week are not.` : ""}`}
    />
  );
}

/** The rule under the last new row: the rows above it are new since the
 *  place this visit opened from. Defined once, so the table's divider
 *  memo is not refreshed by every render. */
const NEW_SINCE = {
  after: (row) => typeof row[3] === "object" && row[3]?.text === "new",
  label: (
    <>
      <Icon name="chevron-up" size={15} />
      New since your last visit
      <span className="sr-only">: the items above this line.</span>
    </>
  ),
};
