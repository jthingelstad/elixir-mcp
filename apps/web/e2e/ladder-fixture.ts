import type { Route } from "@playwright/test";

/**
 * Ladder's reads, as the tools answer them through POST /api/explore
 * (shapes copied from live answers for the fixture player, contract
 * 9.17.1). One dispatcher answers by tool and mode, and records every
 * call so a journey can say which reads a page made.
 */

const SEASON = {
  month: "2026-09",
  war: 136,
  starts_at: "2026-09-07T10:00:00.000Z",
  ends_at: "2026-10-05T10:00:00.000Z",
};
const APPLIED = {
  window: {
    from: "2026-09-07T10:00:00.000Z",
    to: null,
    source: "season",
    timezone: "America/Chicago",
    season: SEASON,
    crosses: [],
    season_age_days: 24,
  },
};
const META = {
  as_of: "2026-10-01T21:31:13.353Z",
  source_polls: {
    player_battlelog: {
      observed_at: "2026-10-01T21:17:59.000Z",
      freshness_seconds: 794,
    },
  },
  freshness_seconds: 794,
  timezone_applied: "America/Chicago",
  contract_version: "9.17.1",
};
const FLOOR = {
  floor: 12500,
  arena: { id: 54000142, name: "Ultimate Clash Pit" },
  source: "losses_on_floor",
  floored: true,
  on_floor_losses: 6,
  losses_landing_on_floor: 6,
  ladder_battles: 35,
  trophy_range: { lowest: 12500, highest: 12562 },
};

const WINDOWS: Record<string, Record<string, number>> = {
  ladder: {
    battles: 35,
    wins: 12,
    losses: 23,
    draws: 0,
    crowns_for: 25,
    crowns_against: 37,
    net_trophies: -10,
    win_rate: 0.343,
  },
  ranked: {
    battles: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    crowns_for: 0,
    crowns_against: 0,
    net_trophies: 0,
    win_rate: 0,
  },
  war: {
    battles: 39,
    wins: 23,
    losses: 16,
    draws: 0,
    crowns_for: 61,
    crowns_against: 44,
    net_trophies: 0,
    win_rate: 0.59,
  },
  event: {
    battles: 3,
    wins: 0,
    losses: 3,
    draws: 0,
    crowns_for: 1,
    crowns_against: 6,
    net_trophies: 0,
    win_rate: 0,
  },
};

const WEEKLY = [
  {
    iso_week: "2026-W37",
    week_of: "2026-09-07",
    battles: 10,
    wins: 4,
    losses: 6,
    draws: 0,
    net_trophies: -6,
    win_rate: 0.4,
    partial: true,
    covers: {
      from: "2026-09-07T10:00:00.000Z",
      to: "2026-09-14T00:00:00.000Z",
    },
  },
  {
    iso_week: "2026-W38",
    week_of: "2026-09-14",
    battles: 10,
    wins: 4,
    losses: 6,
    draws: 0,
    net_trophies: 29,
    win_rate: 0.4,
  },
  {
    iso_week: "2026-W39",
    week_of: "2026-09-21",
    battles: 11,
    wins: 4,
    losses: 7,
    draws: 0,
    net_trophies: -3,
    win_rate: 0.364,
  },
  {
    iso_week: "2026-W40",
    week_of: "2026-09-28",
    battles: 4,
    wins: 0,
    losses: 4,
    draws: 0,
    net_trophies: -30,
    win_rate: 0,
    partial: true,
    covers: {
      from: "2026-09-28T00:00:00.000Z",
      to: "2026-10-01T21:31:13.333Z",
    },
  },
];

const TOP_DECK = {
  deck_hash: "b2860741bee79ef1a9af7dd990055ad2aaeebdb6685a02d83f114c6a3d46ba9f",
  cards: [
    { id: 26000007, name: "Witch", form: "evolution" },
    { id: 26000012, name: "Skeleton Army", form: "base" },
    { id: 26000018, name: "Mini P.E.K.K.A", form: "hero" },
    { id: 26000037, name: "Inferno Dragon", form: "base" },
    { id: 26000050, name: "Royal Ghost", form: "evolution" },
    { id: 26000059, name: "Royal Hogs", form: "base" },
    { id: 27000000, name: "Cannon", form: "base" },
    { id: 28000001, name: "Arrows", form: "base" },
  ],
  archetype: { label: "Royal Hogs bridge spam", average_elixir: 3.75 },
  battles: 24,
  win_rate: 0.375,
  modes: { ladder: { battles: 24, wins: 9, losses: 15 } },
  dominant_mode: { mode: "ladder", share: 1 },
  mean_level_gap: 0.57,
  last_played_at: "2026-09-19T04:01:25.000Z",
};

type Tally = { battles: number; wins: number; losses: number };

export function summary(
  modes: Record<string, Tally> = {
    event: { battles: 3, wins: 0, losses: 3 },
    ladder: { battles: 39, wins: 13, losses: 26 },
    war: { battles: 39, wins: 23, losses: 16 },
  },
) {
  return {
    player_tag: "#20JJJ2CCRU",
    name: "King Thing",
    trophies: 12500,
    last_30_days: { battles: 81, wins: 36, losses: 45, modes },
    trophy_floor: FLOOR,
    top_deck: TOP_DECK,
    meta: META,
  };
}

/**
 * The season's battles as battles_query returns them (compact), from
 * the Days board: each day's modes and results in the order played,
 * one night a day starting at the local time given (Central, UTC-5 in
 * September). Trophy Road starts at 12,530 and moves 30 a battle, down
 * to the 12,500 floor, where a loss carries no change.
 */
type Played = [mode: string, results: string];
const DAYS: [day: string, start: string, played: Played[]][] = [
  ["2026-09-08", "21:00", [["ladder", "WWL"]]],
  ["2026-09-09", "20:10", [["ladder", "WLWLL"]]],
  [
    "2026-09-10",
    "19:30",
    [
      ["war", "WWL"],
      ["ladder", "L"],
    ],
  ],
  ["2026-09-11", "19:00", [["war", "WLL"]]],
  [
    "2026-09-12",
    "18:00",
    [
      ["event", "L"],
      ["war", "WW"],
      ["ladder", "L"],
    ],
  ],
  ["2026-09-15", "19:27", [["ladder", "WLWLL"]]],
  ["2026-09-16", "21:00", [["ladder", "WLL"]]],
  [
    "2026-09-17",
    "19:00",
    [
      ["war", "WW"],
      ["ladder", "W"],
    ],
  ],
  [
    "2026-09-18",
    "19:00",
    [
      ["war", "LLL"],
      ["ladder", "L"],
    ],
  ],
  ["2026-09-19", "17:00", [["war", "WWL"]]],
  [
    "2026-09-20",
    "19:00",
    [
      ["war", "WLL"],
      ["ladder", "L"],
    ],
  ],
  ["2026-09-21", "22:00", [["ladder", "W"]]],
  ["2026-09-22", "21:11", [["ladder", "WLWLLL"]]],
  ["2026-09-23", "20:00", [["ladder", "LL"]]],
  ["2026-09-24", "19:00", [["war", "WWW"]]],
  [
    "2026-09-26",
    "19:00",
    [
      ["war", "LLL"],
      ["ladder", "W"],
    ],
  ],
  [
    "2026-09-28",
    "22:37",
    [
      ["event", "LL"],
      ["ladder", "LLL"],
    ],
  ],
];
const OPPONENTS = ["Lucky Red Panda", "Chanco", "JaxikoLane", "Ditaka"];

function seasonBattles() {
  const out: Record<string, unknown>[] = [];
  let trophies = 12530;
  let i = 0;
  for (const [day, start, played] of DAYS) {
    const [h = 0, m = 0] = start.split(":").map(Number);
    // Central is UTC-5: 9:00 pm on the 8th is 02:00Z on the 9th.
    let t = Date.parse(`${day}T00:00:00Z`) + ((h + 5) * 60 + m) * 60_000;
    for (const [mode, results] of played)
      for (const r of results) {
        i++;
        const win = r === "W";
        const ladder = mode === "ladder";
        const change = !ladder
          ? null
          : win
            ? 30
            : trophies <= 12500
              ? null
              : -Math.min(30, trophies - 12500);
        const id = (0x5eed0000 + i).toString(16).padStart(12, "0");
        out.push({
          battle_id: `${id}${"0".repeat(52)}`,
          // One battle the record has no page for: no url, no link.
          url: i === 55 ? null : `https://elixir.poapkings.com/battle/${id}`,
          battle_time: new Date(t).toISOString(),
          type: ladder ? "PvP" : mode === "war" ? "riverRacePvP" : "trail",
          game_mode: { id: 72000006, name: "Ladder" },
          arena: { id: 54000142, name: "Ultimate Clash Pit" },
          league_number: null,
          mode_group: mode,
          deck_selection: "collection",
          me: {
            outcome: win ? "win" : "loss",
            crowns: win ? 2 : 0,
            trophy_change: change,
            starting_trophies: ladder ? trophies : null,
            clan_tag: "#J2RGCRVG",
            clan_name: "POAP KINGS",
            global_rank: null,
            deck_hash: TOP_DECK.deck_hash,
          },
          teammates: [],
          opponents: [
            {
              player_tag: "#2PQ8RV0L",
              name: OPPONENTS[i % OPPONENTS.length],
              name_known: true,
              crowns: win ? 0 : 1,
              trophy_change: null,
              starting_trophies: null,
              deck_hash: "c0ffee",
              clan_tag: null,
              clan_name: null,
              global_rank: null,
            },
          ],
        });
        if (ladder) trophies += change ?? 0;
        t += 8 * 60_000;
      }
  }
  // A defense of the clan's boat: in the log, never the member's battle.
  const last = out[out.length - 1] ?? {};
  out.push({
    ...last,
    battle_id: `${"d".repeat(64)}`,
    url: null,
    battle_time: "2026-09-25T00:30:00.000Z",
    type: "boatBattle",
    mode_group: "war",
    boat: { side: "defender" },
    me: { ...(last.me as object), outcome: "loss" },
  });
  return out.sort((a, b) =>
    String(b.battle_time).localeCompare(String(a.battle_time)),
  );
}
const BATTLES = seasonBattles();

/* Decks: the fixture player's season, battles_decks' rows with each
   mode's own numbers (live answers, 2026-10-02, contract 9.18.1). An
   every-mode read pools a deck's modes, as the tool does; a mode's read
   carries only that mode; a deck_hash read adds the cards. */
type Stat = {
  battles: number;
  wins: number;
  losses: number;
  gap: number;
  first: string;
  last: string;
};
interface Deck {
  hash: string;
  names: string;
  label: string;
  tower: string | null;
  cards: { id: number; name: string; form: string }[];
  elixir: number;
  per: Record<string, Stat>;
}
const c = (id: number, name: string, form = "base") => ({ id, name, form });
const HOGS_CORE = [
  c(26000012, "Skeleton Army"),
  c(26000018, "Mini P.E.K.K.A", "hero"),
  c(26000037, "Inferno Dragon"),
];
const DECKS: Deck[] = [
  {
    hash: "b2860741bee79ef1a9af7dd990055ad2aaeebdb6685a02d83f114c6a3d46ba9f",
    names:
      "Evo Witch, Skeleton Army, Hero Mini P.E.K.K.A, Inferno Dragon, Evo Royal Ghost, Royal Hogs, Cannon, Arrows",
    label: "Royal Hogs bridge spam",
    tower: "Tower Princess",
    cards: [
      c(26000007, "Witch", "evolution"),
      ...HOGS_CORE,
      c(26000050, "Royal Ghost", "evolution"),
      c(26000059, "Royal Hogs"),
      c(27000000, "Cannon"),
      c(28000001, "Arrows"),
    ],
    elixir: 3.75,
    per: {
      ladder: {
        battles: 20,
        wins: 8,
        losses: 12,
        gap: 0.6,
        first: "2026-09-08T05:07:03.000Z",
        last: "2026-09-19T04:01:25.000Z",
      },
    },
  },
  {
    hash: "1eb930078d2540f51c6b93d887a9db6c4d72eda7ad91ef5656a66439465aa4c2",
    names:
      "Witch, Skeleton Army, Hero Mini P.E.K.K.A, Inferno Dragon, Royal Ghost, Evo Royal Hogs, Evo Cannon, Arrows",
    label: "Evo Royal Hogs bridge spam",
    tower: "Tower Princess",
    cards: [
      c(26000007, "Witch"),
      ...HOGS_CORE,
      c(26000050, "Royal Ghost"),
      c(26000059, "Royal Hogs", "evolution"),
      c(27000000, "Cannon", "evolution"),
      c(28000001, "Arrows"),
    ],
    elixir: 3.75,
    per: {
      ladder: {
        battles: 15,
        wins: 4,
        losses: 11,
        gap: 0.65,
        first: "2026-09-21T01:04:46.000Z",
        last: "2026-09-30T02:51:11.000Z",
      },
      event: {
        battles: 2,
        wins: 0,
        losses: 2,
        gap: 0,
        first: "2026-09-26T19:12:40.000Z",
        last: "2026-09-26T19:20:02.000Z",
      },
    },
  },
  {
    hash: "ce06788aed5c01a8989b4ba549d81bb5c2f2fcdc6a3586859333bab89dd4e8a0",
    names:
      "Spear Goblins, Dart Goblin, Bandit, Electro Dragon, Golden Knight, Evo Mortar, The Log, Evo Giant Snowball",
    label: "Evo Mortar siege",
    tower: null,
    cards: [],
    elixir: 3.5,
    per: {
      war: {
        battles: 9,
        wins: 5,
        losses: 4,
        gap: 1.75,
        first: "2026-09-11T01:20:56.000Z",
        last: "2026-10-01T03:21:10.000Z",
      },
    },
  },
  {
    hash: "d984fe5a4c6be4c9e34b0d41516fa74e8fb86bb9a62e2f6be645479a93002804",
    names:
      "Evo Witch, Skeleton Army, Musketeer, Hero Mini P.E.K.K.A, Inferno Dragon, Evo Royal Ghost, Royal Hogs, Arrows",
    label: "Royal Hogs bridge spam",
    tower: null,
    cards: [],
    elixir: 3.88,
    per: {
      war: {
        battles: 4,
        wins: 2,
        losses: 2,
        gap: 1.47,
        first: "2026-09-11T01:26:01.000Z",
        last: "2026-09-20T04:06:34.000Z",
      },
    },
  },
  {
    hash: "5de4903fcfe6cd7b51bdfc71933b1e7157992d6f2c1ba666297400268645a2b2",
    names:
      "Skeletons, Evo Valkyrie, Goblin Gang, Wall Breakers, Skeleton King, Cannon, Goblin Barrel, Hero Barbarian Barrel",
    label: "Goblin Barrel bait",
    tower: null,
    cards: [],
    elixir: 2.75,
    per: {
      war: {
        battles: 2,
        wins: 1,
        losses: 1,
        gap: 0.75,
        first: "2026-09-21T00:54:44.000Z",
        last: "2026-09-27T03:44:45.000Z",
      },
    },
  },
  {
    hash: "4994458404930b058e3b6d778b8e21741cdc2f969845a5b721a3248ff5af24c6",
    names:
      "Evo Bomber, Ice Spirit, Zappies, Skeleton Barrel, Goblin Demolisher, Elixir Collector, Goblin Cage, Graveyard",
    label: "Graveyard control",
    tower: "Tower Princess",
    cards: [],
    elixir: 3.38,
    per: {
      event: {
        battles: 1,
        wins: 0,
        losses: 1,
        gap: 0,
        first: "2026-09-12T14:54:58.000Z",
        last: "2026-09-12T14:54:58.000Z",
      },
    },
  },
];
const GOBLIN = DECKS[4] as Deck;
const DUELS = [
  {
    deck_hash:
      "fe30a6ff6aab1d06d80a2b7486833fe2a19914eb3fc162e9c8afdc6323213e86",
    card_names:
      "Minions, Bomber, Hog Rider, Guards, Evo Skeleton Barrel, Boss Bandit, Evo Furnace, Royal Delivery",
    archetype_label: "Evo Skeleton Barrel bait",
    rounds: 10,
    wins: 3,
    losses: 7,
    first_used: "2026-09-11T01:17:13.000Z",
    last_used: "2026-10-01T03:17:24.000Z",
  },
  {
    deck_hash: GOBLIN.hash,
    card_names: GOBLIN.names,
    archetype_label: GOBLIN.label,
    rounds: 8,
    wins: 3,
    losses: 5,
    first_used: "2026-09-11T01:17:13.000Z",
    last_used: "2026-10-01T03:17:24.000Z",
  },
];

/** One deck's row as battles_decks returns it, over `modes`. */
function deckRow(d: Deck, modes: string[], full: boolean) {
  const stats = modes.map((m) => d.per[m]).filter(Boolean) as Stat[];
  const sum = (k: "battles" | "wins" | "losses") =>
    stats.reduce((a, s) => a + s[k], 0);
  const battles = sum("battles");
  const gap =
    stats.reduce((a, s) => a + s.gap * s.battles, 0) / Math.max(1, battles);
  return {
    deck_hash: d.hash,
    card_names: d.names,
    archetype_label: d.label,
    tower_troop_name: d.tower,
    ...(full
      ? {
          cards: d.cards,
          archetype: { label: d.label, average_elixir: d.elixir },
        }
      : {}),
    battles,
    wins: sum("wins"),
    losses: sum("losses"),
    draws: 0,
    win_rate: Math.round((sum("wins") / battles) * 1000) / 1000,
    modes: Object.fromEntries(
      Object.entries(d.per)
        .filter(([m]) => modes.includes(m))
        .map(([m, s]) => [
          m,
          { battles: s.battles, wins: s.wins, losses: s.losses },
        ]),
    ),
    dominant_mode: modes.find((m) => d.per[m]),
    mean_level_gap: Math.round(gap * 100) / 100,
    first_used: stats.map((s) => s.first).sort()[0],
    last_used: stats
      .map((s) => s.last)
      .sort()
      .at(-1),
  };
}

function battlesDecks(args: Record<string, unknown>) {
  const mode = args.mode ? String(args.mode) : null;
  const modes = mode ? [mode] : ["ladder", "ranked", "war", "event"];
  const hash = args.deck_hash ? String(args.deck_hash) : null;
  const rows = DECKS.filter((d) => modes.some((m) => d.per[m]))
    .filter((d) => !hash || d.hash === hash)
    .map((d) => deckRow(d, modes, Boolean(hash)))
    .sort((a, b) => b.battles - a.battles);
  const duels = !mode || mode === "war" ? DUELS : [];
  return {
    player_tag: args.player_tag,
    applied: { ...APPLIED, mode, sort: "battles", limit: args.limit ?? 40 },
    total_battles_in_window: rows.reduce((a, r) => a + r.battles, 0),
    total_decks: rows.length,
    next_offset: null,
    excluded: { duels: duels.length ? 10 : 0, no_deck: 0 },
    comparable: Boolean(mode),
    decks: rows,
    duel_decks: hash ? duels.filter((d) => d.deck_hash === hash) : duels,
    notes: [],
    meta: META,
  };
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** POST /api/explore, answered by tool. `calls` collects every read. */
export function explore(
  calls: ToolCall[] = [],
  { players_summary = summary() }: { players_summary?: unknown } = {},
) {
  return (route: Route): [number, unknown] => {
    const { tool, args = {} } = route.request().postDataJSON() as ToolCall;
    calls.push({ tool, args });
    const ok = (body: unknown): [number, unknown] => [
      200,
      { tool, is_error: false, body },
    ];
    if (tool === "players_summary") return ok(players_summary);
    if (tool === "battles_query") {
      const limit = Number(args.limit ?? 25);
      const from = Number(String(args.cursor ?? "0").replace(/^at:/, ""));
      const page = BATTLES.slice(from, from + limit);
      return ok({
        player_tag: args.player_tag,
        applied: {
          ...APPLIED,
          limit,
          verbosity: args.verbosity ?? "full",
        },
        battles: page,
        ...(args.include_total ? { total_count: BATTLES.length } : {}),
        next_cursor:
          from + limit < BATTLES.length ? `at:${from + limit}` : null,
        notes: [],
        meta: META,
      });
    }
    if (tool === "battles_decks") return ok(battlesDecks(args));
    if (tool === "battles_performance") {
      const mode = String(args.mode ?? "ladder");
      const base = {
        player_tag: args.player_tag,
        applied: { ...APPLIED, mode },
        trophy_floor: mode === "ladder" ? FLOOR : null,
        notes: [],
        meta: META,
      };
      if (args.group_by === "week")
        return ok({
          ...base,
          weekly: mode === "ladder" ? WEEKLY : [],
        });
      return ok({ ...base, window: WINDOWS[mode] ?? WINDOWS.ranked });
    }
    return [
      200,
      {
        tool,
        is_error: true,
        body: {
          error: { code: "unmocked", message: `no fixture for ${tool}` },
        },
      },
    ];
  };
}
