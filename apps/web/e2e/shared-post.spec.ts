import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";

/**
 * A shared post signed out (canvas Highlight, 2026-11-13): the result, both
 * decks with the score between, four numbers, the full battle one tap away,
 * and the way in under it. Invented players only.
 */
const PLAYER = BATTLE.sides[0]!.players[0]!;
const POST = {
  ...BATTLE,
  highlight: {
    share_id: "k7q2mabcdefghij",
    url: "https://elixir.example.test/h/k7q2mabcdefghij",
    image: "https://elixir.example.test/h/k7q2mabcdefghij.png",
    player_tag: PLAYER.player_tag,
    name: PLAYER.name,
    side: "left",
    outcome: "win",
    words: "Two pushes at the end.",
    created_at: "2026-11-10T14:00:00.000Z",
  },
};

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${name}: accessibility`,
  ).toEqual([]);
}

for (const [label, width] of [
  ["desktop", 1280],
  ["phone", 390],
] as const) {
  test(`${label}: a shared post reads whole without an account`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, {
      "GET /api/me": [200, SIGNED_OUT],
      "GET /api/public/highlights/k7q2mabcdefghij": [200, POST],
    });
    await page.goto("/h/k7q2mabcdefghij");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Birch Lantern beat Harbor Moth 2-1",
      }),
    ).toBeVisible();
    await expect(page.locator(".kit-vs .kit-deckrow")).toHaveCount(2);
    await expect(page.locator(".kit-vs .card-art")).toHaveCount(16);
    await expect(
      page.getByRole("link", { name: "The full battle" }),
    ).toHaveAttribute("href", "/battle/ccd04012bda8");
    await expect(page.getByRole("link", { name: "Join Elixir" })).toBeVisible();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    await accessible(page, `shared post ${label}`);
  });
}
