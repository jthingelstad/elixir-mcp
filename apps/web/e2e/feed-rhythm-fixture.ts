import { homeApi } from "./home-fixture.ts";

/**
 * A Timeline as a real account that follows a few dozen people sees it
 * (2026-11-17, the feed's rhythm): about sixty items over three days from
 * fifteen people, mostly one- and two-battle sessions with their decks, a
 * few big sessions, a Ranked climb, a challenge run, a 2v2 with a followed
 * teammate, the moments around them (a mastery level, a card unlocked, an
 * Evo, a new Arena, a new best, a league), the clan's race and an arrival,
 * two close friends and a name that is hostile markup. Invented players
 * only (docs/invented-tags.json).
 *
 * The clock is fixed (FEED_NOW) so the days and times read the same on
 * every run; a spec sets the page's clock to it.
 */
export const FEED_NOW = "2026-11-17T23:30:00Z";
const NOW = Date.parse(FEED_NOW);
const AGO = (min: number) => new Date(NOW - min * 60_000).toISOString();

const ME = { tag: "#20JJJ2CCRU", name: "King Thing" };
export const MOSS = { tag: "#0QG0JPUC", name: "Moss" };
export const QUILL = { tag: "#0YCLYRJV", name: "Quill" };
export const JUNIPER = { tag: "#0QPPRRC9", name: "Juniper" };
export const ROWAN = { tag: "#0YCLUPC9", name: "Rowan" };
const ELM = { tag: "#0V8R2CRC", name: "Elm" };
const FERN = { tag: "#02QCR2LP", name: "Fern" };
const ASH = { tag: "#0RCCQR20", name: "Ash" };
const WREN = { tag: "#0Y2YQJY9", name: "Wren" };
const SAGE = { tag: "#0UL9Q20J", name: "Sage" };
const PIP = { tag: "#0YGPVYYV", name: "Pip" };
const LARK = { tag: "#0G0L2JQ8", name: "Lark" };
const BRAM = { tag: "#00UGJGCC", name: "Bram" };
/** A name that is markup: it must print as text, never as a tag. */
export const HOSTILE = {
  tag: "#0VLVQUUP",
  name: `<img src=x onerror=alert(1)>Tin`,
};
const CLAN = { tag: "#0QC8RCGY", name: "Ada's Clan" };

type Person = { tag: string; name: string };
const CLOSE = new Set([MOSS.tag, QUILL.tag]);
const CLANMATES = new Set([
  ME.tag,
  JUNIPER.tag,
  ROWAN.tag,
  FERN.tag,
  LARK.tag,
  QUILL.tag,
]);

const card = (
  id: number,
  name: string,
  elixir_cost: number,
  form = "base",
) => ({
  id,
  name,
  form,
  elixir_cost,
});
const DECKS: Record<string, ReturnType<typeof card>[]> = {
  "Giant beatdown": [
    card(26000000, "Knight", 3),
    card(26000001, "Archers", 3),
    card(26000002, "Goblins", 2),
    card(26000003, "Giant", 5),
    card(26000004, "P.E.K.K.A", 7),
    card(26000005, "Minions", 3),
    card(26000006, "Balloon", 5),
    card(26000007, "Witch", 5),
  ],
  "Hog Rider cycle": [
    card(26000021, "Hog Rider", 4),
    card(26000010, "Skeletons", 1),
    card(26000014, "Musketeer", 4),
    card(28000000, "Fireball", 4),
    card(28000008, "Zap", 2),
    card(27000000, "Cannon", 3),
    card(26000030, "Ice Spirit", 1),
    card(26000038, "Ice Golem", 2),
  ],
  "Electro Giant": [
    card(26000085, "Electro Giant", 7),
    card(26000017, "Wizard", 5),
    card(26000011, "Valkyrie", 4),
    card(26000008, "Barbarians", 5),
    card(28000008, "Zap", 2),
    card(26000010, "Skeletons", 1),
    card(26000012, "Skeleton Army", 3),
    card(28000000, "Fireball", 4),
  ],
};

let seq = 0;
type SessionOpts = {
  results: string; // "wwl": each battle's result in order
  mode?: "ladder" | "ranked" | "event" | "casual" | "war";
  trophyEach?: number;
  deck?: string;
  otherDeck?: string;
  extra?: Record<string, unknown>;
  kind?: string;
  text?: string;
  cheers?: Record<string, number>;
  mine?: string | null;
};

function groupsFor(p: Person) {
  const g: string[] = [];
  if (p.tag === ME.tag) g.push("you");
  else g.push("friends");
  if (CLANMATES.has(p.tag)) g.push("clan");
  if (CLOSE.has(p.tag)) g.push("close");
  return g;
}

/** A session as Home's feed keeps it: facts, its sparkline, its deck. */
function session(p: Person, endMin: number, o: SessionOpts) {
  const id = `s${++seq}`;
  const results = o.results.split("");
  const won = results.filter((r) => r === "w").length;
  const lost = results.filter((r) => r === "l").length;
  const mode = o.mode ?? "ladder";
  const each = o.trophyEach ?? 30;
  const net =
    mode === "ladder"
      ? results.reduce(
          (n, r) => n + (r === "w" ? each : r === "l" ? -(each - 1) : 0),
          0,
        )
      : null;
  let run = 0;
  let best = 0;
  for (const r of results) {
    run = r === "w" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const deck = o.deck ?? "Giant beatdown";
  const decks = o.otherDeck
    ? [
        { label: deck, battles: results.length - 1 },
        { label: o.otherDeck, battles: 1 },
      ]
    : [{ label: deck, battles: results.length }];
  const startMin = endMin + 4 * results.length;
  const margins = results.map((r, i) => (r === "d" ? 0 : ((i * 7) % 3) + 1));
  const three = results.filter((r, i) => r === "w" && margins[i] === 3).length;
  const n = results.length;
  return {
    id,
    at: AGO(startMin),
    sort_at: AGO(endMin),
    observed_at: AGO(endMin - 1),
    subject_tag: p.tag,
    subject_name: p.name,
    subjects: [{ tag: p.tag, kind: "player", name: p.name }],
    text:
      o.text ??
      (n === 1
        ? `${p.name} ${won ? "won" : "lost"} a battle.`
        : `${p.name} played ${n} battles in one session: won ${won}, lost ${lost}.`),
    kind: o.kind ?? "battle_session",
    facts: {
      player_tag: p.tag,
      name: p.name,
      started_at: AGO(startMin),
      ended_at: AGO(endMin),
      battles: n,
      won,
      lost,
      drawn: n - won - lost,
      by_mode: { [mode]: n },
      trophy_net: net,
      won_in_a_row: best,
      decks,
      events: [],
      open: false,
      ...o.extra,
    },
    deck: { label: deck, cards: DECKS[deck] ?? DECKS["Giant beatdown"] },
    ...(n > 1
      ? {
          scores: {
            ...(won ? { best_win: "3-0" } : {}),
            three_crowns: three,
          },
        }
      : {}),
    spark: results.map((r, i) => ({ r, m: r === "d" ? null : margins[i] })),
    evidence: { kind: "session", version: `v-${id}` },
    groups: groupsFor(p),
    cheers: o.cheers ?? {},
    my_cheer: o.mine ?? null,
  };
}

/** A moment, as the feed keeps it. */
function moment(
  p: Person,
  min: number,
  kind: string,
  text: string,
  facts: Record<string, unknown>,
  more: Record<string, unknown> = {},
) {
  const id = `m${++seq}`;
  return {
    id,
    at: AGO(min),
    observed_at: AGO(min - 1),
    subject_tag: p.tag,
    subject_name: p.name,
    subjects: [{ tag: p.tag, kind: "player", name: p.name }],
    text,
    kind,
    facts: { player_tag: p.tag, name: p.name, ...facts },
    groups: groupsFor(p),
    cheers: {},
    my_cheer: null,
    ...more,
  };
}

/** A clan's own line. */
function clanLine(
  min: number,
  kind: string,
  text: string,
  facts: Record<string, unknown>,
  more: Record<string, unknown> = {},
) {
  return {
    id: `c${++seq}`,
    at: AGO(min),
    observed_at: AGO(min - 1),
    subject_tag: CLAN.tag,
    subject_name: CLAN.name,
    subjects: [{ tag: CLAN.tag, kind: "clan", name: CLAN.name }],
    text,
    kind,
    facts,
    groups: ["clan"],
    cheers: {},
    my_cheer: null,
    ...more,
  };
}

const proof = (min: number, opponent: string, extra = {}) => ({
  battle_id: `b${++seq}`,
  at: AGO(min),
  crowns: 3,
  crowns_against: 1,
  opponent: { name: opponent },
  ...extra,
});

/** Today, yesterday and Sunday, newest first. */
const ITEMS = [
  // Today (from 5:30 pm back to the morning).
  session(QUILL, 8, { results: "l" }),
  session(ROWAN, 20, { results: "w" }),
  session(ELM, 31, { results: "wl" }),
  // The deck switch (0289): a full moment with the new deck's cards.
  moment(
    FERN,
    40,
    "deck_switched",
    "Fern switched to Hog Rider cycle on Trophy Road: 3 battles, 2 wins.",
    {
      mode: "ladder",
      deck: "Hog Rider cycle",
      prior_deck: "Giant beatdown",
      battles: 3,
      wins: 2,
    },
    { deck: { label: "Hog Rider cycle", cards: DECKS["Hog Rider cycle"] } },
  ),
  session(FERN, 44, { results: "l", deck: "Hog Rider cycle" }),
  // The first win with a new form (0289): a full moment with its card.
  moment(
    WREN,
    46,
    "card_first_win",
    "Wren won with Evo Musketeer for the first time.",
    {
      card: "Musketeer",
      card_id: 26000014,
      rarity: "common",
      form: "evolution",
      tower_troop: false,
      battle_id: "fw-rhythm-1",
    },
  ),
  session(JUNIPER, 50, {
    results: "wwlw",
    mode: "event",
    deck: "Hog Rider cycle",
    text: "Juniper played 4 battles in one session in Classic 2v2.",
    extra: {
      by_mode: { event: 4 },
      events: [{ name: "Classic 2v2", event_tag: "classic-2v2", run_wins: 0 }],
      together: [
        { player_tag: ROWAN.tag, name: ROWAN.name, with: 4, against: 0 },
      ],
    },
    cheers: { well_played: 1 },
  }),
  session(PIP, 70, { results: "w", deck: "Electro Giant" }),
  session(PIP, 95, { results: "l", deck: "Electro Giant" }),
  session(PIP, 130, { results: "wl", deck: "Electro Giant" }),
  moment(
    WREN,
    140,
    "badge_earned",
    "Wren reached Knight Mastery level 10.",
    {
      badge: "MasteryKnight",
      badge_label: "Knight Mastery",
      level: 10,
      max_level: 10,
      prior_level: 9,
    },
    {
      moment_card: { id: 26000000, name: "Knight", form: "base" },
      // Badge art (0288) the mirror has not copied yet: the card draws.
      badge_art: "/assets/badges/kn-10-not-mirrored.png",
    },
  ),
  session(MOSS, 160, {
    results: "wwwlwwwwlwww",
    deck: "Giant beatdown",
    otherDeck: "Hog Rider cycle",
    text: "Moss played 12 battles in one session: won 10, lost 2.",
    cheers: { on_fire: 3, royal: 1 },
    mine: "on_fire",
  }),
  session(ASH, 190, { results: "l" }),
  session(HOSTILE, 205, { results: "w", deck: "Hog Rider cycle" }),
  session(SAGE, 230, { results: "ll" }),
  session(BRAM, 260, { results: "w" }),
  moment(ELM, 300, "card_unlocked", "Elm unlocked Electro Giant.", {
    card: "Electro Giant",
    card_id: 26000085,
    rarity: "epic",
  }),
  // Profile moments (2026-11-17): four in a row fold into one group.
  moment(
    PIP,
    302,
    "badge_earned",
    "Pip reached Mastery level 5 with 3 cards.",
    {
      badge: "MasteryHogRider",
      badge_label: "Hog Rider Mastery",
      level: 5,
      badge_count: 3,
      badges: [
        {
          badge: "MasteryHogRider",
          badge_label: "Hog Rider Mastery",
          level: 5,
          prior_level: 4,
        },
        {
          badge: "MasteryKnight",
          badge_label: "Knight Mastery",
          level: 5,
          prior_level: 3,
        },
        {
          badge: "MasteryElectroGiant",
          badge_label: "Electro Giant Mastery",
          level: 5,
          prior_level: 4,
        },
      ],
    },
    {
      moment_card: { id: 26000021, name: "Hog Rider" },
      moment_cards: [
        { id: 26000021, name: "Hog Rider" },
        { id: 26000000, name: "Knight" },
        { id: 26000085, name: "Electro Giant" },
      ],
    },
  ),
  moment(ASH, 304, "card_maxed", "Ash maxed Hog Rider.", {
    card: "Hog Rider",
    card_id: 26000021,
    rarity: "rare",
    level: 16,
  }),
  moment(
    ROWAN,
    306,
    "badge_earned",
    "Rowan has played Clash Royale for 5 years.",
    {
      badge: "YearsPlayed",
      badge_label: "Years Played",
      level: 5,
      prior_level: 4,
    },
  ),
  moment(
    BRAM,
    308,
    "twelve_win_run",
    "Bram won 12 in Grand Challenge.",
    {
      badge: "Grand12Wins",
      badge_label: "Grand Challenge 12 Wins",
      challenge: "Grand Challenge",
      runs: 4,
      runs_before: 3,
      level: 2,
      prior_level: 1,
    },
    // The badge's own art (0288), as the mirror names it.
    { badge_art: "/assets/badges/g12-2.png" },
  ),
  session(SAGE, 320, {
    results: "wwlwlwl",
    mode: "ranked",
    deck: "Hog Rider cycle",
    text: "Sage played 7 Ranked battles in one session; climbed Master III to Champion.",
    extra: {
      ranked: {
        league_from: 6,
        league_to: 7,
        league_from_name: "Master III",
        league_to_name: "Champion",
        promotions: [{ from_name: "Master III", to_name: "Champion" }],
        rating: null,
      },
    },
  }),
  session(ROWAN, 360, { results: "wl" }),
  moment(
    WREN,
    380,
    "challenge_best_run",
    "Wren's best challenge run is now 9 wins.",
    {
      best: 9,
      best_before: 7,
    },
  ),
  session(LARK, 400, { results: "l" }),
  session(ASH, 430, { results: "w" }),
  moment(
    JUNIPER,
    470,
    "best_trophies_band",
    "Juniper reached a new best of 7,500 trophies.",
    {
      best: 7512,
      band: 7500,
      crossed_by: proof(470, "Kestrel", {
        mode: "ladder",
        trophies_after: 7512,
      }),
    },
    {
      battle_url: "https://elixir.example.test/battle/c1d2e3f4a5b6",
      proof_mode: "ladder",
    },
  ),
  session(FERN, 500, { results: "w", deck: "Hog Rider cycle" }),
  session(ME, 540, {
    results: "wlwwl",
    text: "King Thing played 5 battles in one session: won 3, lost 2.",
  }),
  session(WREN, 600, { results: "l" }),
  session(BRAM, 640, { results: "lw" }),
  session(ELM, 700, { results: "w" }),
  // A week's form (week_form, 15.3.0): the game week that closed at
  // 10:00 UTC this morning, beside the four before it.
  moment(
    SAGE,
    810,
    "week_form",
    "Sage won 62% of 26 Trophy Road battles in the week to Nov 17, up from 48% over the 4 weeks before.",
    {
      mode: "ladder",
      week: {
        from: "2026-11-10T10:00:00.000Z",
        to: "2026-11-17T10:00:00.000Z",
        battles: 27,
        decided_battles: 26,
        wins: 16,
        losses: 10,
        win_rate: 0.615,
      },
      previous: {
        from: "2026-10-13T10:00:00.000Z",
        to: "2026-11-10T10:00:00.000Z",
        weeks: 4,
        decided_battles: 60,
        win_rate: 0.483,
      },
    },
    { section: "battles" },
  ),
  // Yesterday.
  clanLine(1100, "race_finished", "Ada's Clan finished the river race.", {
    season_id: 137,
    section_index: 2,
    fame: 10000,
    finish_time: AGO(1100),
  }),
  session(QUILL, 1150, {
    results: "wlwwwlwwlw",
    mode: "event",
    deck: "Electro Giant",
    text: "Quill played 10 battles in one session in Classic Challenge.",
    extra: {
      by_mode: { event: 10 },
      events: [
        {
          name: "Classic Challenge",
          event_tag: "classic",
          run_wins: 9,
          drawn_decks: false,
        },
      ],
    },
    cheers: { grind: 2 },
  }),
  session(PIP, 1200, { results: "w", deck: "Electro Giant" }),
  session(ASH, 1230, { results: "l" }),
  session(ROWAN, 1260, { results: "lw" }),
  session(WREN, 1300, { results: "w" }),
  moment(
    FERN,
    1340,
    "arena_changed",
    "Fern reached Legendary Arena.",
    {
      from: 54000017,
      to: 54000018,
      from_name: "Executioner's Kitchen",
      to_name: "Legendary Arena",
      promoted_by: proof(1340, "Heron", {
        mode: "ladder",
        trophies_after: 6012,
      }),
    },
    {
      battle_url: "https://elixir.example.test/battle/d1e2f3a4b5c6",
      proof_mode: "ladder",
    },
  ),
  session(FERN, 1345, { results: "w" }),
  session(SAGE, 1380, {
    results: "l",
    mode: "ranked",
    deck: "Hog Rider cycle",
  }),
  session(LARK, 1420, { results: "wl" }),
  session(HOSTILE, 1460, { results: "l" }),
  moment(ROWAN, 1500, "card_form_unlocked", "Rowan unlocked the Evo Knight.", {
    card: "Knight",
    card_id: 26000000,
    rarity: "common",
    form: "evolution",
  }),
  session(BRAM, 1540, { results: "w" }),
  session(MOSS, 1580, { results: "l" }),
  session(MOSS, 1610, { results: "w" }),
  session(ELM, 1650, { results: "l" }),
  session(JUNIPER, 1700, { results: "ww" }),
  moment(
    LARK,
    1760,
    "ranked_promotion",
    "Lark reached Champion in Ranked.",
    {
      from: 6,
      to: 7,
      from_name: "Master III",
      to_name: "Champion",
      promoted_by: proof(1760, "Plover", { mode: "ranked" }),
    },
    {
      battle_url: "https://elixir.example.test/battle/e1f2a3b4c5d6",
      proof_mode: "ranked",
    },
  ),
  clanLine(
    1800,
    "member_joined",
    "Lark joined Ada's Clan.",
    {
      player_tag: LARK.tag,
      name: LARK.name,
      role: "member",
      roster_size_before: 41,
      roster_size_after: 42,
    },
    {
      subjects: [
        { tag: CLAN.tag, kind: "clan", name: CLAN.name },
        { tag: LARK.tag, kind: "player", name: LARK.name },
      ],
    },
  ),
  session(WREN, 1840, { results: "ll" }),
  session(ASH, 1900, { results: "w" }),
  session(PIP, 1950, { results: "l" }),
  // Sunday.
  session(ROWAN, 2600, {
    results: "wwwwwwlww",
    deck: "Giant beatdown",
    kind: "session_standout",
    text: "Rowan won 8 of 9 on Trophy Road and reached a new best.",
    extra: { crossed: true, newly: ["best_trophies"], crossings: [] },
    cheers: { royal: 2, wow: 1 },
  }),
  session(ELM, 2650, { results: "w" }),
  session(SAGE, 2700, { results: "l" }),
  session(FERN, 2720, { results: "wl" }),
  moment(
    PIP,
    2800,
    "collection_level_step",
    "Pip reached Collection Level 40.",
    { level: 40, step: 5 },
  ),
  session(BRAM, 2850, { results: "l" }),
  session(LARK, 2900, { results: "w" }),
  session(ASH, 2950, { results: "lw" }),
  session(HOSTILE, 3000, { results: "w" }),
  session(WREN, 3050, { results: "l" }),
  moment(ASH, 3100, "career_wins_step", "Ash reached 5,000 career wins.", {
    wins: 5000,
    step: 1000,
  }),
  session(QUILL, 3200, { results: "w" }),
  session(JUNIPER, 3300, { results: "lw" }),
  clanLine(3400, "week_resolved", "Ada's Clan finished week 2 in 2nd place.", {
    season_id: 137,
    section_index: 1,
    is_colosseum: false,
    fame: 41200,
    rank: 2,
    trophy_change: 20,
    members: 40,
  }),
];

const window = { from: AGO(10_080), to: FEED_NOW };
/** The read marker sits yesterday afternoon: today's items are new. */
export const SEEN_TO = AGO(1000);

const count = (g: string) =>
  ITEMS.filter((it) => (it.groups as string[]).includes(g)).length;
export const RHYTHM_TIMELINE = {
  window,
  seen_to: SEEN_TO,
  timeline_more: 0,
  total: ITEMS.length,
  counts: {
    everyone: ITEMS.length,
    close: count("close"),
    friends: count("friends"),
    clan: count("clan"),
    you: count("you"),
  },
  timeline: ITEMS,
};

/** The circle: the two close friends, so the Close friends chip and the
 *  stars are offered. */
const CIRCLE = {
  ok: true,
  from: AGO(3000),
  friends: [MOSS, QUILL].map((p, i) => ({
    tag: p.tag,
    name: p.name,
    close: true,
    battles: 15 - i * 4,
    days: 2,
    sittings: 3,
    last_battle_at: AGO(8 + i * 150),
  })),
};

export const rhythmApi = (overrides: Parameters<typeof homeApi>[0] = {}) =>
  homeApi({
    "GET /api/me/timeline": [200, RHYTHM_TIMELINE],
    "GET /api/me/home/circle": [200, { circle: CIRCLE }],
    ...overrides,
  });

/** The same week as Clan's Feed answers it (2026-11-17): the items as the
 *  Timeline draws them, without Home's own fields. */
export const RHYTHM_CLAN_FEED = {
  clan_tag: "#0QC8RCGY",
  window_days: 7,
  more: 0,
  items: ITEMS.map((it) => {
    const out: Record<string, unknown> = { ...it };
    for (const k of [
      "groups",
      "offer_follow",
      "cheers",
      "my_cheer",
      "comments",
    ])
      delete out[k];
    return out;
  }),
};
