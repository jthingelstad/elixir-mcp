/** Private weekly copy, evaluated only through a recorded river-log closure.
 * Original array indices are remapped together; later weeks never enter totals.
 * These are provisional snapshots, never grant decisions. */
import {
  chatSafe,
  clipChat,
  evaluateAwards,
  LEADER_MESSAGE,
} from "@elixir-mcp/clan-engine";

export function awardUpdateParts(season, { prefix, title, complete }) {
  const bodies = [];
  let body = prefix;
  const number = (value) => Number(value).toLocaleString("en-US");
  for (const award of season.awards.filter(
    (a) => a.state !== "off" && a.state !== "manual",
  )) {
    const label = clipChat(chatSafe(award.name), 40);
    let items;
    const podium = award.rows.filter((row) => row.on_podium);
    const unknownPodium =
      award.kind !== "perfect_attendance" &&
      podium.some((row) => {
        const metric =
          award.kind === "donations_podium" ? row.total : row.points;
        return (
          !Number.isFinite(metric) ||
          !Number.isInteger(row.place) ||
          row.place < 1
        );
      });
    if (
      award.state === "held" ||
      (award.computed && !complete) ||
      unknownPodium
    )
      items = ["standings not ready"];
    else if (award.kind === "perfect_attendance")
      items = [`${number(award.rows.length)} on track`];
    else {
      items = award.rows
        .filter((row) => row.on_podium)
        .map((row) => {
          const metric = number(
            award.kind === "donations_podium" ? row.total : row.points,
          );
          const fixed = `${row.place}.  ${metric}.`;
          const nameBudget =
            LEADER_MESSAGE.body -
            prefix.length -
            label.length -
            2 -
            fixed.length;
          // A long name is clipped visibly; player IDs never belong in outgoing copy.
          const name = clipChat(
            chatSafe(row.name || "Member") || "Member",
            nameBudget,
          );
          return `${row.place}. ${name} ${metric}`;
        });
      if (!items.length) items = ["no qualifiers yet"];
    }
    for (const [i, item] of items.entries()) {
      const line = `${i === 0 ? `${label}: ` : ""}${item}.`;
      const next = body === prefix ? prefix + line : `${body} ${line}`;
      if (next.length <= LEADER_MESSAGE.body) body = next;
      else {
        if (body !== prefix) bodies.push(body);
        body = `${prefix}${label}: ${item}.`;
      }
    }
  }
  if (body !== prefix) bodies.push(body);
  return bodies.map((body, i) => ({
    part: i + 1,
    message: {
      title: clipChat(
        `${title}${bodies.length > 1 ? ` (${i + 1}/${bodies.length})` : ""}`,
        LEADER_MESSAGE.title,
      ),
      body,
    },
  }));
}

export function currentAwardUpdate({ participation, config, now }) {
  const result = evaluateAwards({ row_limit: 50, participation, config, now });
  const season = result.seasons[0];
  if (!season || season.closed) return null;
  const asOf = participation.meta?.as_of ?? now.toISOString();
  return {
    scope: "current",
    season_id: season.season_id,
    as_of: asOf,
    complete: season.complete,
    parts: awardUpdateParts(season, {
      prefix: "So far: ",
      title: `Season ${season.season_id}`,
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
        parts: awardUpdateParts(season, {
          prefix: `After week ${week.section_index + 1}: `,
          title: `S${week.season_id} week ${week.section_index + 1}`,
          complete: throughComplete,
        }),
      };
    })
    .filter((week) => week.parts.length);
}
