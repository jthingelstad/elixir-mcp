import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

/**
 * Settings › What members see, the canvas's two controls (2026-11-12): the
 * slot meter (used of limit, the players using a slot because of you,
 * each with its way to stop, and apart from them the free follows) and
 * Location (your place on the clan map, saying who sees it). At phone and
 * desktop width, with axe. Invented players; local mocks only.
 */

const SLOTS = {
  used: 2,
  free: 1,
  limit: 50,
  players: [
    {
      player_tag: "#QQ8822",
      name: "Copper Fern",
      slot: "used",
      reason: null,
      yours: "friend",
      agents: [],
    },
    {
      player_tag: "#UUU2",
      name: "Umber Kite",
      slot: "used",
      reason: null,
      yours: null,
      agents: [
        { public_id: "abc12345", name: "Scout Bot", relationship: "watching" },
      ],
    },
    {
      player_tag: "#VVV9",
      name: "Violet Reed",
      slot: "free",
      reason: "followed_by_others",
      yours: "friend",
      agents: [],
    },
  ],
};

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

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
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("the slot meter: used of limit, who uses one, and a way to stop", async ({
      page,
    }) => {
      const posted: unknown[] = [];
      await mockApi(
        page,
        signedIn({
          "GET /api/me/follow-slots": [200, SLOTS],
          "GET /api/clan/me/place": [200, { place: null }],
          "POST /api/claims": (route) => {
            posted.push(route.request().postDataJSON());
            return [200, { ok: true, removed: true }];
          },
        }),
      );
      await page.goto("/settings/what-members-see");
      const panel = page.getByRole("region", { name: "Your follow slots" });
      // The meter says what a Follow dialog says: 2 of 50 used.
      const meter = panel.getByRole("progressbar", {
        name: "Follow slots: 2 of 50 used",
      });
      await expect(meter).toBeVisible();
      await expect(meter).toHaveAttribute("value", "2");
      await expect(meter).toHaveAttribute("max", "50");
      const using = panel.getByLabel("Players using a slot");
      await expect(using.getByText("Copper Fern")).toBeVisible();
      await expect(using.getByText("Umber Kite")).toBeVisible();
      await expect(
        using.getByRole("link", { name: "Agent", exact: true }),
      ).toHaveAttribute("href", "/settings/agents/abc12345/reads");
      const free = panel.getByLabel("Free follows");
      await expect(free.getByText("Violet Reed")).toBeVisible();
      await expect(
        free.getByText(/Another account followed them first/),
      ).toBeVisible();
      await expect(free.getByRole("button")).toHaveCount(0);
      await noSideways(page);
      await accessible(page, `slot meter ${label}`);

      await using.getByRole("button", { name: "Stop following" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Stop following Copper Fern?",
      });
      await expect(dialog).toContainText("Their slot is free again at once.");
      await accessible(page, `stop following ${label}`);
      await dialog.getByRole("button", { name: "Stop following" }).click();
      await expect(dialog).toHaveCount(0);
      expect(posted).toEqual([{ player_tag: "#QQ8822", action: "remove" }]);
    });

    test("Location: your place on the clan map, and who sees it", async ({
      page,
    }) => {
      const saved: unknown[] = [];
      let place: unknown = null;
      await mockApi(
        page,
        signedIn({
          "GET /api/me/follow-slots": [200, SLOTS],
          "GET /api/clan/me/place": () => [200, { place }],
          "PUT /api/clan/me/place": (route) => {
            const body = route.request().postDataJSON();
            saved.push(body);
            place = {
              country: "NO",
              country_name: "Norway",
              region: null,
              region_name: null,
              city: null,
              city_name: null,
              precision: "country",
              lat: 62,
              lng: 10,
              tz: "Europe/Oslo",
            };
            return [200, { place }];
          },
        }),
      );
      await page.goto("/settings/what-members-see");
      const location = page.getByRole("region", { name: "Location" });
      await expect(location).toContainText(
        "only the verified members of each clan your verified player is in",
      );
      // Nothing about players near you: that waits on a legal view.
      await expect(location).not.toContainText(/near/i);
      const country = location.getByLabel("Country");
      await expect(country.locator("option")).not.toHaveCount(1);
      await noSideways(page);
      await accessible(page, `location ${label}`);
      await country.selectOption("NO");
      const regionOrCity = location.getByLabel(/State or region|City/);
      await expect(regionOrCity.first()).toBeVisible();
      // Norway has regions in the list or not; either way a country alone
      // is allowed only when it has none, so pick what is offered.
      if (await location.getByLabel("State or region").count())
        await location.getByLabel("State or region").selectOption({ index: 1 });
      await location.getByRole("button", { name: "Add me" }).click();
      await expect(location).toContainText("You’re on the map at");
      expect(saved).toHaveLength(1);
      expect((saved[0] as { country: string }).country).toBe("NO");
    });

    test("Location with no verified player says how to get one", async ({
      page,
    }) => {
      await mockApi(
        page,
        signedIn({
          "GET /api/me/follow-slots": [200, { ...SLOTS, players: [] }],
          "GET /api/clan/me/place": [
            403,
            { error: "gate", reason: "unverified" },
          ],
        }),
      );
      await page.goto("/settings/what-members-see");
      const location = page.getByRole("region", { name: "Location" });
      await expect(
        location.getByRole("link", { name: "Verify your player" }),
      ).toHaveAttribute("href", "/settings/players");
      await accessible(page, `location unverified ${label}`);
    });
  });
}
