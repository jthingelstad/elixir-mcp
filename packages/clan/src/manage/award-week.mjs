/** Private weekly copy, evaluated only through a recorded river-log closure.
 * Original array indices are remapped together; later weeks never enter totals.
 * These are provisional snapshots, never grant decisions. */
import {
  chatSafe,
  clipChat,
  evaluateAwards,
  LEADER_MESSAGE,
} from "@elixir-mcp/clan-engine";

export function weeklyAwardUpdates({ participation, config, now, fromSeason }) {
  const latest = Math.max(...participation.war_weeks.map((w) => w.season_id));
  const floor = fromSeason ?? latest;
  return participation.war_weeks
    .filter(
      (w) =>
        w.season_id >= floor &&
        Number.isFinite(Date.parse(w.finished_observed_at)) &&
        Date.parse(w.finished_observed_at) <= now.getTime(),
    )
    .sort(
      (a, b) => a.season_id - b.season_id || a.section_index - b.section_index,
    )
    .map((week) => {
      const indices = participation.war_weeks.flatMap((w, i) =>
        w.season_id < week.season_id ||
        (w.season_id === week.season_id &&
          w.section_index <= week.section_index)
          ? [i]
          : [],
      );
      const through = {
        ...participation,
        war_weeks: indices.map((i) => participation.war_weeks[i]),
        members: participation.members.map((m) => ({
          ...m,
          war_points: indices.map((i) => m.war_points?.[i] ?? null),
          war_decks: indices.map((i) => m.war_decks?.[i] ?? null),
          absent_at_war_week: indices.map(
            (i) => m.absent_at_war_week?.[i] ?? null,
          ),
        })),
      };
      const season = evaluateAwards({
        row_limit: 50,
        participation: through,
        config,
        now,
      }).seasons.find((s) => s.season_id === week.season_id);
      const throughComplete =
        season.complete &&
        through.war_weeks
          .filter((w) => w.season_id === week.season_id)
          .every(
            (w) =>
              Number.isFinite(Date.parse(w.finished_observed_at)) &&
              Date.parse(w.finished_observed_at) <= now.getTime(),
          );
      const prefix = `Provisional S${week.season_id} W${week.section_index + 1}. `;
      const lines = [];
      for (const award of season.awards.filter((a) => a.state !== "off")) {
        const label = clipChat(chatSafe(award.name), 40);
        if (award.state === "held" || (award.computed && !throughComplete))
          lines.push(`${label}: evidence incomplete; places withheld.`);
        else if (award.state === "manual")
          lines.push(`${label}: a human choice at season close.`);
        else if (award.kind === "perfect_attendance")
          lines.push(
            `${label}: ${award.rows.length} recorded on track; others may lack evidence.`,
          );
        else {
          const rows = award.rows.filter((row) => row.on_podium);
          if (!rows.length) lines.push(`${label}: no recorded contenders yet.`);
          for (const row of rows) {
            const metric =
              award.kind === "donations_podium"
                ? `${row.total} cards`
                : `${row.points} points`;
            let name = chatSafe(row.name ?? row.player_tag);
            const line = () => `${label}: ${row.place}. ${name}, ${metric}.`;
            if ((prefix + line()).length > LEADER_MESSAGE.body)
              name = chatSafe(row.player_tag);
            lines.push(line());
          }
        }
      }
      const bodies = [];
      let body = prefix;
      for (const line of lines) {
        const next = body === prefix ? prefix + line : body + " " + line;
        if (next.length <= LEADER_MESSAGE.body) body = next;
        else {
          if (body !== prefix) bodies.push(body);
          body = prefix + line;
        }
      }
      if (body !== prefix) bodies.push(body);
      return {
        season_id: week.season_id,
        section_index: week.section_index,
        finished_observed_at: week.finished_observed_at,
        as_of: participation.meta?.as_of ?? null,
        complete: throughComplete,
        parts: bodies.map((body, i) => ({
          part: i + 1,
          message: {
            title: `S${week.season_id} W${week.section_index + 1} ${i + 1}/${bodies.length}`,
            body,
          },
        })),
      };
    })
    .filter((week) => week.parts.length);
}
