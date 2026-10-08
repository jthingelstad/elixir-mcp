import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { BATTLE, DUEL } from "./battle-fixture.ts";

const widths = [320, 360, 361, 374, 375, 390, 405, 406, 420, 1280];
const longName = "APlayerNameWithNoBreaksForThisLayoutCheck";
const own = {
  ...ME,
  email: "a-long-fixture-address-without-a-break@example.com",
  claims: [{ ...ME.claims[0], name: longName }],
};

async function inBounds(page: Page, selector: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  const overflow = await page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width > 0 &&
          (rect.left < -0.5 ||
            rect.right > innerWidth + 0.5 ||
            node.scrollWidth > node.clientWidth + 1)
        );
      })
      .map((node) => ({
        className: node.className,
        bounds: node.getBoundingClientRect().toJSON(),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      })),
  );
  expect(overflow, `viewport ${page.viewportSize()?.width}`).toEqual([]);
}

async function accessible(page: Page, include?: string) {
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  if (include) axe = axe.include(include);
  const result = await axe.analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
}

for (const state of ["signed in", "signed out", "checking"] as const) {
  test(`@narrow shared chrome and account controls fit while ${state}`, async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, state === "signed in" ? own : SIGNED_OUT],
      }),
    );
    let finish = () => {};
    if (state === "checking") {
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      await page.route("**/api/me", async (route) => {
        await pending;
        await route.fulfill({ json: SIGNED_OUT });
      });
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of widths) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto("/console/signin");
      await page.locator(".chrome__home").waitFor();
      if (state === "signed in") {
        const account = page.getByRole("button", {
          name: `Account: ${longName}`,
        });
        await expect(account).toBeVisible();
        await account.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#account-menu")).toBeVisible();
        await expect(page.locator(".account-menu__name")).toHaveText(longName);
        await inBounds(
          page,
          ".chrome__inner, .chrome__home, .chrome__menu, .chrome__account, #account-menu, .account-menu__head, .account-menu__name",
        );
        await accessible(page, ".chrome");
        await page.keyboard.press("Escape");
        await expect(account).toBeFocused();
        await expect(page.locator("#account-menu")).toHaveCount(0);
      } else if (state === "signed out") {
        await expect(
          page
            .locator(".chrome__account")
            .getByRole("link", { name: "Sign in" }),
        ).toBeVisible();
      }
      const slot = await page.locator(".chrome__account").boundingBox();
      expect(slot?.width).toBe(width <= 900 ? 96 : 196);
      if (width <= 900) {
        const menu = page.getByRole("button", { name: "Product: Console" });
        await expect(menu).toBeVisible();
        const label = page.locator(".chrome__menu-label");
        expect(
          await label.evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
        expect((await menu.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await menu.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#chrome-sheet")).toHaveAttribute(
          "data-open",
          "true",
        );
        await expect(
          page.locator("#chrome-sheet").getByRole("link", { name: "Docs" }),
        ).toBeVisible();
        await accessible(page, ".chrome");
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      }
      await inBounds(
        page,
        ".chrome__inner, .chrome__home, .chrome__menu, .chrome__account",
      );
    }
    finish();
    expect(errors).toEqual([]);
  });
}

test("@narrow the static docs chrome keeps its home and sign-in controls inside the screen", async ({
  page,
}) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/docs/");
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Elixir home", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".chrome__account").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
    await inBounds(
      page,
      ".chrome__inner, .chrome__home, .chrome__menu, .chrome__account",
    );
    if (width <= 900) {
      const menu = page.getByRole("button", { name: "Product: Docs" });
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#chrome-sheet")).toHaveAttribute(
        "data-open",
        "true",
      );
      await accessible(page, ".chrome");
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
  }
});

const teamBattle = {
  ...BATTLE,
  battle: { ...BATTLE.battle, kind: "2v2" },
  sides: BATTLE.sides.map((side, index) => ({
    ...side,
    players: [
      side.players[0],
      {
        ...side.players[0],
        player_tag: index === 0 ? "#2PYLQG89" : "#8YPRQJ2V",
        name: index === 0 ? "Second player" : "Second opponent",
      },
    ],
  })),
};

for (const gutter of [0, 15]) {
  for (const [kind, record] of [
    ["1v1", BATTLE],
    ["duel", DUEL],
    ["2v2", teamBattle],
  ] as const) {
    test(`@narrow ${kind} battle decks reflow without card or page overflow (${gutter}px reserved gutter${gutter ? ", missing art" : ""})`, async ({
      page,
    }) => {
      if (gutter) {
        // Reserve the content width consumed by a classic scrollbar even
        // on hosts whose Chromium uses overlay scrollbars.
        await page.addInitScript(() => {
          document.addEventListener("DOMContentLoaded", () => {
            document.documentElement.style.paddingRight = "15px";
          });
        });
        await page.route("**/assets/cards/**", async (route) => {
          await route.fulfill({ status: 404, body: "" });
        });
      }
      await mockApi(page, {
        "GET /api/me": [
          200,
          {
            ...ME,
            claims: [
              {
                ...ME.claims[0],
                player_tag: record.sides[0]!.players[0]!.player_tag,
              },
            ],
          },
        ],
        [`GET /api/public/battles/${record.battle.short_id}`]: [200, record],
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const width of widths) {
        await page.setViewportSize({ width, height: 860 });
        await page.goto(`/battle/${record.battle.short_id}`);
        const decks = page.locator(".battle-deck");
        await expect(decks).toHaveCount(kind === "2v2" ? 4 : 2);
        if (gutter) {
          await expect(
            decks.first().locator(".card-art__blank").first(),
          ).toBeVisible();
        }
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          "to",
        );
        expect(await page.title()).toContain("Elixir");
        await inBounds(
          page,
          ".chrome__inner, .chrome__account, .battle__score, .battle__who, .battle-deck, .battle-deck .panel__body, .deck-grid, .card-art",
        );
        const spill = await page
          .locator(".battle-deck .deck-grid")
          .evaluateAll((grids) =>
            grids.some((grid) => {
              const body = grid.closest(".panel__body")!;
              const parent = body.getBoundingClientRect(),
                rect = grid.getBoundingClientRect();
              const css = getComputedStyle(body);
              return (
                rect.left < parent.left + parseFloat(css.paddingLeft) - 0.5 ||
                rect.right > parent.right - parseFloat(css.paddingRight) + 0.5
              );
            }),
          );
        expect(spill).toBe(false);
        const fallbackOverflow = await page
          .locator(".battle-deck .card-art__blank")
          .evaluateAll((blanks) =>
            blanks.some(
              (blank) =>
                blank.scrollWidth > blank.clientWidth + 1 ||
                blank.scrollHeight > blank.clientHeight + 1,
            ),
          );
        expect(fallbackOverflow).toBe(false);
        await expect(decks.first().locator(".deck-grid li")).toHaveCount(8);
        const a = await decks.nth(0).boundingBox(),
          b = await decks.nth(1).boundingBox();
        const available = await page
          .locator(".battle")
          .evaluate((node) => node.clientWidth);
        if (available < 374)
          expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
        else expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
        if (kind === "duel") {
          await page.getByRole("tab", { name: /^Game 3/ }).focus();
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("region", { name: "How game 3 ended" }),
          ).toBeVisible();
          await inBounds(
            page,
            ".battle-deck, .battle-deck .panel__body, .deck-grid, .card-art",
          );
        }
        await accessible(page);
        if (!gutter && (width === 320 || width === 1280))
          await page.screenshot({
            path: `/tmp/elixir-reflow-${kind}-${width}.png`,
            fullPage: false,
          });
      }
      expect(errors).toEqual([]);
    });
  }
}
