/** A reader's week, drawn only from sessions already visible on their Timeline.
 * Keep one session link per friend and run. An event tag is one run even
 * when the game reuses its name. A replay adds no new item or delivery. */
export function sharedEvents(items, connections, subjects, fromMs) {
  const follows = new Set(
    subjects
      .filter((s) => s.kind === "player" && s.relationship === "friend")
      .map((s) => s.tag),
  );
  const runs = new Map();
  for (const it of items) {
    if (!["battle_session", "session_standout"].includes(it.kind)) continue;
    const f = it.facts;
    if (
      !it.id ||
      it.evidence?.kind !== "session" ||
      !f?.started_at ||
      Date.parse(f.started_at) < fromMs ||
      !follows.has(f.player_tag) ||
      connections.get(f.player_tag)?.connection !== "friend"
    )
      continue;
    for (const event of f.events ?? []) {
      if (!event.event_tag || !event.name || !event.battles) continue;
      let run = runs.get(event.event_tag);
      if (!run) {
        run = { tag: event.event_tag, name: event.name, players: new Map() };
        runs.set(run.tag, run);
      }
      if (!run.players.has(f.player_tag))
        run.players.set(f.player_tag, {
          tag: f.player_tag,
          name: f.name,
          session_id: it.id,
          started_at: f.started_at,
        });
    }
  }
  return [...runs.values()]
    .filter((r) => r.players.size >= 2)
    .sort(
      (a, b) =>
        b.players.size - a.players.size ||
        a.name.localeCompare(b.name) ||
        a.tag.localeCompare(b.tag),
    )
    .slice(0, 3)
    .map((r) => ({
      tag: r.tag,
      name: r.name,
      players: [...r.players.values()],
    }));
}
