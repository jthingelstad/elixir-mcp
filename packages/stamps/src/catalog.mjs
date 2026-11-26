/**
 * The Stamp catalog: the eleven definitions, their level ladders and the
 * six-step profile list, as plain data.
 *
 * This file is the one source of truth for both sides. It imports
 * nothing, reads no clock and touches no database or browser API, so the
 * web app can import `@elixir-mcp/stamps/catalog` without pulling any
 * server code, and the store and eligibility modules beside it read the
 * same objects. The design file docs/design/passport/catalog.json is the
 * prototype's copy; test/catalog.test.mjs fails when the two drift.
 *
 * Stable ids never change once shipped: earned rows and facts are keyed
 * by them. A change to a rule or ladder that could move who has earned
 * what is a new CATALOG_VERSION, and each earned row keeps the version it
 * was granted under (account_stamp_earned.definition_version).
 *
 * Words here are player-facing (AGENTS.md "Voice"): short, plain, and
 * only what the code does.
 */

/** Bumped when a definition's rule or ladder changes meaning. */
export const CATALOG_VERSION = 1;

/** How a Stamp's progress is counted:
 *  - "once": a single milestone, earned or not (level 1 only);
 *  - "players": distinct other followed players active in the trailing
 *    seven days (Inner Circle), counted live, never stored;
 *  - "days": distinct local days, stored as facts (account_stamp_fact);
 *  - "battles": distinct battles, stored as facts. */
export const COUNTING = Object.freeze({
  ONCE: "once",
  PLAYERS: "players",
  DAYS: "days",
  BATTLES: "battles",
});

const define = (d) =>
  Object.freeze({ ...d, thresholds: Object.freeze([...d.thresholds]) });

export const STAMPS = Object.freeze(
  [
    {
      id: "player_verified",
      name: "Player verified",
      group: "Getting started",
      icon: "fingerprint",
      shape: "round",
      ink: "violet",
      rule: "Verify one of your players in Elixir.",
      action: "Verify your player",
      destination: "verification",
      thresholds: [1],
      unit: "verification",
      counting: COUNTING.ONCE,
      optional: false,
    },
    {
      id: "looking_good",
      name: "Looking Good",
      group: "Getting started",
      icon: "image",
      shape: "square",
      ink: "blue",
      rule: "Choose your profile picture.",
      action: "Pick your picture",
      destination: "picture",
      thresholds: [1],
      unit: "picture",
      counting: COUNTING.ONCE,
      optional: false,
    },
    {
      id: "on_the_map",
      name: "On the Map",
      group: "Getting started",
      icon: "map-pin",
      shape: "round",
      ink: "teal",
      rule: "Set your place on your clan’s map. Country, region or city all count.",
      action: "Set your place",
      destination: "map-view",
      thresholds: [1],
      unit: "place",
      counting: COUNTING.ONCE,
      optional: true,
    },
    {
      id: "full_roster",
      name: "Full Roster",
      group: "Getting started",
      icon: "users-round",
      shape: "square",
      ink: "coral",
      rule: "Add another of your players.",
      action: "Your other players",
      destination: "alts",
      thresholds: [1],
      unit: "alt",
      counting: COUNTING.ONCE,
      optional: true,
    },
    {
      id: "linked",
      name: "Linked",
      group: "Getting started",
      icon: "link-2",
      shape: "round",
      ink: "violet",
      rule: "Connect Discord to Elixir.",
      action: "Connections",
      destination: "discord",
      thresholds: [1],
      unit: "connection",
      counting: COUNTING.ONCE,
      optional: true,
    },
    {
      id: "all_set",
      name: "All Set",
      group: "Getting started",
      icon: "book-open",
      shape: "square",
      ink: "teal",
      rule: "Finish the six steps in Getting set up. Email off and a map choice of Not now both count.",
      action: "Getting set up",
      destination: "home",
      thresholds: [1],
      unit: "profile",
      counting: COUNTING.ONCE,
      optional: false,
    },
    {
      id: "inner_circle",
      name: "Inner Circle",
      group: "Your circle",
      icon: "users",
      shape: "round",
      ink: "blue",
      rule: "Follow five people with a recorded battle in the last seven days.",
      action: "Find your people",
      destination: "friends",
      thresholds: [5],
      unit: "people",
      counting: COUNTING.PLAYERS,
      optional: false,
    },
    {
      id: "mutual",
      name: "Mutual",
      group: "Your circle",
      icon: "repeat",
      shape: "square",
      ink: "coral",
      rule: "Someone you follow follows you back. No need to ask for a follow back.",
      action: "Your people",
      destination: "friends",
      thresholds: [1],
      unit: "mutual follow",
      counting: COUNTING.ONCE,
      optional: false,
    },
    {
      id: "played_together",
      name: "Played Together",
      group: "Playing together",
      icon: "swords",
      shape: "square",
      ink: "blue",
      rule: "Play a friendly battle or 2v2 with someone you follow, on 1, 5 and 20 different days. Wins do not matter.",
      action: "Your player",
      destination: "player",
      thresholds: [1, 5, 20],
      unit: "days",
      counting: COUNTING.DAYS,
      optional: false,
    },
    {
      id: "cheerleader",
      name: "Cheerleader",
      group: "Playing together",
      icon: "heart-pulse",
      shape: "round",
      ink: "coral",
      rule: "Cheer someone on 3, 15 and 50 different days. The days do not have to be in a row.",
      action: "Open your Timeline",
      destination: "home",
      thresholds: [3, 15, 50],
      unit: "days",
      counting: COUNTING.DAYS,
      optional: false,
    },
    {
      id: "storyteller",
      name: "Storyteller",
      group: "Playing together",
      icon: "message-square",
      shape: "square",
      ink: "violet",
      rule: "Post about 1, 5 and 20 different battles with words of your own.",
      action: "Your posts",
      destination: "player",
      thresholds: [1, 5, 20],
      unit: "battle posts",
      counting: COUNTING.BATTLES,
      optional: false,
    },
  ].map(define),
);

export const STAMP_IDS = Object.freeze(STAMPS.map((s) => s.id));

const BY_ID = new Map(STAMPS.map((s) => [s.id, s]));

/** The definition for an id, or null for an id the catalog does not know. */
export function stampById(id) {
  return BY_ID.get(id) ?? null;
}

/** The number of levels a Stamp has: 1 for a milestone, 3 for a ladder. */
export function levelCount(id) {
  return stampById(id)?.thresholds.length ?? 0;
}

/** The Stamps whose progress is stored as facts, and each one's cap: the
 *  top threshold. Past it nothing more is stored (20 + 50 + 20 = 90 facts
 *  a person at most). */
export const FACT_CAPS = Object.freeze(
  Object.fromEntries(
    STAMPS.filter(
      (s) => s.counting === COUNTING.DAYS || s.counting === COUNTING.BATTLES,
    ).map((s) => [s.id, s.thresholds.at(-1)]),
  ),
);

/** The level a count reaches: 0 below the first threshold. */
export function levelFor(id, count) {
  const def = stampById(id);
  if (!def || !Number.isFinite(count)) return 0;
  let level = 0;
  for (const t of def.thresholds) if (count >= t) level += 1;
  return level;
}

/**
 * The six-step profile list, version 2. Version 1 is Home's older
 * four-step welcome checklist (account.welcome_finished_at, 0246), which
 * keeps its own marker; this list never clears it.
 */
export const PROFILE_LIST_VERSION = 2;

export const PROFILE_STEPS = Object.freeze(
  [
    { id: "add_player", label: "Add your player." },
    { id: "verify_player", label: "Verify your main player." },
    { id: "picture", label: "Pick your picture." },
    {
      id: "follow_active",
      label: "Follow one player who has played in the last seven days.",
    },
    { id: "digest", label: "Choose your emails: daily, weekly or season." },
    { id: "map", label: "Choose for the clan map: set a place or Not now." },
  ].map((s) => Object.freeze(s)),
);

/** The map choices that count for the map step. Only "place" can ever
 *  grant On the Map, and only once a save has succeeded. */
export const MAP_CHOICES = Object.freeze(["place", "not_now"]);

/** A followed player counts as active with a recorded battle in this
 *  many trailing days (Inner Circle, the follow step). */
export const ACTIVE_WINDOW_DAYS = 7;
