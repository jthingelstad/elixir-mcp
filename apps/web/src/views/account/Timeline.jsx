import { LogTable, useClock } from "@elixir-mcp/ui";
import { useMyTimeline } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";

/**
 * The timeline: what happened to the players and clans you track, the
 * same items a connection reads with elixir_timeline.
 *
 * Its own rail item between Overview and Explore (Jamie, 2026-09-23):
 * it is the thing a reader most often opens the console to ask, and it
 * had been Activity's first view, one level down beside the call log.
 * Still a LogTable, because it is still a log, and newest first as the
 * timeline is everywhere: a newsfeed (contract 7.0.0).
 */
export function Timeline() {
  const { stamp } = useClock();
  const scoped = Boolean(useScope());
  const timeline = useMyTimeline().data ?? null;
  const more = timeline?.timeline_more ?? 0;
  const rows = (timeline?.timeline ?? []).map((it) => {
    // Unread is a state of the row: past the account's read pointer, or
    // everything when no connection has ever marked it.
    const unread =
      !timeline?.read_to || String(it.at) > String(timeline.read_to);
    return [
      stamp(it.at),
      it.subject_name ?? it.subject_tag ?? "your account",
      it.text,
      unread ? { text: "unread", tone: "accent-bright" } : "read",
    ];
  });
  return (
    <LogTable
      title="Timeline"
      note={
        scoped
          ? "What happened to the clans and players this agent tracks, last seven days, newest first. The same items it reads with elixir_timeline."
          : "What happened to the players and clans you track, last seven days, newest first. The same items a connection reads with elixir_timeline."
      }
      cols={[
        ["WHEN", "left"],
        ["WHO", "left"],
        ["WHAT", "left"],
        ["STATE", "left"],
      ]}
      rows={rows}
      monoCols={[0]}
      filters={[
        { key: "who", label: "Who", col: 1 },
        { key: "state", label: "State", col: 3 },
      ]}
      empty="Nothing in the last seven days — everything you track appears here while its notify switch is on."
      footnote={`Reading this page never moves a connection's read pointer: unread here means unread by your connections, not by you.${more > 0 ? ` A busy week: the ${rows.length} newest are shown, and ${more.toLocaleString()} more this week are not.` : ""}`}
    />
  );
}
