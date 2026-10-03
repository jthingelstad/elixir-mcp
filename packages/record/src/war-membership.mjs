/** Private Clan award evidence over preserved game records. Missing weekly
 * counters are never zero merely because a player rejoined later. Absence
 * needs roster observations outside both period boundaries and no recorded
 * membership interval overlapping that entire observed span. No writes. */
import { rosterHistoryQueries } from "./participation-sql.mjs";
import { nominalPeriodBoundsMs } from "./war-clock.mjs";

const ms = (value) => (value == null ? null : new Date(value).getTime());

function absentAtPeriods({ participation, memberships, boundaries, periods }) {
  const active = ms(participation.recording_active_since);
  const firstRoster = ms(participation.first_roster_observed_at);
  const reads = new Map(boundaries.map((r) => [Number(r.i) - 1, r]));
  return Object.fromEntries(
    participation.members.map((member) => {
      const intervals = memberships.filter(
        (m) => m.player_tag === member.player_tag,
      );
      const invalid =
        !intervals.length ||
        intervals.some(
          (m) =>
            !Number.isFinite(ms(m.joined_observed_at)) ||
            (m.left_observed_at != null &&
              (!Number.isFinite(ms(m.left_observed_at)) ||
                ms(m.left_observed_at) <= ms(m.joined_observed_at))),
        );
      const absent = periods.map((week, i) => {
        const start = ms(week.started_observed_at),
          finish = ms(week.finished_observed_at);
        const before = ms(reads.get(i)?.before_start),
          after = ms(reads.get(i)?.after_finish);
        if (
          invalid ||
          ![active, firstRoster, start, finish, before, after].every(
            Number.isFinite,
          ) ||
          active > before ||
          firstRoster > before ||
          before > start ||
          after < finish ||
          finish < start
        )
          return null;
        return !intervals.some(
          (m) =>
            ms(m.joined_observed_at) <= after &&
            (m.left_observed_at == null || ms(m.left_observed_at) > before),
        );
      });
      return [member.player_tag, absent];
    }),
  );
}

export function absentAtWarWeeks(input) {
  return absentAtPeriods({ ...input, periods: input.participation.war_weeks });
}

// Donation labels use ISO dates, but snapshots belong to game days. The
// canonical reset grid converts each label to its own Monday-to-Monday span;
// a shorter observed race span cannot prove absence for these counters.
function donationBoundary(value) {
  const at = ms(value);
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  const noon = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    12,
  );
  return new Date(nominalPeriodBoundsMs(noon, 0).startMs).toISOString();
}

export async function warMembershipEvidence(db, clanTag, participation) {
  if (
    participation.members.length > 50 ||
    participation.war_weeks.length > 16 ||
    (participation.weeks?.length ?? 0) > 8
  )
    throw new RangeError(
      "War membership evidence is bounded to one clan and eight weeks.",
    );
  if (!participation.war_weeks.some((w) => w.finished_observed_at)) return {};
  const tags = participation.members.map((m) => m.player_tag);
  const q = rosterHistoryQueries({
    clanTag,
    tags,
    finishes: [],
    since: new Date(0),
  }).find((r) => r.name === "memberships");
  const memberships = (await db.query(q.text, q.values)).rows;
  const donationPeriods = (participation.weeks ?? []).map((w) => ({
    started_observed_at: donationBoundary(w.from),
    finished_observed_at: donationBoundary(w.to),
  }));
  const periods = [...participation.war_weeks, ...donationPeriods];
  const boundaries = (
    await db.query(
      `select t.i::int as i,
    (select max(r.fetched_at) from api_receipt r
      where r.entity_key=$1 and r.endpoint='clan' and r.admission='admitted'
        and r.fetched_at <= t.started) as before_start,
    (select min(r.fetched_at) from api_receipt r
      where r.entity_key=$1 and r.endpoint='clan' and r.admission='admitted'
        and r.fetched_at >= t.finished) as after_finish
    from unnest($2::timestamptz[], $3::timestamptz[]) with ordinality as t(started,finished,i)
    where t.started is not null and t.finished is not null`,
      [
        clanTag,
        periods.map((w) => w.started_observed_at),
        periods.map((w) => w.finished_observed_at),
      ],
    )
  ).rows;
  return {
    war: absentAtWarWeeks({ participation, memberships, boundaries }),
    donations: absentAtPeriods({
      participation,
      memberships,
      periods: donationPeriods,
      boundaries: boundaries
        .filter((r) => Number(r.i) > participation.war_weeks.length)
        .map((r) => ({
          ...r,
          i: Number(r.i) - participation.war_weeks.length,
        })),
    }),
  };
}
