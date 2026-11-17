import { homeApi } from "./home-fixture.ts";

/**
 * A realistic day of sessions (the session card and page, 2026-11-16): a
 * twelve-battle Trophy Road sitting played with two decks and a five-win
 * streak, a one-battle sitting, a Path of Legends sitting and an event
 * sitting, beside a moment and a clan's line. Invented players only; the
 * cards are real catalog ids, so the built site's art draws.
 */
const fixtureNow = process.env.ELIXIR_DESIGN_NOW
  ? Date.parse(process.env.ELIXIR_DESIGN_NOW)
  : Date.now();
const AGO = (min: number) => new Date(fixtureNow - min * 60_000).toISOString();

type Card = { id: number; name: string; form: string; elixir_cost: number };
const card = (id: number, name: string, elixir_cost: number, form = "base") =>
  ({ id, name, form, elixir_cost }) satisfies Card;

export const ME_TAG = "#20JJJ2CCRU";
const ADA = "#00C298UC";
const JUNIPER = "#00JR9YVQ2";
const PIP = "#00JRQGUCG";
const CLAN = "#0QC8RCGY";

export const HOG = {
  label: "Hog Rider cycle",
  cards: [
    card(26000021, "Hog Rider", 4),
    card(26000014, "Musketeer", 4, "evolution"),
    card(26000038, "Ice Golem", 2),
    card(26000030, "Ice Spirit", 1),
    card(26000010, "Skeletons", 1),
    card(27000000, "Cannon", 3),
    card(28000000, "Fireball", 4),
    card(28000011, "The Log", 2),
  ],
};
export const GIANT = {
  label: "Giant beatdown",
  cards: [
    card(26000003, "Giant", 5),
    card(26000007, "Witch", 5),
    card(26000005, "Minions", 3),
    card(26000018, "Mini P.E.K.K.A", 4),
    card(26000001, "Archers", 3),
    card(26000013, "Bomber", 2),
    card(28000001, "Arrows", 3),
    card(28000008, "Zap", 2),
  ],
};
const GOLEM = {
  label: "Golem beatdown",
  cards: [
    card(26000009, "Golem", 8),
    card(26000048, "Night Witch", 4),
    card(26000015, "Baby Dragon", 4),
    card(26000035, "Lumberjack", 4),
    card(26000039, "Mega Minion", 3),
    card(28000012, "Tornado", 3),
    card(28000007, "Lightning", 6),
    card(28000015, "Barbarian Barrel", 2),
  ],
};
const XBOW = {
  label: "X-Bow cycle",
  cards: [
    card(27000008, "X-Bow", 6),
    card(27000006, "Tesla", 4),
    card(26000001, "Archers", 3),
    card(26000000, "Knight", 3, "evolution"),
    card(26000010, "Skeletons", 1),
    card(26000030, "Ice Spirit", 1),
    card(28000000, "Fireball", 4),
    card(28000011, "The Log", 2),
  ],
};
const ROYAL = {
  label: "Royal Giant beatdown",
  cards: [
    card(26000024, "Royal Giant", 6),
    card(26000061, "Fisherman", 3),
    card(26000044, "Hunter", 4),
    card(26000084, "Electro Spirit", 1),
    card(26000083, "Mother Witch", 4),
    card(26000010, "Skeletons", 1),
    card(28000000, "Fireball", 4),
    card(28000011, "The Log", 2),
  ],
};
const PEKKA = {
  label: "P.E.K.K.A bridge spam",
  cards: [
    card(26000004, "P.E.K.K.A", 7),
    card(26000055, "Battle Ram", 4),
    card(26000017, "Wizard", 5),
    card(26000042, "Electro Wizard", 4),
    card(26000016, "Prince", 5),
    card(26000039, "Mega Minion", 3),
    card(28000008, "Zap", 2),
    card(28000004, "Goblin Barrel", 3),
  ],
};
const LOGBAIT = {
  label: "Log bait",
  cards: [
    card(28000004, "Goblin Barrel", 3),
    card(26000026, "Princess", 3),
    card(26000041, "Goblin Gang", 3),
    card(26000000, "Knight", 3),
    card(27000004, "Inferno Tower", 5),
    card(26000030, "Ice Spirit", 1),
    card(28000002, "Rocket", 6),
    card(28000011, "The Log", 2),
  ],
};
const OPP_DECKS = [PEKKA, LOGBAIT, GOLEM, ROYAL];

/** The twelve battles of King Thing's sitting, in the order they were
 *  played: eight with Hog Rider cycle (a loss, then five wins in a row),
 *  then four with Giant beatdown. */
const PLAYED = [
  { o: "loss", c: 1, a: 2, t: -29, deck: 0 },
  { o: "win", c: 1, a: 0, t: 30, deck: 0 },
  { o: "win", c: 3, a: 0, t: 31, deck: 0 },
  { o: "win", c: 2, a: 1, t: 29, deck: 0 },
  { o: "win", c: 1, a: 0, t: 30, deck: 0 },
  { o: "win", c: 3, a: 1, t: 32, deck: 0 },
  { o: "loss", c: 0, a: 1, t: -30, deck: 0 },
  { o: "win", c: 3, a: 0, t: 31, deck: 0 },
  { o: "loss", c: 0, a: 3, t: -31, deck: 1 },
  { o: "win", c: 2, a: 0, t: 30, deck: 1 },
  { o: "loss", c: 1, a: 2, t: -28, deck: 1 },
  { o: "win", c: 1, a: 0, t: 30, deck: 1 },
] as const;
const OPPONENTS = [
  ["#00JVJCGCCY", "Rowan"],
  ["#00PC8YL0Q", "Mosswick"],
  ["#00PG99LG0", "<b>Quill</b>"],
  ["#00PPPCG88", "Bramble"],
  ["#00PUCPJ9J", "Tansy ⚔️"],
  ["#00PY9R800", "Fennel"],
  ["#00Q2R2CY8", "Corvid"],
  ["#00Q8VR9C", "Larkspur"],
  ["#00QLVPQRV", "Hazel"],
  ["#00R0RRU90", "Orrin"],
  ["#00RJQU2GC0", "Wren"],
  ["#00RLVJUGL", "Sorrel"],
];
const start12 = 95;
const playedAt = (i: number) => AGO(start12 - i * 6);
const net12 = PLAYED.reduce((n, b) => n + b.t, 0);

const sparkOf = (rows: readonly { o: string; c: number; a: number }[]) =>
  rows.map((b) => ({
    r: b.o === "win" ? "w" : b.o === "loss" ? "l" : "d",
    m: Math.min(3, Math.abs(b.c - b.a)),
  }));

/** The twelve battles as the session's games read them, newest first. */
export const TWELVE_BATTLES = PLAYED.map((b, i) => ({
  battle_id: `b12-${i}`,
  url: `/battle/${(0xa1b2c3d4e500 + i).toString(16)}`,
  at: playedAt(i),
  type: "PvP",
  mode_group: "ladder",
  outcome: b.o,
  crowns: b.c,
  trophy_change: b.t,
  opponents: [
    {
      player_tag: OPPONENTS[i]![0],
      name: OPPONENTS[i]![1],
      crowns: b.a,
      clan_tag: i % 3 === 0 ? "#00U08JU8G" : null,
      clan_name: i % 3 === 0 ? "Thornfield" : null,
    },
  ],
  relation: "constituent",
  deck: b.deck,
  // The opponent's deck, by index into the page's decks (2..5).
  opponent_deck: 2 + (i % OPP_DECKS.length),
})).reverse();

export const TWELVE_DECKS = [HOG, GIANT, ...OPP_DECKS];

const sessionTwelve = {
  id: "tl_s12",
  at: AGO(start12),
  observed_at: AGO(29),
  subject_tag: ME_TAG,
  subject_name: "King Thing",
  subjects: [{ tag: ME_TAG, kind: "player", name: "King Thing" }],
  text: `King Thing played 12 battles in one session (8W-4L; 12 Trophy Road, +${net12} trophies), with Hog Rider cycle (8), Giant beatdown (4).`,
  kind: "battle_session",
  section: "battles",
  facts: {
    player_tag: ME_TAG,
    name: "King Thing",
    started_at: AGO(start12),
    ended_at: playedAt(11),
    battles: 12,
    won: 8,
    lost: 4,
    drawn: 0,
    by_mode: { ladder: 12 },
    trophy_net: net12,
    won_in_a_row: 5,
    decks: [
      { label: "Hog Rider cycle", battles: 8 },
      { label: "Giant beatdown", battles: 4 },
    ],
    events: [],
    open: false,
  },
  groups: ["you"],
  spark: sparkOf(PLAYED),
  scores: { best_win: "3-0", three_crowns: 3 },
  deck: HOG,
  evidence: { kind: "session", version: "v12", count: 12 },
  cheers: { on_fire: 3, clap: 1 },
  my_cheer: null,
};

const sessionOne = {
  id: "tl_s1",
  at: AGO(140),
  observed_at: AGO(139),
  subject_tag: ADA,
  subject_name: "Ada",
  subjects: [{ tag: ADA, kind: "player", name: "Ada" }],
  text: "Ada played 1 battle (0W-1L; 1 Trophy Road, -28 trophies), with Golem beatdown (1).",
  kind: "battle_session",
  section: "battles",
  facts: {
    player_tag: ADA,
    name: "Ada",
    started_at: AGO(140),
    ended_at: AGO(140),
    battles: 1,
    won: 0,
    lost: 1,
    drawn: 0,
    by_mode: { ladder: 1 },
    trophy_net: -28,
    won_in_a_row: 0,
    decks: [{ label: "Golem beatdown", battles: 1 }],
    events: [],
    open: false,
  },
  groups: ["friends"],
  spark: [{ r: "l", m: 1 }],
  deck: GOLEM,
  evidence: { kind: "session", version: "v1", count: 1 },
  cheers: {},
  my_cheer: null,
};

const RANKED = [
  { o: "win", c: 1, a: 0 },
  { o: "loss", c: 0, a: 1 },
  { o: "win", c: 2, a: 1 },
  { o: "win", c: 1, a: 0 },
];
const sessionRanked = {
  id: "tl_sr",
  at: AGO(260),
  observed_at: AGO(230),
  subject_tag: JUNIPER,
  subject_name: "Juniper",
  subjects: [{ tag: JUNIPER, kind: "player", name: "Juniper" }],
  text: "Juniper played 4 battles in one session (3W-1L; 4 Path of Legends), with X-Bow cycle (4).",
  kind: "battle_session",
  section: "battles",
  facts: {
    player_tag: JUNIPER,
    name: "Juniper",
    started_at: AGO(260),
    ended_at: AGO(232),
    battles: 4,
    won: 3,
    lost: 1,
    drawn: 0,
    by_mode: { ranked: 4 },
    trophy_net: 0,
    won_in_a_row: 2,
    decks: [{ label: "X-Bow cycle", battles: 4 }],
    events: [],
    open: false,
  },
  groups: ["friends"],
  spark: sparkOf(RANKED),
  scores: { best_win: "2-1", three_crowns: 0 },
  deck: XBOW,
  evidence: { kind: "session", version: "vr", count: 4 },
  cheers: { clap: 2 },
  my_cheer: null,
};

const EVENT = [
  { o: "win", c: 3, a: 0 },
  { o: "win", c: 2, a: 0 },
  { o: "loss", c: 1, a: 3 },
  { o: "win", c: 3, a: 1 },
  { o: "win", c: 1, a: 0 },
  { o: "win", c: 3, a: 0 },
];
const sessionEvent = {
  id: "tl_se",
  at: AGO(420),
  observed_at: AGO(370),
  subject_tag: CLAN,
  subject_name: "Ada's Clan",
  subjects: [{ tag: PIP, kind: "player", name: "Pip" }],
  text: "Pip played 6 battles in one session (5W-1L; 6 event, 3 wins in a row), with Royal Giant beatdown (3), Lava Hound beatdown (2), Hog Rider cycle (1), in Classic 1v1 (6).",
  kind: "battle_session",
  section: "battles",
  facts: {
    player_tag: PIP,
    name: "Pip",
    started_at: AGO(420),
    ended_at: AGO(372),
    battles: 6,
    won: 5,
    lost: 1,
    drawn: 0,
    by_mode: { event: 6 },
    trophy_net: 0,
    won_in_a_row: 3,
    decks: [
      { label: "Royal Giant beatdown", battles: 3 },
      { label: "Lava Hound beatdown", battles: 2 },
      { label: "Hog Rider cycle", battles: 1 },
    ],
    events: [{ event_tag: "e1", name: "Classic 1v1", battles: 6 }],
    open: false,
  },
  groups: ["clan"],
  spark: sparkOf(EVENT),
  scores: { best_win: "3-0", three_crowns: 3 },
  deck: ROYAL,
  evidence: { kind: "session", version: "ve", count: 6 },
  cheers: {},
  my_cheer: null,
};

const moment = {
  id: "tl_m1",
  at: AGO(66),
  observed_at: AGO(60),
  subject_tag: ME_TAG,
  subject_name: "King Thing",
  subjects: [{ tag: ME_TAG, kind: "player", name: "King Thing" }],
  text: "King Thing set a new best of 7,512 trophies, crossing 7,500, on a 3-1 win over Fennel, +32 to 7,512.",
  kind: "best_trophies_band",
  facts: {
    best: 7512,
    band: 7500,
    crossed_by: {
      battle_id: "b12-5",
      crowns: 3,
      crowns_against: 1,
      trophies_after: 7512,
      opponent: { name: "Fennel" },
    },
  },
  groups: ["you"],
  battle_url: "/battle/a1b2c3d4e505",
  proof_mode: "ladder",
  cheers: { trophy: 4 },
  my_cheer: null,
};

const clanLine = {
  id: "tl_c1",
  at: AGO(600),
  observed_at: AGO(599),
  subject_tag: CLAN,
  subject_name: "Ada's Clan",
  subjects: [{ tag: CLAN, kind: "clan", name: "Ada's Clan" }],
  text: "Ada's Clan crossed the finish line with 10,000 fame.",
  kind: "race_finished",
  facts: {},
  groups: ["clan"],
};

const window = { from: AGO(10_080), to: AGO(0) };
export const SESSION_DAY = {
  window,
  seen_to: AGO(200),
  timeline_more: 0,
  timeline: [
    sessionTwelve,
    moment,
    sessionOne,
    sessionRanked,
    sessionEvent,
    clanLine,
  ],
};

/** The twelve-battle sitting's games, as the feed's in-place read
 *  answered them before the session page (2026-11-16). */
const TWELVE_EVIDENCE = {
  item_id: "tl_s12",
  kind: "session",
  version: "v12",
  observed_at: AGO(29),
  count: 12,
  through: playedAt(11),
  open: false,
  completeness: "recorded_sitting",
  order: "newest_first",
  next_offset: null,
  offset: 0,
  limit: 25,
  decks: TWELVE_DECKS,
  battles: TWELVE_BATTLES,
};

/** The session page's read (GET /api/player/session). */
export const TWELVE_PAGE = {
  player: { tag: ME_TAG, name: "King Thing" },
  you: { own: true, can_post: true },
  item: {
    id: sessionTwelve.id,
    kind: sessionTwelve.kind,
    at: sessionTwelve.at,
    text: sessionTwelve.text,
    facts: sessionTwelve.facts,
    spark: sessionTwelve.spark,
    scores: sessionTwelve.scores,
    deck: sessionTwelve.deck,
    evidence: sessionTwelve.evidence,
  },
  games: TWELVE_EVIDENCE,
  marks: [
    {
      battle_id: "b12-5",
      kind: "best_trophies_band",
      label: "New best: 7,512 trophies",
    },
  ],
};

export const ONE_PAGE = {
  player: { tag: ADA, name: "Ada" },
  you: { own: false, can_post: false },
  item: {
    id: sessionOne.id,
    kind: sessionOne.kind,
    at: sessionOne.at,
    text: sessionOne.text,
    facts: sessionOne.facts,
    spark: sessionOne.spark,
    deck: sessionOne.deck,
    evidence: sessionOne.evidence,
  },
  games: {
    item_id: "tl_s1",
    kind: "session",
    version: "v1",
    count: 1,
    open: false,
    completeness: "recorded_sitting",
    order: "newest_first",
    next_offset: null,
    offset: 0,
    limit: 25,
    decks: [GOLEM, PEKKA],
    battles: [
      {
        battle_id: "b1-0",
        url: "/battle/b1c2d3e4f5a6",
        at: AGO(140),
        type: "PvP",
        mode_group: "ladder",
        outcome: "loss",
        crowns: 1,
        trophy_change: -28,
        opponents: [
          {
            player_tag: "#00U0RL9YV",
            name: "Thistle",
            crowns: 2,
            clan_tag: null,
            clan_name: null,
          },
        ],
        relation: "constituent",
        deck: 0,
        opponent_deck: 1,
      },
    ],
  },
  marks: [],
};

/** Home with the realistic day in its feed, and every sitting's games and
 *  page answered. */
export const sessionDayApi = (overrides = {}) =>
  homeApi({
    "GET /api/me/home/feed": (route) =>
      new URL(route.request().url()).searchParams.has("evidence_item_id")
        ? [200, TWELVE_EVIDENCE]
        : [200, SESSION_DAY],
    "GET /api/player/session": (route) => {
      const id = new URL(route.request().url()).searchParams.get("id");
      return id === "tl_s1"
        ? [200, ONE_PAGE]
        : id === "tl_s12"
          ? [200, TWELVE_PAGE]
          : [404, { error: "not_found" }];
    },
    ...overrides,
  });

/** A session's public page (2026-11-17): a friend's twelve-battle sitting
 *  at /session/<tag>/<id>/<start>, the id in the timeline's real shape so
 *  the address reads as one. The friend's game name is hostile markup. */
export const SHARED_TAG = ADA;
export const SHARED_NAME = `<i>Ada</i> & "co"`;
export const SHARED_ID = "tl_a1b2c3d4e5f60718293a";
export const SHARED_START = Math.floor(Date.parse(AGO(start12)) / 1000);
export const SHARED_PATH = `/session/${ADA.slice(1)}/${SHARED_ID}/${SHARED_START}`;
const SHARED_URL = `https://elixir.poapkings.com${SHARED_PATH}`;
const sharedItem = {
  ...TWELVE_PAGE.item,
  id: SHARED_ID,
  facts: { ...sessionTwelve.facts, player_tag: ADA, name: SHARED_NAME },
};

/** What GET /api/public/sessions/... answers: the sitting read as
 *  nobody, so no `you`, no comments and no nickname. */
export const SHARED_PUBLIC = {
  player: { tag: ADA, name: SHARED_NAME },
  item: sharedItem,
  games: TWELVE_EVIDENCE,
  marks: TWELVE_PAGE.marks,
  open: false,
  url: SHARED_URL,
  image: `${SHARED_URL}.png`,
};

/** The same sitting on the member page (GET /api/player/session), with
 *  its comments open and the reader's own marks. */
export const SHARED_MEMBER = {
  ...SHARED_PUBLIC,
  you: { own: false, can_post: false },
  item: { ...sharedItem, comments: { count: 2, latest: [], open: true } },
};
