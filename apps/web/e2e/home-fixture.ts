import { ME, signedIn } from "./fixtures.ts";

/** The redesign's Home, as its head and its panels' reads answer it. */
const TAG = "#20JJJ2CCRU";
const CLAN = "#0QC8RCGY";
const CARDS = [
  [26000000, "Knight"],
  [26000001, "Archers"],
  [26000002, "Goblins"],
  [26000003, "Giant"],
  [26000004, "P.E.K.K.A"],
  [26000005, "Minions"],
  [26000006, "Balloon"],
  [26000007, "Witch"],
].map(([id, name]) => ({ id, name, form: "base" }));
/** The sitting's deck as the feed keeps it: each card with its cost. */
const SITTING_CARDS = CARDS.map((c, i) => ({
  ...c,
  elixir_cost: [3, 3, 2, 5, 7, 3, 5, 5][i],
}));
const DECK = {
  family: "ladder",
  label: "Giant beatdown",
  battles: 22,
  wins: 14,
  losses: 8,
  cards: CARDS,
};
const fixtureNow = process.env.ELIXIR_DESIGN_NOW
  ? Date.parse(process.env.ELIXIR_DESIGN_NOW)
  : Date.now();
const AGO = (min: number) => new Date(fixtureNow - min * 60_000).toISOString();

const FIRST = {
  ok: true,
  as_of: AGO(0),
  player: {
    player_tag: TAG,
    is_primary: true,
    relationship: "primary",
    name: "King Thing",
    verified: true,
    verified_at: "2026-10-12T15:00:00Z",
    tracked_since: "2026-09-01T15:00:00Z",
    recording_status: "active",
    profile_available: true,
    battlelog_observed_at: AGO(15),
    last_battle_at: AGO(60),
    battles_30d: 120,
    capture_attempts: [],
  },
  connection: { active_connections: 0, last_data_read_at: null },
  clan: { clan_tag: CLAN, name: "Ada's Clan", war_weeks: 12 },
};

export const HOME = {
  first: FIRST,
  clan: {
    ok: true,
    state: "member",
    clan_tag: CLAN,
    name: "Ada's Clan",
    role: "leader",
    verified: true,
    unlock: null,
    policy_set: true,
    members: 40,
    min_members: 10,
    last_race: {
      season_id: 137,
      section_index: 3,
      is_colosseum: false,
      rank: 2,
      fame: 84200,
    },
    war_decks: { decks: 8, asked: null, open: true },
    donations: 120,
    standing: null,
    clock: null,
    needs: [
      {
        number: 41,
        type: "departure",
        label: "Departure",
        subject_name: "Ada",
        left_at: AGO(600),
      },
      {
        number: 42,
        type: "removal",
        label: "Remove from the clan",
        subject_name: "Grace",
        headline: "12 days without a battle: at risk at 7, an action at 10.",
      },
    ],
    needs_total: 5,
  },
  week: {
    ok: true,
    from: AGO(3000),
    mode: "ladder",
    modes: {
      ladder: { battles: 37, wins: 23, losses: 14 },
      war: { battles: 4, wins: 3, losses: 1 },
    },
    record: { battles: 37, wins: 23, losses: 14 },
    net_trophies: 86,
    trophies: 9412,
    deck: DECK,
    last_battle_at: null,
  },
};

const window = { from: AGO(10_080), to: AGO(0) };
/** Home's one feed (#765): your sitting with its sparkline, your clan's
 *  line, a friend's moment with its battle. Synthetic friends and clans. */
const FRIEND = "#00C298UC";
const TIMELINE = {
  window,
  seen_to: AGO(120),
  timeline_more: 46,
  timeline: [
    {
      id: "n1",
      at: AGO(30),
      observed_at: AGO(29),
      subject_tag: TAG,
      subject_name: "King Thing",
      subjects: [{ tag: TAG, kind: "player", name: "King Thing" }],
      text: "Won 3 of 5 in Trophy Road.",
      kind: "battle_session",
      facts: {
        player_tag: TAG,
        started_at: AGO(70),
        ended_at: AGO(30),
        battles: 5,
        won: 3,
        lost: 2,
        drawn: 0,
        by_mode: { ladder: 5 },
        trophy_net: 28,
        won_in_a_row: 2,
        // Played as live sittings are (2026-11-16): two decks, the art
        // kept for the one played most.
        decks: [
          { label: "Giant beatdown", battles: 4 },
          { label: "Hog Rider cycle", battles: 1 },
        ],
        events: [],
        open: false,
      },
      deck: { label: "Giant beatdown", cards: SITTING_CARDS },
      scores: { best_win: "3-0", three_crowns: 1 },
      groups: ["you"],
      spark: [
        { r: "w", m: 3 },
        { r: "l", m: 1 },
        { r: "w", m: 2 },
        { r: "w", m: 1 },
        { r: "l", m: 2 },
      ],
      evidence: { kind: "session", version: "v1" },
    },
    {
      id: "c1",
      at: AGO(600),
      observed_at: AGO(599),
      subject_tag: CLAN,
      subject_name: "Ada's Clan",
      subjects: [{ tag: CLAN, kind: "clan", name: "Ada's Clan" }],
      text: "Ada's Clan finished 2nd in the river race.",
      kind: "war_race_finished",
      facts: {},
      groups: ["clan"],
    },
    {
      id: "o1",
      at: AGO(4000),
      observed_at: AGO(3999),
      subject_tag: FRIEND,
      subject_name: "Ada",
      subjects: [{ tag: FRIEND, kind: "player", name: "Ada" }],
      text: "Reached Path of Legends.",
      kind: "pol_league",
      facts: {},
      groups: ["friends"],
      battle_url: "https://elixir.example.test/battle/b2c3d4e5f6a7",
      // Cheers (#765): counts only, and none of them yours yet.
      cheers: { on_fire: 2 },
      my_cheer: null,
    },
  ],
};

const EVIDENCE: [number, unknown] = [
  200,
  {
    kind: "session",
    observed_at: AGO(29),
    count: 1,
    through: AGO(30),
    open: false,
    completeness: "complete",
    order: "newest_first",
    next_offset: null,
    decks: [],
    battles: [
      {
        battle_id: "b1",
        url: "/battle/b1",
        at: AGO(30),
        mode_group: "ladder",
        outcome: "win",
        crowns: 3,
        trophy_change: 30,
        opponents: [
          {
            player_tag: "#0P2GQ28C",
            name: "Rowan",
            crowns: 0,
            clan_tag: null,
            clan_name: null,
          },
        ],
      },
    ],
  },
];

/** Home's own reads for an account whose player is on record, so /home
 *  draws its feed rather than a new account's steps. */
export const HOME_READS = {
  "GET /api/me/home": [200, { first: HOME.first }],
  "GET /api/me/home/clan": [200, { clan: HOME.clan }],
  "GET /api/me/home/needs": [200, { needs: HOME.clan }],
  "GET /api/me/home/week": [200, { week: HOME.week }],
  // People to follow (2026-11-12): nobody new, and the slots line.
  "GET /api/me/people/suggested": [
    200,
    { ok: true, people: [], used: 3, limit: 50 },
  ],
  // Home's suggested follows (2026-11-13): not offered unless a test says.
  "GET /api/me/people/starter": [200, { ok: true, offer: false, people: [] }],
  // Find's Suggested (2026-11-13): nobody yet unless a test says.
  "GET /api/me/people/find": [
    200,
    { ok: true, days: 30, people: [], more: 0, used: 3, limit: 50 },
  ],
} satisfies Parameters<typeof signedIn>[0];

/** The sitting's own page (GET /api/player/session, 2026-11-16). */
const SITTING = TIMELINE.timeline.find((it) => it.kind === "battle_session");
const SESSION_PAGE: [number, unknown] = [
  200,
  {
    player: { tag: TAG, name: "King Thing" },
    you: { own: true, can_highlight: true },
    item: SITTING,
    games: {
      ...(EVIDENCE[1] as object),
      item_id: "n1",
      version: "v1",
      offset: 0,
      limit: 25,
    },
    marks: [],
  },
];

export const homeApi = (overrides: Parameters<typeof signedIn>[0] = {}) =>
  signedIn({
    "GET /api/me": [200, ME],
    ...HOME_READS,
    "GET /api/me/timeline": (route) =>
      new URL(route.request().url()).searchParams.has("evidence_item_id")
        ? EVIDENCE
        : [200, TIMELINE],
    "POST /api/me/timeline/seen": [200, { seen_to: window.to }],
    "GET /api/me/timeline/discord": [200, { enabled: true }],
    "GET /api/player/session": SESSION_PAGE,
    ...overrides,
  });

/** Home's profile list (#1015): the owner's passport read with the six
 *  steps in the given states. Not part of HOME_READS: a test that wants
 *  the list names it. */
const PROFILE_IDS = [
  "add_player",
  "verify_player",
  "picture",
  "follow_active",
  "digest",
  "map",
];
export const ownerPassport = (
  states: string[],
  profile: Record<string, unknown> = {},
) => ({
  owner: {
    profile: {
      version: 2,
      complete: false,
      completed_at: null,
      older_welcome_finished: false,
      dismissed_at: null,
      follows: { following: 0, active: 0, unknown: 0 },
      steps: PROFILE_IDS.map((id, i) => ({
        id,
        state: states[i],
        latched: false,
      })),
      ...profile,
    },
    stamps: [],
  },
});
