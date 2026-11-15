import { PNG } from "./test-art.ts";
import { expect, test } from "@playwright/test";
import { ME, mockApi } from "./fixtures.ts";
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
  // Find's tabs are one row that scrolls inside its own bar on a phone
  // (#1016): the bar stays on the page, each tab a full-height target.
  const bar = await page.getByRole("tablist", { name: "Find" }).boundingBox();
  expect(bar!.x).toBeGreaterThanOrEqual(0);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(390);
  const tops = new Set<number>();
  for (const tab of await page
    .getByRole("tablist", { name: "Find" })
    .getByRole("tab")
    .all()) {
    const box = await tab.boundingBox();
    tops.add(Math.round(box!.y));
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(tops.size).toBe(1);
  await verified.click();
  await expect(
    page.getByRole("heading", { name: "Ada Verified player", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".kit-phead .kit-av--verified")).toHaveText("AD");
});

test("static headers use recent explicit proof, fall back when stale, and add no session request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  let verified = true;
  let sessionReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/me") sessionReads++;
  });
  await mockApi(
    page,
    homeApi({
      "GET /api/me": () => [
        200,
        {
          ...ME,
          claims: ME.claims.map((c) => ({
            ...c,
            status: verified ? "verified" : "unverified",
          })),
          player_verifications: { "#20JJJ2CCRU": verified },
        },
      ],
    }),
  );
  const openFromApp = async () => {
    await page.goto("/home");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("elixir.session") ?? "null")
              ?.verified,
        ),
      )
      .toBe(verified);
    // Tear down Home before counting: its observers can finish a session
    // refresh after the hint is written. Those are not static-page reads.
    await page.goto("about:blank");
    const before = sessionReads;
    await page.goto("/docs");
    expect(sessionReads).toBe(before);
  };
  await openFromApp();
  await expect(page.locator("html")).toHaveAttribute(
    "data-session-player",
    "verified",
  );
  const account = page.locator("a.kit-top__avatar");
  await expect(account).toHaveAccessibleName(/King Thing.*Verified player/);
  await expect(account.locator(".chrome__avatar")).not.toHaveCSS(
    "box-shadow",
    "none",
  );
  await page.clock.fastForward(6 * 60_000);
  await page.goto("/docs/your-account");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-session-player",
    "verified",
  );
  await expect(
    page.locator("a.kit-top__avatar .chrome__avatar > svg"),
  ).toBeVisible();
  await expect(page.locator("a.kit-top__avatar")).not.toHaveAccessibleName(
    /King Thing/,
  );
  verified = false;
  await openFromApp();
  await expect(page.locator("html")).toHaveAttribute(
    "data-session-player",
    "unverified",
  );
  await expect(page.locator("a.kit-top__avatar")).toHaveAccessibleName(
    /King Thing/,
  );
  await expect(page.locator("a.kit-top__avatar .chrome__avatar")).toHaveCSS(
    "box-shadow",
    "none",
  );
});
