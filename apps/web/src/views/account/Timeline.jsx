import { LogTable } from "@elixir-mcp/ui";
import { useMyTimeline } from "../../lib/queries.js";

const when = (ts) =>
  ts ? new Date(ts).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—";

/**
 * The timeline: what happened to the players and clans you track, the
 * same items a connection reads with elixir_timeline.
 *
 * Its own rail item between Overview and Explore (Jamie, 2026-09-23):
 * it is the thing a reader most often opens the console to ask, and it
 * had been Activity's first view, one level down beside the call log.
 * Still a LogTable, because it is still a log.
 */
export function Timeline() {
  const timeline = useMyTimeline().data ?? null;
  const rows = (timeline?.timeline ?? []).map((it) => {
    // Unread is a state of the row: past the account's read pointer, or
    // everything when no connection has ever marked it.
    const unread =
      !timeline?.read_to || String(it.at) > String(timeline.read_to);
    return [
      when(it.at),
      it.subject_name ?? it.subject_tag ?? "your account",
      it.text,
      unread ? { text: "unread", tone: "accent-bright" } : "read",
    ];
  });
  return (
    <LogTable
      title="Timeline"
      note="What happened to the players and clans you track, last seven days, oldest first. The same items a connection reads with elixir_timeline."
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
      footnote="Reading this page never moves a connection's read pointer: unread here means unread by your connections, not by you."
    />
  );
}
