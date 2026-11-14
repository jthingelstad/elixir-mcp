import { identityFixtures } from "./identity-fixture.ts";
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import { explore } from "./stats-fixture.ts";
import { signedIn as clanIn } from "./clan/fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";
import { FIND } from "./find-fixture.ts";
import { ADA } from "./player-fixture.ts";

// Reuse the journeys' invented people. Capture actual phone viewports,
// not a crop of a desktop window. Set ELIXIR_DESIGN_CAPTURE_DIR for review.
for (const width of [390, 1280]) {
  test(`design direction at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    if (process.env.ELIXIR_DESIGN_NOW)
      await page.clock.setFixedTime(new Date(process.env.ELIXIR_DESIGN_NOW));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(
      page,
      identityFixtures({
        ...clanIn(),
        ...homeApi({
          "GET /api/player": [200, ADA],
          ...(process.env.ELIXIR_DESIGN_SURFACE === "people"
            ? {
                "GET /api/me/people/find": [
                  200,
                  {
                    ...FIND,
                    people: FIND.people
                      .filter((p) => ["Juniper", "Elm"].includes(p.name))
                      .map((p) => ({
                        ...p,
                        avatar_card_id: p.name === "Juniper" ? 26000000 : null,
                      })),
                  },
                ],
              }
            : {}),
          "POST /api/me/tool": explore(),
          [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
        }),
      }),
    );
    const dir = process.env.ELIXIR_DESIGN_CAPTURE_DIR;
    for (const [name, url, ready] of [
      ["site", "/", "h1"],
      ["docs", "/docs", "h1"],
      ["home", "/home", ".kit-feed__item"],
      ["player", "/home/player/00C298UC", ".kit-phead__name"],
      ["find", "/home/find", "h1"],
      ["stats", "/home/you/stats", ".stats-page"],
      ["clan", "/clan/0QC8RCGY/members", ".clan-head"],
      ["settings", "/settings/usage", ".kit-head__title"],
      ["battle", `/battle/${BATTLE.battle.short_id}`, "h1"],
      ...(process.env.ELIXIR_DESIGN_SURFACE === "people"
        ? [
            ["find-clan", "/home/find", "h1"],
            ["find-search", "/home/find", "h1"],
            ["find-battles", "/home/find", "h1"],
            ["find-directory", "/home/find", "h1"],
            ["find-link", "/home/find", "h1"],
            ["home-cheers", "/home", ".kit-feed__item"],
          ]
        : []),
    ]) {
      if (
        process.env.ELIXIR_DESIGN_SCENES &&
        !process.env.ELIXIR_DESIGN_SCENES.split(",").includes(name!)
      )
        continue;
      await page.goto(url!);
      await expect(page.locator(ready!).first()).toBeVisible();
      const tab = {
        "find-clan": "Your clan",
        "find-search": "Search",
        "find-battles": "From your battles",
        "find-directory": "Clan directory",
        "find-link": "Your link",
      }[name!];
      if (tab)
        await page
          .getByRole("tablist", { name: "Find" })
          .getByRole("tab", { name: tab, exact: true })
          .click();
      if (name === "home-cheers")
        await page.getByRole("button", { name: "Cheer", exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      // Lazy art below the first screen must be decoded before a full-page
      // capture. Waiting only for fonts can publish a blank deck.
      await page.evaluate(async () => {
        const images = [...document.images];
        for (const image of images) image.loading = "eager";
        await Promise.all(
          images.map((image) => image.decode().catch(() => {})),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      if (dir) {
        mkdirSync(dir, { recursive: true });
        for (const fullPage of [false, true])
          await page.screenshot({
            path: path.join(
              dir,
              `${name}-${width}${fullPage ? "-full" : ""}.png`,
            ),
            fullPage,
            animations: "disabled",
          });
        writeFileSync(
          path.join(dir, `${name}-${width}-words.txt`),
          await page.locator("body").innerText(),
        );
      }
    }
    expect(errors).toEqual([]);
  });
}
