/** Factual game calendar and tournament observations. No leaderboard capture. */
const byTag = (rows, key = "tag") =>
  [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));

/**
 * What is on (0069). /events is the modes and challenges running now, with
 * no dates, so the calendar is built from sightings: the event row is the
 * thing, a day row is a day it was seen running.
 */
export async function projectEvents(db, { payload, fetchedAt }) {
  const observedAt = new Date(fetchedAt);
  const day = observedAt.toISOString().slice(0, 10);
  const events = byTag(
    (Array.isArray(payload) ? payload : []).filter(
      (e) => typeof e?.eventTag === "string",
    ),
    "eventTag",
  );
  if (events.length === 0) return { projected: "events", events: 0 };
  await db.query(
    `insert into game_event (event_tag, title, description, first_seen_at, last_seen_at)
     select t.tag, t.title, t.description, $4, $4
     from unnest($1::text[], $2::text[], $3::text[]) as t(tag, title, description)
     on conflict (event_tag) do update set
       title = coalesce(excluded.title, game_event.title),
       description = coalesce(excluded.description, game_event.description),
       last_seen_at = greatest(game_event.last_seen_at, excluded.last_seen_at),
       first_seen_at = least(game_event.first_seen_at, excluded.first_seen_at)`,
    [
      events.map((e) => e.eventTag),
      events.map((e) => e.title ?? null),
      events.map((e) => e.description ?? null),
      observedAt,
    ],
  );
  await db.query(
    `insert into game_event_day (event_tag, day)
     select unnest($1::text[]), $2::date on conflict do nothing`,
    [events.map((e) => e.eventTag), day],
  );
  return {
    projected: "events",
    events: events.length,
    day,
    facts: events.length,
  };
}

/** Global tournaments (0069): the payload is archived, nothing projects
 *  it since 0094 (game_tournament was written and never read). The
 *  receipt still counts the observation. */
export async function projectTournaments(_db, { payload }) {
  const items = (payload?.items ?? []).filter(
    (t) => typeof t?.tag === "string",
  );
  return {
    projected: "tournaments",
    tournaments: items.length,
    facts: 0,
  };
}
