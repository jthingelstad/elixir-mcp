import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

const names = (page: Page) =>
  page
    .locator("[data-cards-grid] .card-tile:visible .card-tile__name")
    .allTextContents();
test("catalog browsing works without requesting global statistics", async ({
  page,
}) => {
  // The local card-art cache is absent in CI. Fulfill only the art this
  // case inspects so catalog/form behavior does not depend on a cache hit.
  await page.route("**/assets/cards/26000000_hero-285.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/public/cards"))
      requests.push(r.url());
  });
  await page.goto("/cards");
  expect(await names(page)).toEqual([
    "Barbarian Barrel",
    "Fireball",
    "Golden Knight",
    "Knight",
    "Mega Knight",
    "Skeletons",
  ]);
  await page.getByRole("searchbox", { name: "Find a card" }).fill("knight");
  expect(await names(page)).toEqual(["Golden Knight", "Knight", "Mega Knight"]);
  await page
    .getByRole("group", { name: "Rarity" })
    .getByRole("button", { name: "Champion" })
    .click();
  expect(await names(page)).toEqual(["Golden Knight"]);
  await page
    .getByRole("group", { name: "Rarity" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Elixir" })
    .getByRole("button", { name: "7+", exact: true })
    .click();
  expect(await names(page)).toEqual(["Mega Knight"]);
  await page.getByRole("searchbox", { name: "Find a card" }).fill("");
  await page
    .getByRole("group", { name: "Elixir" })
    .getByRole("button", { name: "7+", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Sort", exact: true })
    .selectOption("elixir");
  expect((await names(page))[0]).toBe("Skeletons");
  await accessible(page, "catalog filters");
  await page.goto("/cards/26000000/?mode=war");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Knight");
  await expect(page.locator(".card-figure img")).toHaveAttribute(
    "alt",
    "Hero Knight",
  );
  await expect(page.getByRole("group", { name: "Mode" })).toHaveCount(0);
  await expect(page.locator("[data-card-live]")).toHaveCount(0);
  expect(requests).toEqual([]);
  await accessible(page, "card facts");
});
test("@narrow catalog and card facts fit phone, tablet and desktop", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    for (const path of ["/cards", "/cards/26000000/"]) {
      await page.goto(path);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await accessible(page, `${path} at ${width}`);
    }
  }
});

test("a missing card-art cache keeps catalog facts readable", async ({
  page,
}) => {
  await page.route("**/assets/cards/**", (route) =>
    route.fulfill({ status: 404, body: "not cached" }),
  );
  await page.goto("/cards/26000000");
  await expect(page.locator(".card-figure .card-art__blank")).toHaveText(
    "Knight",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Knight");
  await accessible(page, "missing art fallback");
});
