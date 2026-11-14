import { expect, test } from "@playwright/test";
import { ME, mockApi } from "./fixtures.ts";
import { HOME, homeApi } from "./home-fixture.ts";

/**
 * Your own battles, read now (2026-11-14, lib/own-refresh.js): opening the
 * app asks once; while the read is on its way the chip says so; once the
 * follow-up read says it has landed, Home reads again and the chip shows
 * the new read time, without a reload. The server's limits are its own
 * tests (services/web-api/test/own-refresh.test.mjs).
 */
const TAG = HOME.first.player.player_tag;
const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

test("a queued read lands and Home shows it without a reload", async ({
  page,
}) => {
  let landed = false;
  let asks = 0;
  let homeReads = 0;
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": () => {
        homeReads += 1;
        return [
          200,
          {
            first: {
              ...HOME.first,
              player: {
                ...HOME.first.player,
                battlelog_observed_at: landed ? minutesAgo(0) : minutesAgo(40),
              },
            },
          },
        ];
      },
      "POST /api/me/refresh": () => {
        asks += 1;
        return [
          200,
          {
            queued: true,
            players: [{ tag: TAG, state: "queued", retry_after_s: 1 }],
          },
        ];
      },
      "GET /api/me/refresh": () => [
        200,
        {
          players: [
            {
              tag: TAG,
              read_at: landed ? minutesAgo(0) : null,
              pending: !landed,
            },
          ],
          feed_current: true,
        },
      ],
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { level: 1, name: "Home" }),
  ).toBeVisible();
  const chip = page.locator(".kit-fresh summary").first();
  await expect(chip).toHaveText("Checking for new battles…");
  await expect.poll(() => asks).toBe(1);
  const before = homeReads;
  landed = true;
  await expect(chip).toHaveText("Battle log read just now", {
    timeout: 20_000,
  });
  expect(homeReads).toBeGreaterThan(before);
  // One ask for the visit: tapping the chip again soon asks nothing new.
  await chip.click();
  expect(asks).toBe(1);
});

test("no verified player of your own: nothing is asked", async ({ page }) => {
  let asks = 0;
  await mockApi(
    page,
    homeApi({
      "GET /api/me": [
        200,
        {
          ...ME,
          claims: ME.claims.map((c) => ({ ...c, claim_status: "unverified" })),
        },
      ],
      "POST /api/me/refresh": () => {
        asks += 1;
        return [200, { queued: false, players: [] }];
      },
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { level: 1, name: "Home" }),
  ).toBeVisible();
  await expect(page.locator(".kit-fresh summary").first()).toHaveText(
    /^Battle log read /,
  );
  expect(asks).toBe(0);
});
