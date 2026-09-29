/**
 * Who belonged to a clan, and in what role, at a past instant (issue
 * #46): the facts a clan product needs to replay its own rules at each
 * war finish, built from the recorded membership intervals and the
 * clan's `role_changed` events. Pure, so the rules are tested apart from
 * the SQL (participation-sql.mjs reads the rows).
 *
 * The record knows the roster only at its reads. So the state at an
 * instant T is read at the last roster read at or before T and the first
 * at or after it, and it is served only when the two agree; when they
 * differ, the change happened somewhere between them and the entry is
 * null, never guessed. A membership interval runs from the read that
 * first showed the member (joined_observed_at) to the read that first
 * did not (left_observed_at). A role at a read is the role the interval
 * ends with, walked back through the `role_changed` events observed after
 * that read.
 *
 * Nulls, each for a stated reason:
 *   - the war week has no finish yet;
 *   - no roster read before the finish, or none since it;
 *   - membership differs between the two reads around the finish;
 *   - for the role: the member was not in the clan, the read before the
 *     finish predates the clan's role history (`role_history_since`: role
 *     changes were not recorded before the record's own first live read,
 *     since the imported roster history carries tenure only), the two
 *     reads disagree, or the interval's role events do not chain (an
 *     older roster admitted after a newer one leaves an inverted or
 *     out-of-order pair, and nothing then says which order was real).
 */

const ms = (v) =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.getTime()
      : Date.parse(v);

/** The membership interval holding read instant x, or null. A row whose
 *  leave does not follow its join is not an interval. */
function intervalAt(intervals, x) {
  return (
    intervals.find((m) => m.joined <= x && (m.left === null || x < m.left)) ??
    null
  );
}

/** The interval's role events, oldest first, and whether they chain: each
 *  event's role_before is the role the one before it left, the last one
 *  leaves the interval's own role, and no window runs backwards. */
function intervalEvents(interval, events) {
  const mine = events
    .filter(
      (e) =>
        e.we > interval.joined &&
        (interval.left === null || e.we <= interval.left),
    )
    .sort((a, b) => a.we - b.we || a.id - b.id);
  let chained = true;
  for (let i = 0; i < mine.length; i += 1) {
    const e = mine[i];
    if (e.ws > e.we) chained = false;
    if (i > 0 && mine[i - 1].after !== e.before) chained = false;
    if (i > 0 && mine[i - 1].id > e.id) chained = false;
  }
  if (mine.length && mine.at(-1).after !== interval.role) chained = false;
  return { mine, chained };
}

/** The role the interval held as of read instant x. */
function roleAtRead(interval, mine, x) {
  const next = mine.find((e) => e.we > x);
  return next ? next.before : interval.role;
}

/**
 * One player's columns aligned to the war weeks.
 *
 * @param {object} args
 * @param {Array<{joined_observed_at, left_observed_at, role}>} args.memberships
 *   every interval the player has in this clan
 * @param {Array<{event_id, window_start, window_end, role_before, role_after}>} args.roleEvents
 *   the player's role_changed events in this clan
 * @param {Array<{finish: string|null, prev: string|null, next: string|null}>} args.finishes
 *   per war week: its finish and the roster reads around it
 * @param {string|null} args.roleSince the clan's role_history_since
 * @returns {{ in_clan: Array<boolean|null>, role: Array<string|null> }}
 */
export function atWarFinishes({
  memberships,
  roleEvents,
  finishes,
  roleSince,
}) {
  const intervals = memberships
    .map((m) => ({
      joined: ms(m.joined_observed_at),
      left: ms(m.left_observed_at),
      role: m.role ?? null,
    }))
    .filter((m) => m.joined !== null && (m.left === null || m.left > m.joined));
  const events = roleEvents.map((e) => ({
    id: Number(e.event_id),
    ws: ms(e.window_start),
    we: ms(e.window_end),
    before: e.role_before ?? null,
    after: e.role_after ?? null,
  }));
  const since = ms(roleSince);
  const in_clan = [];
  const role = [];
  for (const f of finishes) {
    const prev = ms(f.prev);
    const next = ms(f.next);
    if (ms(f.finish) === null || prev === null || next === null) {
      in_clan.push(null);
      role.push(null);
      continue;
    }
    const a = intervalAt(intervals, prev);
    const b = intervalAt(intervals, next);
    // Present at both reads but in two different intervals: the member
    // left and came back between them, so the finish may sit in the gap.
    const inClan =
      Boolean(a) !== Boolean(b) || (a && b && a !== b) ? null : Boolean(a);
    in_clan.push(inClan);
    if (inClan !== true || since === null || prev < since) {
      role.push(null);
      continue;
    }
    const { mine, chained } = intervalEvents(a, events);
    if (!chained) {
      role.push(null);
      continue;
    }
    const before = roleAtRead(a, mine, prev);
    const after = roleAtRead(a, mine, next);
    role.push(before === after ? before : null);
  }
  return { in_clan, role };
}

/** The player's role changes observed from `from` on, oldest first. */
export function roleChangesSince(roleEvents, fromMs) {
  return roleEvents
    .filter((e) => ms(e.window_end) >= fromMs)
    .sort(
      (a, b) =>
        ms(a.window_end) - ms(b.window_end) ||
        Number(a.event_id) - Number(b.event_id),
    )
    .map((e) => ({
      role_before: e.role_before ?? null,
      role_after: e.role_after ?? null,
      window_start: new Date(e.window_start).toISOString(),
      observed_at: new Date(e.window_end).toISOString(),
    }));
}
