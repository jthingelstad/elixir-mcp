import { memberPostPath } from "@elixir-mcp/posts";

// Titles present throughout the reference's event rotation sample. Tags
// still identify runs, including a new run of a recurring title.
const regular = new Set([
  "Classic 1v1",
  "Classic 2v2",
  "Classic Challenge",
  "Grand Challenge",
  "Mega Draft Challenge",
  "Merge Tactics",
  "Seasonal Trophy Road",
]);

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
  for (const it of items) {
    const post = it.post;
    const battle = post?.battle;
    const run = runs.get(battle?.event_tag);
    const player = run?.players.get(post?.author?.player_tag);
    const path = memberPostPath(post?.id);
    if (
      !player ||
      !path ||
      post.status ||
      battle.mode_group !== "event" ||
      Date.parse(battle.battle_time) < fromMs
    )
      continue;
    (player.posts ??= []).push({ path, question: post.question === true });
  }
  return [...runs.values()]
    .filter((r) => r.players.size >= 2)
    .sort(
      (a, b) =>
        Number(regular.has(a.name)) - Number(regular.has(b.name)) ||
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
