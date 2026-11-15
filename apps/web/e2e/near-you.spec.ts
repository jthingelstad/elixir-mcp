import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * Find's Near you and the player map (#768, Jamie 2026-11-14: city-level
 * location is fine for everyone; the gate goes). People on the player map
 * in your region, each with where as a fact and a Follow, your city first
 * and never ranked; the player map below, at picked places only. A place
 * is a place (Jamie, 2026-11-15): everyone who set one is on both, with
 * nothing to join or leave. A reader with no place is asked to set one.
 * At 320, 390 and 1280 px, in both color schemes (Elixir draws one theme,
 * so the two must agree), with axe. Invented players; local mocks only.
 * PLAYER_MAP_SHOTS names a folder for the screenshots.
 */

const place = (
  city: [number, string, number, number] | null,
  region = ["TX", "Texas"],
) => ({
  country: "US",
  country_name: "United States",
  region: region[0],
  region_name: region[1],
  city: city ? city[0] : null,
  city_name: city ? city[1] : null,
  precision: city ? "city" : "region",
  lat: city ? city[2] : 31.25,
  lng: city ? city[3] : -99.25,
  tz: "America/Chicago",
});
const AUSTIN: [number, string, number, number] = [
  4671654,
  "Austin",
  30.27,
  -97.74,
];
const HOUSTON: [number, string, number, number] = [
  4699066,
  "Houston",
  29.76,
  -95.36,
];

const NEAR = {
  ok: true,
  place: { name: "Austin", region_name: "Texas" },
  people: [
    {
      tag: "#0VJLRY",
      name: "Invented Austin",
      why: [{ kind: "near", place_name: "Austin" }],
      free: true,
      reason: "recorded",
    },
    {
      tag: "#0VJLRC",
      name: "Invented Texan",
      why: [{ kind: "near", place_name: "Texas" }],
      free: false,
      reason: null,
    },
    {
      tag: "#0VJLR8",
      name: "Invented Houston",
      why: [{ kind: "near", place_name: "Houston" }],
      free: false,
      reason: null,
    },
  ],
  truncated: false,
  used: 3,
  limit: 50,
};
const MAP = {
  ok: true,
  entries: [
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      you: true,
      place: place(AUSTIN),
    },
    {
      player_tag: "#0VJLRY",
      name: "Invented Austin",
      you: false,
      place: place(AUSTIN),
    },
    {
      player_tag: "#0VJLRC",
      name: "Invented Texan",
      you: false,
      place: place(null),
    },
    {
      player_tag: "#0VJLR8",
      name: "Invented Houston",
      you: false,
      place: place(HOUSTON),
    },
  ],
  on_map: 4,
  truncated: false,
  attribution:
    "Places from GeoNames (geonames.org, CC BY 4.0). Map © OpenStreetMap contributors.",
};

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=",
  "base64",
);

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .include(".kit-find")
    // Leaflet's own controls and tiles are the library's, not ours.
    .exclude(".leaflet-container")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    `${name}: accessibility`,
  ).toEqual([]);
}

async function shot(page: Page, name: string) {
  const dir = process.env.PLAYER_MAP_SHOTS;
  await page.screenshot({
    path: dir ? `${dir}/${name}.png` : test.info().outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function openNear(page: Page, near: unknown, extra = {}) {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
  await mockApi(
    page,
    homeApi({
      "GET /api/me/people/near": [200, near],
      "GET /api/me/player-map": [200, MAP],
      ...extra,
    }),
  );
  await page.goto("/home/find");
  await page
    .getByRole("tablist", { name: "Find" })
    .getByRole("tab", { name: "Near you" })
    .click();
}

for (const width of [320, 390, 1280]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${width} ${scheme}: Near you lists who plays near you, then the player map`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await openNear(page, NEAR);
      const list = page.locator(".kit-near");
      const rows = list.locator(".kit-people__row");
      await expect(rows).toHaveCount(3);
      // Your city first, then by name; where is the place each picked.
      await expect(rows.nth(0)).toContainText("Plays near you, in Austin");
      await expect(rows.nth(0)).toContainText("Free");
      await expect(rows.nth(1)).toContainText("Plays near you, in Texas");
      await expect(rows.nth(2)).toContainText("Plays near you, in Houston");
      await expect(rows.getByRole("button", { name: /Follow/ })).toHaveCount(3);
      await expect(list).toContainText(
        "People who set a place in Texas. Your city first, then by name. Never ranked.",
      );
      await expect(list).not.toContainText(/trophies|km\b|miles/i);
      // The player map: pins at picked places, and its sources.
      const map = page.locator(".kit-playermap");
      await expect(map).toContainText("4 players are on the player map.");
      await expect(map).toContainText(
        "Each pin is the place someone picked, never closer.",
      );
      await expect(map.locator(".leaflet-interactive")).toHaveCount(3);
      await expect(map).toContainText("Places from GeoNames");
      await noSideways(page);
      await accessible(page, `near you ${width} ${scheme}`);
      await shot(page, `near-you-${width}-${scheme}`);
    });
  }
}

test("a reader with no place is asked to set one, and still sees the map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNear(page, { ok: true, place: null, people: [] });
  const set = page.getByRole("link", { name: "Set your place" });
  await expect(set).toHaveAttribute("href", "/settings/profile#place");
  await expect(page.locator(".kit-near")).toContainText(
    "Set your place to see players near you.",
  );
  await expect(page.locator(".kit-playermap")).toBeVisible();
  await noSideways(page);
  await accessible(page, "near you, no place");
  await shot(page, "near-you-no-place-390");
});
