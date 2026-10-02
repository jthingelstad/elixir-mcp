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
