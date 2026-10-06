/** The clan's season record, projected from one bounded participation read.
 * Calendar bounds are supplied by the record's existing season clock. */
import { seasonsFrom } from "./awards.mjs";

const WEEK = 7 * 86400_000;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const instant = (v) => (v ? Date.parse(v) : NaN);

export function seasonReport(participation, { calendar, now }) {
  const current = new Set();
  const population = new Map();
  for (const [rows, present] of [
    [participation.members, true],
    [participation.former_members, false],
  ]) {
    for (const row of rows ?? []) {
      if (!row.player_tag) continue;
      if (present) current.add(row.player_tag);
      if (!population.has(row.player_tag)) population.set(row.player_tag, []);
      population.get(row.player_tag).push(row);
    }
  }
  const closed = new Map(
    seasonsFrom(participation, now).map((s) => [s.season_id, s.closed]),
  );
  const windowStart = instant(
    participation.applied?.window?.from ?? participation.weeks?.[0]?.from,
  );
  const rosterStart = instant(participation.first_roster_observed_at);
  const t = now.getTime();
  return {
    current_season_id: calendar.current_season_id,
    seasons: calendar.seasons.map((s) => {
      const contributors = new Set();
      const readings = new Set();
      const races = Array.from({ length: s.sections }, (_, section) => {
        const index = (participation.war_weeks ?? []).findIndex(
          (w) => w.season_id === s.season_id && w.section_index === section,
        );
        const w = participation.war_weeks?.[index];
        const from = Date.parse(s.from) + section * WEEK;
        const to = from + WEEK;
        const finish = instant(w?.finished_observed_at);
        const state = !w
          ? from > t
            ? "upcoming"
            : "missing"
          : finish <= t
            ? "closed"
            : s.season_id === calendar.current_season_id && t < to
              ? "open"
              : "unconfirmed";
        const metrics = { decks: [], points: [] };
        const tookPart = new Set();
        for (const [tag, rows] of population) {
          // Duplicate representations of a player name the same clan/race
          // counter. A known high-water mark counts once, never twice.
          const values = {};
          for (const [key, column] of [
            ["decks", "war_decks"],
            ["points", "war_points"],
          ]) {
            const known = rows.map((r) => r[column]?.[index]).filter(count);
            values[key] = known.length ? Math.max(...known) : null;
            if (values[key] !== null) metrics[key].push(values[key]);
          }
          if (values.decks !== null || values.points !== null)
            readings.add(tag);
          if (values.decks > 0 || values.points > 0) {
            contributors.add(tag);
            tookPart.add(tag);
          }
        }
        const total = (values) =>
          values.length ? values.reduce((a, b) => a + b, 0) : null;
        return {
          section_index: section,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          state,
          is_colosseum: w
            ? w.is_colosseum === true
            : section === s.sections - 1,
          decks: total(metrics.decks),
          points: total(metrics.points),
          contributors:
            metrics.decks.length || metrics.points.length
              ? tookPart.size
              : null,
          decks_readings: metrics.decks.length,
          points_readings: metrics.points.length,
          counters_unknown:
            !!w &&
            (metrics.decks.length < population.size ||
              metrics.points.length < population.size),
        };
      });
      const sum = (key) => {
        const known = races.map((r) => r[key]).filter(count);
        return known.length ? known.reduce((a, b) => a + b, 0) : null;
      };
      const includedCurrent = [...readings].filter((tag) =>
        current.has(tag),
      ).length;
      const coverage = {
        expected_sections: s.sections,
        recorded_sections: races.filter(
          (r) => !["missing", "upcoming"].includes(r.state),
        ).length,
        missing_sections: races.filter((r) => r.state === "missing").length,
        closure_unconfirmed: races.some((r) => r.state === "unconfirmed"),
        counters_unknown: races.some((r) => r.counters_unknown),
        before_window:
          Number.isFinite(windowStart) && Date.parse(s.from) < windowStart,
        roster_started_late:
          Number.isFinite(rosterStart) && rosterStart > Date.parse(s.from),
        current_members: includedCurrent,
        former_members: readings.size - includedCurrent,
      };
      return {
        ...s,
        state:
          closed.get(s.season_id) === true
            ? "closed"
            : s.season_id === calendar.current_season_id
              ? "open"
              : "unconfirmed",
        decks: sum("decks"),
        points: sum("points"),
        contributors: readings.size ? contributors.size : null,
        incomplete:
          coverage.missing_sections > 0 ||
          coverage.closure_unconfirmed ||
          coverage.counters_unknown ||
          coverage.before_window ||
          coverage.roster_started_late,
        coverage,
        races,
      };
    }),
  };
}
