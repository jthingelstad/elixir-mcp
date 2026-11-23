import { expect, test } from "@playwright/test";
import { ME, mockApi } from "./fixtures.ts";
import { HOME, homeApi } from "./home-fixture.ts";
import { ADA } from "./player-fixture.ts";

/**
 * Your own battles, read now (2026-11-14, lib/own-refresh.js): opening the
 * app asks once; while the read is on its way the chip says so; once the
 * follow-up read says it has landed, Home reads again and the chip shows
 * the new read time, without a reload. A player page's button (2026-11-23)
 * also says what the check found. The server's limits are its own tests
 * (services/web-api/test/own-refresh.test.mjs).
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
    page.getByRole("heading", { level: 1, name: "Timeline" }),
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
    page.getByRole("heading", { level: 1, name: "Timeline" }),
  ).toBeVisible();
  await expect(page.locator(".kit-fresh summary").first()).toHaveText(
    /^Battle log read /,
  );
  expect(asks).toBe(0);
});

/** Another player's page whose button finds two new battles and a
 *  trophy change (2026-11-23): the ask carries `tap`, the follow-up read
 *  the ask's marker. */
async function playerWithCheck(
  page: import("@playwright/test").Page,
  { asked, sinces }: { asked: unknown[]; sinces: (string | null)[] },
) {
  const state = { landed: false };
  let tries = 0;
  await mockApi(
    page,
    homeApi({
      "GET /api/player": () => [
        200,
        state.landed
          ? {
              ...ADA,
              timeline: [
                {
                  id: "t2",
                  kind: "pol_league_up",
                  at: new Date().toISOString(),
                  text: "Reached a new league.",
                },
                ...ADA.timeline,
              ],
            }
          : ADA,
      ],
      "POST /api/me/refresh": (route) => {
        const body = route.request().postDataJSON();
        asked.push(body);
        if (!body?.player_tag) return [200, { queued: false, players: [] }];
        tries += 1;
        // The second tap inside the two minutes: a quiet limit.
        if (tries > 1)
          return [
            200,
            {
              queued: false,
              since: "m2",
              players: [
                {
                  tag: ADA.player.tag,
                  state: "skipped",
                  retry_after_s: 90,
                  profile: "skipped",
                },
              ],
            },
          ];
        return [
          200,
          {
            queued: true,
            since: "m1",
            players: [
              {
                tag: ADA.player.tag,
                state: "queued",
                retry_after_s: 1,
                profile: "queued",
              },
            ],
          },
        ];
      },
      "GET /api/me/refresh": (route) => {
        sinces.push(new URL(route.request().url()).searchParams.get("since"));
        return [
          200,
          {
            players: [
              {
                tag: ADA.player.tag,
                read_at: state.landed ? new Date().toISOString() : null,
                pending: !state.landed,
                new_battles: state.landed ? 2 : 0,
                newest_battle_at: new Date(
                  Date.now() - 5 * 60_000,
                ).toISOString(),
                latest_is_new: state.landed,
                profile_read_at: null,
                profile_pending: !state.landed,
                profile_changes: state.landed
                  ? [{ field: "trophies", from: 12560, to: 12593 }]
                  : [],
              },
            ],
            feed_current: true,
          },
        ];
      },
    }),
  );
  await page.goto(`/home/player/${ADA.player.tag.slice(1)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ada" }),
  ).toBeVisible();
  return state;
}

test("another player's page: the button reads them once, and says what it found", async ({
  page,
}) => {
  const asked: unknown[] = [];
  const sinces: (string | null)[] = [];
  const state = await playerWithCheck(page, { asked, sinces });
  const button = page.getByRole("button", { name: "Check for new battles" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  // Keyboard reachable: focus it and press Enter.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Checking…" })).toBeVisible();
  await expect(
    page.getByText(
      "Asking Clash Royale for their latest battles and profile. This takes a few seconds.",
    ),
  ).toBeVisible();
  expect(
    asked.filter((b) => (b as { player_tag?: string })?.player_tag),
  ).toEqual([{ player_tag: ADA.player.tag, tap: true }]);
  state.landed = true;
  await expect(page.getByText("Reached a new league.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/^2 new battles\. Last battle /)).toBeVisible();
  await expect(page.getByText("Trophies 12,560 → 12,593")).toBeVisible();
  expect(new Set(sinces)).toEqual(new Set(["m1"]));
  const again = page.getByRole("button", { name: "Check again" });
  await expect(again).toBeVisible();
  await again.click();
  await expect(
    page.getByRole("button", { name: "Try again in 2 min" }),
  ).toBeVisible();
});

test("the check's lines fit a phone @narrow", async ({ page }) => {
  const state = await playerWithCheck(page, { asked: [], sinces: [] });
  state.landed = true;
  await page.getByRole("button", { name: "Check for new battles" }).click();
  const line = page.getByText("Trophies 12,560 → 12,593");
  await expect(line).toBeVisible({ timeout: 20_000 });
  const width = page.viewportSize()?.width ?? 0;
  const box = await line.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
