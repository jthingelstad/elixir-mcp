/**
 * Which river race period is open at an instant, from the calendar
 * (war_period, 0105) rather than from a clan's last observed anchor.
 * The grid is global and a pure function of time, so "what day is it"
 * never depends on which poll came first or how stale it is; the anchor
 * (war_period_anchor, written by the race projector) is kept beside it
 * as the observation - when it names this very period, the reader can
 * cite when the recorder first saw it open and how far that sat from
 * the policy hour. A stale or missing anchor no longer blanks the day.
 *
 * `kind` keeps the vocabulary the tools have always spoken, training /
 * war: colosseum is the section's property (war_week.is_colosseum), not
 * the day's.
 */

const DAY_MS = 86_400_000;
const TRAINING_DAYS = 3;

export async function periodAt(db, atMs) {
  const { rows } = await db.query(
    `select war_season_id, period_index, section_index, day_in_section, kind, war_day,
            starts_at, ends_at
     from war_period where starts_at <= $1 and ends_at > $1`,
    [new Date(atMs)],
  );
  const p = rows[0];
  if (!p) return null;
  const startMs = p.starts_at.getTime();
  const sectionStartMs = startMs - p.day_in_section * DAY_MS;
  return {
    warSeasonId: p.war_season_id,
    periodIndex: p.period_index,
    sectionIndex: p.section_index,
    dayInSection: p.day_in_section,
    kind: p.kind === "training" ? "training" : "war",
    warDay: p.war_day,
    startMs,
    endMs: p.ends_at.getTime(),
    weekEndMs: sectionStartMs + 7 * DAY_MS,
    nextWarDayOpensMs:
      p.war_day === null
        ? startMs + (TRAINING_DAYS - p.day_in_section) * DAY_MS
        : null,
  };
}

/** The clan's own sighting of that period, if it has one: the anchor
 *  row naming this period_index whose first sighting sits inside the
 *  period (an hour of early drift allowed, as the race projector
 *  allows). Null otherwise - the day is still known, the sighting not. */
export async function observedStart(db, clanTag, period) {
  if (!period) return null;
  const { rows } = await db.query(
    `select first_observed_at from war_period_anchor
     where clan_tag = $1 and period_index = $2
       and first_observed_at >= $3::timestamptz - interval '1 hour'
       and first_observed_at < $4
     order by first_observed_at desc limit 1`,
    [
      clanTag,
      period.periodIndex,
      new Date(period.startMs),
      new Date(period.endMs),
    ],
  );
  return rows[0]?.first_observed_at ?? null;
}
