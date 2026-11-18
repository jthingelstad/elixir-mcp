import { expect, test, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, SIGNED_OUT } from "./fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";
import { SHARED_PUBLIC } from "./session-fixture.ts";

const original = BATTLE.sides[0]!.players[0]!.deck.cards;
const cards = [3, 4, 5, 2, 6, 0, 7, 1].map((i) => ({
  ...original[i]!,
  rarity: i === 1 ? "champion" : "common",
}));
const order = [3, 7, 5, 0, 1, 2, 4, 6];
const label = (c: (typeof cards)[number], levels = false) =>
  `${c.form === "evolution" ? "Evo " : c.form === "hero" ? "Hero " : ""}${c.name}${levels ? `, level ${c.level}` : ""}`;
async function ordered(deck: Locator, levels = false) {
  await expect(deck.locator(".card-art")).toHaveCount(8);
  await expect
    .poll(() =>
      deck
        .locator(".card-art")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))),
    )
    .toEqual(order.map((i) => label(cards[i]!, levels)));
}
const ids = { post: "b".repeat(24), session: "c".repeat(24) };
const deck = {
  ...BATTLE.sides[0]!.players[0]!.deck,
  cards: cards.map(({ level: _, ...card }) => card),
};
const battle = structuredClone(BATTLE);
for (const side of battle.sides)
  for (const player of side.players) player.deck.cards = cards;
const post = {
  id: "tl_00000000000000000041",
  kind: "post",
  at: BATTLE.battle.battle_time,
  subjects: [
    {
      kind: "player",
      tag: BATTLE.sides[0]!.players[0]!.player_tag,
      name: BATTLE.sides[0]!.players[0]!.name,
    },
  ],
  post: {
    text: "This deck",
    author: {
      player_tag: BATTLE.sides[0]!.players[0]!.player_tag,
      name: BATTLE.sides[0]!.players[0]!.name,
    },
    question: false,
    deck: { ...deck, cards: deck.cards.map(({ rarity: _, ...c }) => c) },
  },
};
const session = {
  ...SHARED_PUBLIC.item,
  deck: { ...deck, label: SHARED_PUBLIC.item.deck.label },
};
const catalog = {
  cards: cards.map((c) => ({
    ...c,
    art: {
      base: `/assets/cards/${c.id}.png`,
      evolution: `/assets/cards/${c.id}_evo.png`,
    },
  })),
};

for (const width of [320, 390, 1280]) {
  test(`@narrow deck slots stay consistent across member and shared views at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockApi(
      page,
      signedIn({
        "GET /api/public/cards": [200, catalog],
        [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, battle],
      }),
    );
    await page.goto(`/battle/${BATTLE.battle.short_id}`);
    await ordered(page.locator("ul.deck-grid").first(), true);
    const copy = page
      .getByRole("link", { name: /^Copy .+deck into Clash Royale$/ })
      .first();
    await expect(copy).toHaveAttribute(
      "href",
      new RegExp(cards.map((c) => c.id).join(";")),
    );
    await copy.focus();
    await expect(copy).toBeFocused();
    await page.screenshot({
      path: `/tmp/elixir-deck-slots-battle-${width}.png`,
      fullPage: true,
    });

    await mockApi(page, {
      "GET /api/me": [200, SIGNED_OUT],
      "GET /api/public/cards": [200, catalog],
      [`GET /api/public/shared-items/${ids.post}`]: [200, { item: post }],
      [`GET /api/public/shared-items/${ids.session}`]: [200, { item: session }],
    });
    await page.goto(`/share/${ids.post}`);
    await ordered(page.locator("ul.kit-deckrow").first());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Shared on Elixir",
    );
    await page.screenshot({
      path: `/tmp/elixir-deck-slots-post-${width}.png`,
      fullPage: true,
    });
    await page.goto(`/share/${ids.session}`);
    await ordered(page.locator("ul.kit-deckrow").first());
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-deck-slots-session-${width}.png`,
      fullPage: true,
    });
  });
}
