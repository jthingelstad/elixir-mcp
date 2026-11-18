import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, SIGNED_OUT } from "./fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";

/** An issued post link exposes that post and its decks, with no route to
 * an unshared game record and no member actions. Invented players only. */
const PLAYER = BATTLE.sides[0]!.players[0]!;
const OPPONENT = BATTLE.sides[1]!.players[0]!;
const ID = "abcdefghijklmnopqrstuvwx";
const ITEM = {
  id: "tl_00000000000000000042",
  kind: "post",
  at: "2026-11-10T14:00:00.000Z",
  subject_tag: PLAYER.player_tag,
  subjects: [{ kind: "player", tag: PLAYER.player_tag, name: PLAYER.name }],
  post: {
    text: "Two pushes at the end. <b>Good game</b>",
    question: false,
    author: { player_tag: PLAYER.player_tag, name: PLAYER.name },
    battle: {
      battle_id: BATTLE.battle.id,
      outcome: "win",
      crowns: 2,
      crowns_against: 1,
      mode_group: "ladder",
      opponents: [{ player_tag: OPPONENT.player_tag, name: OPPONENT.name }],
    },
    versus: { mine: PLAYER.deck, theirs: OPPONENT.deck },
  },
};

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
    name,
  ).toEqual([]);
}

for (const width of [320, 390, 1280]) {
  test(`an issued post reads whole without an account at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/") &&
        request.method() !== "GET"
      )
        writes.push(request.url());
    });
    await mockApi(page, {
      "GET /api/me": [200, SIGNED_OUT],
      [`GET /api/public/shared-items/${ID}`]: [200, { item: ITEM }],
    });
    await page.goto(`/share/${ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Shared on Elixir" }),
    ).toBeVisible();
    await expect(page.getByText(ITEM.post.text, { exact: true })).toBeVisible();
    expect(await page.locator(".kit-written__text b").count()).toBe(0);
    await expect(page.locator(".kit-vs .kit-deckrow")).toHaveCount(2);
    await expect(page.locator(".kit-vs .card-art")).toHaveCount(16);
    await expect(
      page.locator('main a[href^="/battle/"], main a[href^="/home/player/"]'),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Follow|Choose a cheer|Share/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", `/signin?signup&return_to=%2Fshare%2F${ID}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await accessible(page, `shared post at${width}`);
    expect(writes).toEqual([]);
  });
}

for (const width of [320, 390, 1280]) {
  test(`follow the shared post's author with confirmation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const claims: unknown[] = [];
    const candidate = {
      player_tag: PLAYER.player_tag,
      name: PLAYER.name,
      following: false,
      free: true,
    };
    await mockApi(
      page,
      signedIn({
        [`GET /api/public/shared-items/${ID}`]: [200, { item: ITEM }],
        "GET /api/me/follow-plan": [
          200,
          { players: [candidate], yours: [], used: 0, limit: 5 },
        ],
        "GET /api/me/follow-cost": [200, { ...candidate, used: 0, limit: 5 }],
        "POST /api/claims": (route) => {
          claims.push(route.request().postDataJSON());
          return [
            200,
            { player_tag: PLAYER.player_tag, relationship: "friend" },
          ];
        },
      }),
    );
    await page.goto(`/share/${ID}`);
    const follow = page.getByRole("link", {
      name: `Follow ${PLAYER.name}`,
      exact: true,
    });
    await follow.focus();
    await expect(follow).toBeFocused();
    const bounds = await follow.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    if (process.env.ELIXIR_SHARE_FOLLOW_SCREENSHOTS)
      await page.screenshot({ path: `/tmp/elixir-share-follow-${width}.png` });
    await accessible(page, "member shared post");
    await follow.press("Enter");
    await expect(page).toHaveURL(`/home/follow/${PLAYER.player_tag.slice(1)}`);
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    expect(claims).toEqual([]);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Follow", exact: true })
      .click();
    await expect
      .poll(() => claims)
      .toEqual([{ player_tag: PLAYER.player_tag, relationship: "friend" }]);
  });
}
