import { PNG } from "./test-art.ts";
import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import { FIND } from "./find-fixture.ts";
import { ADA } from "./player-fixture.ts";
import { identityFixtures } from "./identity-fixture.ts";

test("phone identities: proof survives missing art; art alone cannot create a verified player", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/assets/cards/26000000.png", (r) => r.abort());
  // The mirror cache is intentionally absent in CI. A successful image is
  // explicit fixture data too, independent of any host's cached game art.
  await page.route("**/assets/cards/26000001.png", (r) =>
    r.fulfill({
      status: 200,
      contentType: "image/png",
      body: PNG,
    }),
  );
  await mockApi(
    page,
    identityFixtures(
      homeApi({
        "GET /api/me/people/find": [
          200,
          {
            ...FIND,
            people: FIND.people
              .filter((p) => ["Juniper", "Elm"].includes(p.name))
              .map((p) => ({
                ...p,
                avatar_card_id: p.name === "Juniper" ? 26000000 : 26000001,
              })),
          },
        ],
        "GET /api/player": [200, ADA],
      }),
    ),
  );
  await page.goto("/home/find");
  const verified = page.getByRole("link", {
    name: "Juniper Verified player",
    exact: true,
  });
  const unverified = page.getByRole("link", { name: "Elm", exact: true });
  await expect(verified).toBeVisible();
  await expect(unverified).toBeVisible();
  const row = page.locator(".kit-people__row").filter({ has: verified });
  await expect(row.locator(".kit-av--verified")).toHaveText("JU");
  const plainRow = page.locator(".kit-people__row").filter({ has: unverified });
  await expect(plainRow.locator(".kit-av img")).toBeVisible();
  await expect(plainRow.locator(".kit-av--verified")).toHaveCount(0);
  for (const tab of await page
    .getByRole("tablist", { name: "Find" })
    .getByRole("tab")
    .all()) {
    const box = await tab.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await verified.click();
  await expect(
    page.getByRole("heading", { name: "Ada Verified player", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".kit-phead .kit-av--verified")).toHaveText("AD");
});
