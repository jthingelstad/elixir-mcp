/** Private weekly copy, evaluated only through a recorded river-log closure.
 * Original array indices are remapped together; later weeks never enter totals.
 * These are provisional snapshots, never grant decisions. */
import {
  chatSafe,
  clipChat,
  evaluateAwards,
  LEADER_MESSAGE,
} from "@elixir-mcp/clan-engine";

function updateParts(season, { prefix, title, complete }) {
  const lines = [];
  for (const award of season.awards.filter((a) => a.state !== "off")) {
    const label = clipChat(chatSafe(award.name), 40);
    if (award.state === "held" || (award.computed && !complete))
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
  return bodies.map((body, i) => ({
    part: i + 1,
    message: { title: `${title} ${i + 1}/${bodies.length}`, body },
  }));
}

export function currentAwardUpdate({ participation, config, now }) {
  const result = evaluateAwards({ row_limit: 50, participation, config, now });
  const season = result.seasons[0];
  if (!season || season.closed) return null;
  const asOf = participation.meta?.as_of ?? now.toISOString();
  const stamp = Number.isFinite(Date.parse(asOf))
    ? new Date(asOf).toISOString().slice(5, 16).replace("T", " ")
    : now.toISOString().slice(5, 16).replace("T", " ");
  return {
    scope: "current",
    season_id: season.season_id,
    as_of: asOf,
    complete: season.complete,
    parts: updateParts(season, {
      prefix: `Provisional S${season.season_id} ${stamp} UTC. `,
      title: `S${season.season_id} now`,
      complete: season.complete,
    }),
  };
}

export function timelyAwardWeek(participation, now) {
  const latest = Math.max(...participation.war_weeks.map((w) => w.season_id));
  const weeks = participation.war_weeks.filter((w) => w.season_id === latest);
  const finished = (w) =>
    Number.isFinite(Date.parse(w.finished_observed_at)) &&
    Date.parse(w.finished_observed_at) <= now.getTime();
  if (weeks.some((w) => w.is_colosseum && finished(w))) return null;
  const week = weeks
    .filter(finished)
    .sort((a, b) => b.section_index - a.section_index)[0];
  return week &&
    now.getTime() - Date.parse(week.finished_observed_at) <= 7 * 86400000
    ? week
    : null;
}

export function weeklyAwardUpdates({ participation, config, now }) {
  const week = timelyAwardWeek(participation, now);
  return (week ? [week] : [])
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
      return {
        season_id: week.season_id,
        section_index: week.section_index,
        finished_observed_at: week.finished_observed_at,
        as_of: participation.meta?.as_of ?? null,
        complete: throughComplete,
        parts: updateParts(season, {
          prefix: `Provisional S${week.season_id} W${week.section_index + 1}. `,
          title: `S${week.season_id} W${week.section_index + 1}`,
          complete: throughComplete,
        }),
      };
    })
    .filter((week) => week.parts.length);
}
