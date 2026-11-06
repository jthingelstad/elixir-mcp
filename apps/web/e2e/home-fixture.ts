import { ME, signedIn } from "./fixtures.ts";

/** The redesign's Home, as its head and its panels' reads answer it. */
const TAG = "#20JJJ2CCRU";
const CLAN = "#2PQRJ8LV";
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
const DECK = {
  family: "ladder",
  label: "Giant beatdown",
  battles: 22,
  wins: 14,
  losses: 8,
  cards: CARDS,
};
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

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
  latest: {
    ok: true,
    items: [
      { id: "a", at: AGO(30), text: "Crossed 9,400 trophies." },
      { id: "b", at: AGO(300), text: "Won 3 of 5 in Path of Legends." },
    ],
  },
};

export const FRIENDS = {
  own_clan_tag: CLAN,
  week: { label: "Oct 26 – Nov 2", key: "2026-10-26" },
  friends: [
    {
      tag: "#2YG98VVQ",
      name: "Ada",
      nickname: null,
      clan_tag: CLAN,
      battles: 41,
      wins: 29,
      losses: 12,
      by_family: [
        { mode: "ladder", battles: 33, wins: 24, losses: 9 },
        { mode: "war", battles: 8, wins: 5, losses: 3 },
      ],
      moments: [{ text: "Reached Path of Legends." }],
      deck: { ...DECK, battles: 19 },
      line: null,
    },
  ],
  watching: [
    {
      tag: "#PYLQGRJC",
      name: "Grace",
      nickname: null,
      clan_tag: null,
      battles: 63,
      wins: 34,
      losses: 29,
      by_family: [],
      moments: [],
      deck: null,
      line: "63 battles, 34W-29L; back after 12 quiet days",
    },
  ],
  quiet: [
    { tag: "#9VUP08YL", name: "Edsger", days: 8, relationship: "friend" },
    { tag: "#2PP0V9PP", name: "Barbara", days: 40, relationship: "watching" },
  ],
};

const window = { from: AGO(10_080), to: AGO(0) };
const TIMELINE = {
  window,
  seen_to: AGO(120),
  timeline_more: 46,
  timeline: [
    {
      id: "n1",
      at: AGO(30),
      observed_at: AGO(29),
      subject_name: "King Thing",
      text: "Won 3 of 5 in Trophy Road.",
      kind: "session",
      evidence: { kind: "session", version: "v1" },
    },
    {
      id: "o1",
      at: AGO(4000),
      observed_at: AGO(3999),
      subject_name: "Ada",
      text: "Reached Path of Legends.",
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
    next_offset: null,
    battles: [
      {
        battle_id: "b1",
        url: "/battle/b1",
        at: AGO(30),
        mode_group: "Trophy Road",
        outcome: "Win",
      },
    ],
  },
];

export const homeApi = (overrides: Parameters<typeof signedIn>[0] = {}) =>
  signedIn({
    "GET /api/me": [200, ME],
    "GET /api/me/home": [200, { first: HOME.first }],
    "GET /api/me/home/clan": [200, { clan: HOME.clan }],
    "GET /api/me/home/needs": [200, { needs: HOME.clan }],
    "GET /api/me/home/week": [200, { week: HOME.week }],
    "GET /api/me/home/latest": [200, { latest: HOME.latest }],
    "GET /api/me/home/friends": [200, FRIENDS],
    "GET /api/me/timeline": (route) =>
      new URL(route.request().url()).searchParams.has("evidence_item_id")
        ? EVIDENCE
        : [200, TIMELINE],
    "POST /api/me/timeline/seen": [200, { seen_to: window.to }],
    "GET /api/me/timeline/discord": [200, { enabled: true }],
    ...overrides,
  });
