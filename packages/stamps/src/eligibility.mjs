/**
 * Pure eligibility: which Stamps and levels a snapshot of an account has
 * earned, the six-step profile list's state, and the owner's exact
 * progress.
 *
 * Deterministic: everything comes in through the snapshot and an explicit
 * `now`. Nothing here reads a database, a clock, the network or the
 * browser, so the same snapshot always gives the same answer, and the
 * tests can walk every edge rule without one.
 *
 * The snapshot (store.mjs readSnapshot builds it; a hook may build a
 * smaller one). Every field may be null, which means "not known", never
 * "no":
 *
 *   person          boolean   a person account
 *   primary         { verified } | null   the account's primary claim
 *   own_verified    boolean   a primary or alt claim currently verified
 *   has_alt         boolean   an own alt claim (relationship 'alt'), any status
 *   picture_chosen  boolean   an explicit non-null profile picture
 *   discord_linked  boolean   a Discord connection
 *   email_chosen    boolean   a digest email switch the person moved
 *                   (daily, weekly or season; not an operator's)
 *   map             { choice: 'place' | 'not_now' | null, place_saved: boolean }
 *   follows         [{ last_battle_at, battle_log_read_at }] | null
 *                   the OTHER players followed (own primary/alts already
 *                   left out), ISO instants or null
 *   mutual_count    number    accounts that follow one of yours back
 *   facts           { played_together, cheerleader, storyteller } counts
 *   latches         { add_player, verify_player, picture, follow_active,
 *                     digest, map, completed_at } ISO instants or null
 *   earned          [{ stamp_id, level }]   what is already granted
 */
import {
  ACTIVE_WINDOW_DAYS,
  CATALOG_VERSION,
  COUNTING,
  MAP_CHOICES,
  PROFILE_LIST_VERSION,
  PROFILE_STEPS,
  STAMPS,
  levelFor,
} from "./catalog.mjs";

const DAY_MS = 24 * 3600 * 1000;

/** A followed player whose battle log was read this recently, with no
 *  battle in the window, is known to be inactive. A staler read is
 *  "recording is catching up": unknown, never inactive. The battle log
 *  holds the last 25 battles, so one fresh read sees any battle in the
 *  window. [engineering default] */
export const ACTIVITY_FRESH_HOURS = 24;

const instant = (v) => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

const nowMs = (now) => {
  const t = instant(now);
  if (t === null) throw new TypeError("eligibility needs an explicit now");
  return t;
};

/**
 * One followed player's activity at `now`: "active" (a recorded battle in
 * the trailing seven days, none from the future), "inactive" (a fresh
 * battle-log read with no battle in the window) or "unknown".
 */
export function followActivity(follow, now) {
  const at = nowMs(now);
  const last = instant(follow?.last_battle_at);
  if (last !== null && last <= at && last >= at - ACTIVE_WINDOW_DAYS * DAY_MS)
    return "active";
  const read = instant(follow?.battle_log_read_at);
  if (read !== null && read <= at && read >= at - ACTIVITY_FRESH_HOURS * 3600e3)
    return "inactive";
  return "unknown";
}

/** Counts of the followed players' activity, or null when the follows
 *  are not known. */
function activityCounts(follows, now) {
  if (!Array.isArray(follows)) return null;
  const out = { active: 0, inactive: 0, unknown: 0 };
  for (const f of follows) out[followActivity(f, now)] += 1;
  return out;
}

/** "done", "todo" or "unknown" from a live condition (true, false or
 *  null) and a stored latch. A latched step stays done. */
const stepState = (live, latched) =>
  latched
    ? "done"
    : live === true
      ? "done"
      : live === null
        ? "unknown"
        : "todo";

/**
 * The six-step profile list: each step's state, whether it was latched,
 * and whether the list is complete. Complete is stored once
 * (latches.completed_at) and then stays complete whatever changes.
 *
 * `follows` counts the other players followed by their activity
 * (followActivity), or null when the follows are not known, so the
 * follow step can tell "nobody followed yet" from "the players you
 * follow haven't played" from "recording is catching up". Owner-only:
 * the public projection never carries the profile list.
 */
export function profileList(snapshot, now) {
  const s = snapshot ?? {};
  const latches = s.latches ?? {};
  const activity = activityCounts(s.follows, now);
  const live = {
    add_player: s.primary === undefined ? null : s.primary !== null,
    // The primary player, not an alt: All Set needs the main one proved.
    verify_player:
      s.primary === undefined
        ? null
        : s.primary !== null && s.primary.verified === true,
    picture: s.picture_chosen ?? null,
    follow_active:
      activity === null
        ? null
        : activity.active > 0
          ? true
          : activity.unknown > 0
            ? null
            : false,
    digest: s.email_chosen === undefined ? null : s.email_chosen === true,
    map:
      s.map === undefined || s.map === null
        ? null
        : MAP_CHOICES.includes(s.map.choice) || s.map.place_saved === true,
  };
  const steps = PROFILE_STEPS.map(({ id }) => ({
    id,
    state: stepState(live[id], Boolean(latches[id])),
    latched: Boolean(latches[id]),
  }));
  const allDone = steps.every((x) => x.state === "done");
  return {
    version: PROFILE_LIST_VERSION,
    complete: Boolean(latches.completed_at) || allDone,
    completed_at: latches.completed_at ?? null,
    steps,
    follows:
      activity === null ? null : { following: s.follows.length, ...activity },
  };
}

/** Whether a once-Stamp's condition holds: true, false or null (unknown). */
function onceCondition(id, s, profile) {
  switch (id) {
    case "player_verified":
      return s.person === true ? (s.own_verified ?? null) : false;
    case "looking_good":
      return s.picture_chosen ?? null;
    case "on_the_map":
      // Only a successful save. Not now, a cleared place or opening the
      // map never earns it.
      return s.map == null ? null : s.map.place_saved === true;
    case "full_roster":
      return s.has_alt ?? null;
    case "linked":
      return s.discord_linked ?? null;
    case "all_set":
      return profile.complete;
    case "mutual":
      return s.mutual_count == null ? null : s.mutual_count >= 1;
    default:
      return null;
  }
}

/**
 * Evaluate a snapshot at `now`.
 *
 * Returns { catalog_version, profile, stamps, grants }:
 *  - stamps: one row per definition, in catalog order:
 *    { stamp_id, earned_level, eligible_level, progress }, where
 *    progress is { count, next, top, unknown, pending? }: the exact count
 *    toward the ladder, the next threshold (null once the top is
 *    reached), the top threshold, whether the count rests on unknown
 *    inputs, and for Inner Circle the followed players whose activity is
 *    unknown. Earned levels never go down here: a Stamp stays earned when
 *    its condition later lapses.
 *  - grants: [{ stamp_id, level }] for every eligible level not yet
 *    earned, lowest first. Hand it to store.grantStamps.
 *
 * Wins, trophies, rank and win rate are not inputs, so they cannot grant.
 * A non-person snapshot earns nothing.
 */
export function evaluatePassport(snapshot, now) {
  nowMs(now);
  const s = snapshot ?? {};
  const profile = profileList(s, now);
  const earnedLevel = new Map();
  for (const e of s.earned ?? [])
    earnedLevel.set(
      e.stamp_id,
      Math.max(earnedLevel.get(e.stamp_id) ?? 0, Number(e.level) || 0),
    );
  const person = s.person === true;
  const activity = activityCounts(s.follows, now);
  const stamps = STAMPS.map((def) => {
    const top = def.thresholds.at(-1);
    let count = 0;
    let unknown = false;
    let pending;
    if (def.counting === COUNTING.ONCE) {
      const ok = onceCondition(def.id, s, profile);
      count = ok === true ? 1 : 0;
      unknown = ok === null;
    } else if (def.counting === COUNTING.PLAYERS) {
      count = activity?.active ?? 0;
      pending = activity?.unknown ?? null;
      unknown = activity === null || activity.unknown > 0;
    } else {
      const n = s.facts?.[def.id];
      count = Number.isFinite(Number(n)) && n !== null ? Number(n) : 0;
      unknown = n == null;
    }
    count = Math.min(count, top);
    const eligible = person ? levelFor(def.id, count) : 0;
    const earned = earnedLevel.get(def.id) ?? 0;
    const next = def.thresholds.find((t) => t > count) ?? null;
    return {
      stamp_id: def.id,
      earned_level: earned,
      eligible_level: eligible,
      progress: {
        count,
        next,
        top,
        unknown,
        ...(pending !== undefined ? { pending } : {}),
      },
    };
  });
  const grants = [];
  for (const row of stamps)
    for (let level = row.earned_level + 1; level <= row.eligible_level; level++)
      grants.push({ stamp_id: row.stamp_id, level });
  return { catalog_version: CATALOG_VERSION, profile, stamps, grants };
}
