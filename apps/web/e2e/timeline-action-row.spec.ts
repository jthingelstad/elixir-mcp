import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";

const tag = "#0QPPRRC9";
const now = "2026-11-18T16:00:00.000Z";
const id = (n: number) => `tl_${String(n).padStart(20, "0")}`;
const common = {
  at: now,
  observed_at: now,
  sort_at: now,
  groups: ["friends"],
  visibility: "public",
  subject_tag: tag,
  subjects: [{ kind: "player", tag, name: "Pip" }],
  cheers: { well_played: 2, royal: 3 },
  my_cheer: null,
  comments: { count: 0, latest: [], open: true },
};
const items = [
  {
    ...TIMELINE.timeline[0],
    ...common,
    id: id(1),
    text: "Pip played five Trophy Road battles.",
  },
  {
    ...common,
    id: id(2),
    kind: "battle_session",
    section: "battles",
    text: "Pip won a Trophy Road battle.",
    facts: {
      player_tag: tag,
      battles: 1,
      won: 1,
      lost: 0,
      by_mode: { ladder: 1 },
      started_at: now,
      ended_at: now,
    },
  },
  {
    ...common,
    id: id(3),
    kind: "badge_earned",
    section: "progress",
    text: "Pip reached Mastery level 5 with Knight.",
    facts: { player_tag: tag, badge: "MasteryKnight", level: 5 },
    moment_card: { id: 26000000, name: "Knight" },
  },
  {
    ...common,
    id: id(4),
    kind: "best_trophies_band",
    section: "progress",
    text: "Pip reached a new best of 9,500 trophies.",
    facts: { player_tag: tag, best: 9500 },
  },
  {
    ...common,
    id: id(5),
    kind: "race_finished",
    section: "war",
    subjects: [{ kind: "clan", tag: "#0QC8RCGY", name: "Pip's Clan" }],
    subject_tag: "#0QC8RCGY",
    text: "Pip's Clan finished its River Race.",
    facts: { fame: 24800 },
  },
  {
    ...common,
    id: id(6),
    kind: "post",
    section: "posts",
    text: "Pip asked a question.",
    facts: {},
    post: {
      id: "401",
      text: "Which card have you enjoyed playing today?",
      question: true,
      author: { name: "Pip", player_tag: tag },
    },
  },
  {
    ...common,
    id: id(7),
    kind: "drop_game",
    section: "attested",
    visibility: "player",
    text: "Pip finished Surge in Elixir Drop with 79.451s. Recovered on P.E.K.K.A.",
    facts: {
      player_tag: tag,
      mode: "surge",
      game_id: "private-game-id",
      score: 79451,
      cards: [{ id: 26000004, name: "P.E.K.K.A.", reason: "recovered" }],
    },
  },
];
const shots = process.env.ACTION_ROW_SHOTS;
test.use({ reducedMotion: "reduce" });
for (const width of [320, 390, 1280]) {
  test(`Timeline actions form one accessible row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => {} },
      }),
    );
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [
          200,
          { ...ME, features: { comments: true, posts: true } },
        ],
        "GET /api/me/home/feed": [
          200,
          {
            ...TIMELINE,
            timeline: items,
            timeline_more: 0,
            total: items.length,
            next: null,
          },
        ],
        "PUT /api/me/cheers": (route) => {
          const body = route.request().postDataJSON();
          return [
            200,
            {
              item_id: body.item_id,
              cheers: { well_played: 3, royal: 3 },
              my_cheer: body.cheer,
            },
          ];
        },
        "GET /api/me/comments": [
          200,
          { comments: [], count: 0, open: true, next_before: null },
        ],
        "POST /api/me/item-shares": [
          200,
          {
            url: "https://elixir.poapkings.com/share/abcdefghijklmnopqrstuvwx",
          },
        ],
      }),
    );
    await page.goto("/timeline");
    const cards = page.locator(".kit-feed__item");
    await expect(cards).toHaveCount(items.length);
    const drop = cards.filter({ hasText: "finished Surge in Elixir Drop" });
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await drop.screenshot({
        path: path.join(shots, `drop-play-${width}.png`),
      });
      await page.screenshot({
        path: path.join(shots, `timeline-actions-${width}.png`),
        fullPage: true,
      });
    }
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const card of await cards.all()) {
      const row = card.locator(".kit-item-actions__row");
      await expect(row).toHaveCount(1);
      const controls = row.locator("button, a");
      await expect(controls).toHaveCount(4);
      const boxes = await Promise.all(
        (await controls.all()).map((b) => b.boundingBox()),
      );
      for (const box of boxes) {
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThan(2);
      }
      if (await card.getByRole("link", { name: /play.*drop/i }).count()) {
        await expect(card).toContainText("finished Surge in Elixir Drop");
      } else {
        await expect(controls.last()).toHaveAccessibleName("Share");
      }
    }
    const play = drop.getByRole("link", {
      name: "Play Elixir Drop (opens in a new tab)",
    });
    await expect(play).toHaveAttribute(
      "href",
      "https://drop.poapkings.com/#/surge",
    );
    await drop.getByRole("button", { name: "Comment", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(play).toBeFocused();
    await page.context().route(
      (url) => url.origin === "https://drop.poapkings.com",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Surge</title>",
        }),
    );
    const popup = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const game = await popup;
    await expect(game).toHaveURL("https://drop.poapkings.com/#/surge");
    expect(
      await game.evaluate(() => [document.referrer, window.opener]),
    ).toEqual(["", null]);
    await game.close();
    await expect(page).toHaveURL(/\/timeline$/);
    const first = cards.first();
    const choose = first.getByRole("button", { name: "Choose a cheer" });
    await choose.focus();
    await page.keyboard.press("Enter");
    await expect(
      first.getByRole("group", { name: "Cheer with", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(choose).toBeFocused();
    const comment = first.getByRole("button", { name: "Comment", exact: true });
    await comment.focus();
    await page.keyboard.press("Enter");
    const box = first.getByRole("textbox", { name: "Your comment" });
    await expect(box).toBeFocused();
    expect((await box.boundingBox())!.y).toBeGreaterThan(
      (await first.locator(".kit-item-actions__row").boundingBox())!.y + 40,
    );
    if (shots)
      await page.screenshot({
        path: path.join(shots, `timeline-thread-${width}.png`),
        fullPage: true,
      });
    await first.getByRole("button", { name: "Share", exact: true }).click();
    const copied = first.getByRole("button", {
      name: "Link copied",
      exact: true,
    });
    await expect(copied).toBeVisible();
    expect((await copied.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await expect(
      first.getByRole("link", { name: "Share image" }),
    ).toBeVisible();
    await expect(
      first.getByRole("button", { name: "Copy for a post" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (shots)
      await page.screenshot({
        path: path.join(shots, `timeline-share-${width}.png`),
        fullPage: true,
      });
  });
}
