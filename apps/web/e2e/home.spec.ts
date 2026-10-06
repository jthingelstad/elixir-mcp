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

test("front door focuses on recording and has no global statistics request", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/public/cards"))
      calls.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /on the record/ }),
  ).toBeVisible();
  await expect(page.locator(".home-tile__product")).toHaveText([
    "Console",
    "Ladder",
    "Clan",
    "Friends",
    "Emails",
    "Your AI",
  ]);
  await expect(page.locator("[data-home-top3], [data-home-strip]")).toHaveCount(
    0,
  );
  const play = page
    .getByRole("region", { name: "Drop" })
    .getByRole("link", { name: /Play Drop/ });
  await expect(play).toHaveAttribute("href", "https://drop.poapkings.com/");
  await expect(play).toHaveAttribute("target", "_blank");
  expect(calls).toEqual([]);
  await accessible(page, "home");
});
test("@narrow recorder home fits a phone and tablet", async ({ page }) => {
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    for (const name of [
      "Start in Console ›",
      "Open Ladder ›",
      "Bring your clan ›",
      "Follow a friend ›",
      "See every email ›",
      "Connect your agent ›",
    ])
      await expect(
        page.locator(".home-tile").getByRole("link", { name }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await accessible(page, `home at ${width}`);
  }
});
