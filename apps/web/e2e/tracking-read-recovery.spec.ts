import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

const clan = {
  clan_tag: "#2PQRJ8LV",
  name: "Saved example clan",
  scope: "activity",
  recording_status: "active",
};

for (const width of [390, 1280]) {
  test(`Tracking waits for its first clan read and names a filtered empty list at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockApi(
      page,
      signedIn({ "GET /api/me": [200, { ...ME, claims: [], recordings: [] }] }),
    );
    await page.route("**/api/me/clans", async (route) => {
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ clans: [clan], home_clan: null }),
      });
    });
    try {
      await page.goto("/console/account/tracking");
      await expect(page.getByText("Checking your clans…")).toBeVisible();
      await expect(page.getByText("Nothing tracked yet")).toHaveCount(0);
      release();
      await expect(
        page.getByRole("link", { name: clan.name, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Players", exact: true }).click();
      await expect(
        page.getByText("No players tracked", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Nothing tracked yet")).toHaveCount(0);
      await expect(
        page.getByRole("textbox", { name: "Player tag", exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
  });
  for (const players of [false, true]) {
    test(`Tracking recovers a failed clan read without re-adding (${players ? "returning player" : "no players"}) at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      let failed = true;
      const writes: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/api/") &&
          request.method() !== "GET"
        )
          writes.push(request.method() + " " + new URL(request.url()).pathname);
      });
      await mockApi(
        page,
        signedIn({
          "GET /api/me": [
            200,
            { ...ME, claims: players ? ME.claims : [], recordings: [] },
          ],
          "GET /api/me/clans": () =>
            failed
              ? [503, { error: "unavailable" }]
              : [200, { clans: [clan], home_clan: null }],
        }),
      );
      await page.goto("/console/account/tracking");
      await expect(page.getByRole("alert")).toContainText(
        "Your clans could not be read",
      );
      await expect(page.getByText("Nothing tracked yet")).toHaveCount(0);
      if (players)
        await expect(
          page.getByRole("link", { name: ME.claims[0]!.name, exact: true }),
        ).toBeVisible();
      await page.getByRole("button", { name: "Clans", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const failedA11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        failedA11y.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      failed = false;
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("link", { name: clan.name, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const a11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        a11y.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });
  }

  test(`a clan Tracking deep link recovers a failed read at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let failed = true;
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/") &&
        request.method() !== "GET"
      )
        writes.push(request.method());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/me/clans": () =>
          failed
            ? [503, { error: "unavailable" }]
            : [200, { clans: [clan], home_clan: null }],
      }),
    );
    await page.goto("/console/account/tracking/2PQRJ8LV");
    await expect(page.getByRole("alert")).toContainText(
      "Your clans could not be read",
    );
    await expect(page.getByText("You are not tracking that")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "‹ Tracking" })).toBeVisible();
    failed = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: clan.name, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: clan.name, exact: true }),
    ).toBeVisible();
    expect(writes).toEqual([]);
  });
}
