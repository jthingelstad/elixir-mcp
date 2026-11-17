import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures.ts";
import { SESSION_DAY, sessionDayApi } from "./session-fixture.ts";

/**
 * Each mode told the way the game tells it (2026-11-16): a Ranked climb,
 * an Ultimate Champion rating, a 2v2 with a followed teammate and a
 * challenge run each say so on the session card, phone first. Invented
 * players. MODE_LINE_SHOTS=<dir> also saves each card as a picture.
 */
type Item = Record<string, unknown> & {
  id: string;
  evidence: Record<string, unknown>;
  facts: Record<string, unknown>;
};
const base = SESSION_DAY.timeline as unknown as Item[];
const ranked = base.find((it) => it.id === "tl_sr")!;
const event = base.find((it) => it.id === "tl_se")!;
const like = (it: Item, id: string, facts: Record<string, unknown>) => ({
  ...it,
  id,
  evidence: { ...it.evidence, version: id },
  facts: { ...it.facts, ...facts },
});

const ITEMS = [
  like(ranked, "tl_m_climb", {
    ranked: {
      battles: 4,
      won: 3,
      lost: 1,
      league_from: 3,
      league_from_name: "Master III",
      league_to: 4,
      league_to_name: "Champion",
      promotions: [
        { from: 3, to: 4, from_name: "Master III", to_name: "Champion" },
      ],
    },
  }),
  like(ranked, "tl_m_uc", {
    ranked: {
      battles: 4,
      won: 3,
      lost: 1,
      league_from: 7,
      league_from_name: "Ultimate Champion",
      league_to: 7,
      league_to_name: "Ultimate Champion",
      promotions: [],
      rating: { from: 1850, to: 1940 },
    },
  }),
  like(ranked, "tl_m_2v2", {
    by_mode: { event: 4 },
    events: [{ event_tag: "#0Q2L8", name: "Classic 2v2", battles: 4 }],
    together: [
      { player_tag: "#0PLUG2V9", name: "Slate Owl", with: 4, against: 0 },
    ],
  }),
  like(event, "tl_m_run", {
    events: [
      {
        event_tag: "#0YY9P",
        name: "Classic Challenge",
        battles: 6,
        won: 5,
        lost: 1,
        run_wins: 5,
      },
    ],
  }),
];

test("@narrow phone: a sitting says its mode's facts", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await mockApi(
    page,
    sessionDayApi({
      "GET /api/me/home/feed": () => [200, { ...SESSION_DAY, timeline: ITEMS }],
    }),
  );
  await page.goto("/home");
  const lists = page.getByRole("list", { name: "How it was played" });
  await expect(lists).toHaveText([
    "Climbed Master III to Champion",
    /Ranked: Ultimate Champion\s*Rating 1,850 to 1,940/,
    "With Slate Owl",
    "Classic Challenge: up to 5 wins",
  ]);
  const shots = process.env.MODE_LINE_SHOTS;
  if (!shots) return;
  // Tall enough that the bottom tabs cover no card.
  await page.setViewportSize({ width: 420, height: 2400 });
  for (const [i, name] of [
    "ranked-climb",
    "ultimate-champion",
    "2v2-teammate",
    "challenge-run",
  ].entries()) {
    const card = lists
      .nth(i)
      .locator(
        "xpath=ancestor::*[contains(concat(' ', @class, ' '), ' kit-scard ')][1]",
      );
    await card.screenshot({ path: `${shots}/${name}.png` });
  }
});
