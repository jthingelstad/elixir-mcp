/** The public card endpoints as the cards index and a card's page read
 *  them: the six real catalog rows the site's test build bakes
 *  (apps/site/test/fixtures/public-cards.json), with a season block in
 *  the shape services/web-api's readCardSeason returns. The season
 *  numbers here are test values, chosen so the orders differ by mode
 *  and one reading is thin; no page bakes them. */
import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync(
    new URL("../../site/test/fixtures/public-cards.json", import.meta.url),
    "utf8",
  ),
);

const row = (
  battles: number,
  decided: number,
  wins: number,
  players: number | null,
) => ({
  battles,
  players,
  decided_battles: decided,
  usage_share: Number((battles / decided).toFixed(4)),
  win_rate: Number((wins / battles).toFixed(3)),
});

const RANKED = 654_274;
const LADDER = 11_302;
const WAR = 26_300;

const SEASON = {
  season_month: "2026-10",
  as_of: new Date(Date.now() - 3 * 3600_000).toISOString(),
  players_as_of: new Date(Date.now() - 9 * 3600_000).toISOString(),
  modes: [
    { mode_group: "ranked", decided_battles: RANKED },
    { mode_group: "war", decided_battles: WAR },
    { mode_group: "ladder", decided_battles: LADDER },
  ],
  cards: {
    // Barbarian Barrel leads ranked; Knight leads Trophy Road.
    28000015: {
      ranked: row(216_144, RANKED, 109_369, 14_303),
      war: row(4_418, WAR, 2_236, 610),
      ladder: row(1_164, LADDER, 732, 201),
    },
    26000010: {
      ranked: row(198_877, RANKED, 100_433, 13_120),
      ladder: row(2_410, LADDER, 1_190, 388),
    },
    26000000: {
      ranked: row(96_000, RANKED, 47_520, 7_900),
      war: row(5_100, WAR, 2_601, 702),
      ladder: row(3_900, LADDER, 1_989, 560),
    },
    28000000: {
      ranked: row(120_500, RANKED, 60_250, 9_840),
    },
    26000074: {
      ranked: row(40_300, RANKED, 20_955, 3_100),
    },
    26000055: {
      ranked: row(31_200, RANKED, 15_288, 2_480),
      ladder: row(1_800, LADDER, 954, 300),
    },
  },
};

export const CARDS = { ...catalog, season: SEASON };
export const CARDS_NO_SEASON = { ...catalog, season: null };

/** Knight's page: three modes this season, four months, and the issue
 *  that featured it. */
export const KNIGHT = {
  card: {
    id: 26000000,
    name: "Knight",
    rarity: "common",
    elixir_cost: 3,
    forms_available: ["evolution", "hero"],
    type: "troop",
  },
  season: "2026-10",
  as_of: SEASON.as_of,
  history: [
    { season_month: "2026-07", ...row(41_000, 400_000, 20_090, 5_000) },
    { season_month: "2026-08", ...row(52_000, 480_000, 26_520, 6_100) },
    { season_month: "2026-09", ...row(60_000, 500_000, 30_000, 6_900) },
    { season_month: "2026-10", ...row(105_000, 691_876, 52_110, 8_400) },
  ],
  by_mode: [
    { mode_group: "ranked", ...SEASON.cards[26000000].ranked },
    { mode_group: "war", ...SEASON.cards[26000000].war },
    { mode_group: "ladder", ...SEASON.cards[26000000].ladder },
  ],
  issue: {
    period_key: "2026-09-18",
    subject: "Knight, the card that never leaves",
    sent_at: "2026-09-18T14:00:00.000Z",
  },
  disclaimer: catalog.disclaimer,
};
