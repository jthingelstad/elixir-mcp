import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { HOME, homeApi } from "./home-fixture.ts";

/**
 * Home (slice 7, #765): one feed beside your week and your clan, its chips,
 * the bell where Needs you went, and Find and You, at desktop and phone
 * widths, with nothing scrolling the page sideways. Invented players only.
 */
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

const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";

const SPARK_WORDS =
  "5 battles: 3 wins, 2 losses. In order: won by 3 crowns, lost by 1 crown, won by 2 crowns, won by 1 crown, lost by 2 crowns";

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("Home: one feed beside your week and your clan", async ({ page }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      await expect(
        page.getByRole("heading", { level: 1, name: "Home" }),
      ).toBeVisible();
      // The three tabs are gone.
      await expect(page.getByRole("tab", { name: "Timeline" })).toHaveCount(0);
      const feed = page.locator(".kit-feed");
      await expect(feed.getByText("Won 3 of 5 in Trophy Road.")).toBeVisible();
      await expect(
        feed.getByText("Ada's Clan finished 2nd in the river race."),
      ).toBeVisible();
      await expect(feed.getByText("Reached Path of Legends.")).toBeVisible();
      // A sitting's sparkline, and the same facts in words.
      await expect(feed.getByRole("img", { name: SPARK_WORDS })).toBeVisible();
      await expect(
        feed.getByText("5 battles · 3 won · 2 lost · +28 trophies"),
      ).toBeVisible();
      // A clan's line wears the gold edge; a moment links its battle.
      await expect(page.locator(".kit-feed__item--clan")).toHaveCount(1);
      await expect(
        feed.getByRole("link", { name: "The battle" }),
      ).toHaveAttribute("href", "/battle/b2c3d4e5f6a7");
      // A name opens the player page.
      await expect(
        feed.getByRole("link", { name: "Ada", exact: true }),
      ).toHaveAttribute("href", "/home/player/2YG98VVQ");
      await expect(page.getByText("23–14")).toBeVisible();
      await expect(
        page.getByText("Season 137, week 4: 2nd, 84,200 fame"),
      ).toBeVisible();
      await expect(page.locator(".disclaimer__text")).toHaveText(DISCLAIMER);
      await expect(
        page.getByRole("navigation", { name: "Main, phone" }),
      ).toBeVisible({ visible: width === 390 });
      await noSideways(page);
      await accessible(page, "Home");
    });

    test("the chips choose what the feed shows, with their counts", async ({
      page,
    }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      const chips = page.getByRole("group", { name: "Show" });
      const feed = page.locator(".kit-feed");
      await expect(feed.locator(".kit-feed__item")).toHaveCount(3);
      await chips.getByRole("button", { name: /^Friends/ }).click();
      await expect(feed.locator(".kit-feed__item")).toHaveCount(1);
      await expect(feed.getByText("Reached Path of Legends.")).toBeVisible();
      await chips.getByRole("button", { name: /^Clan/ }).click();
      await expect(feed.locator(".kit-feed__item")).toHaveCount(1);
      await expect(
        feed.getByText("Ada's Clan finished 2nd in the river race."),
      ).toBeVisible();
      await chips.getByRole("button", { name: /^You/ }).click();
      await expect(feed.locator(".kit-feed__item")).toHaveCount(1);
      await expect(feed.getByText("Won 3 of 5 in Trophy Road.")).toBeVisible();
      await expect(chips.getByRole("button", { name: /^You/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await chips.getByRole("button", { name: /^Everyone/ }).click();
      await expect(feed.locator(".kit-feed__item")).toHaveCount(3);
      // State stays (structure Q8): New is what came since the last visit.
      const state = page.getByRole("group", { name: "State" });
      await state.getByRole("button", { name: /^New/ }).click();
      await expect(feed.locator(".kit-feed__item")).toHaveCount(1);
      await state.getByRole("button", { name: /^All/ }).click();
      await expect(feed.locator(".kit-feed__item")).toHaveCount(3);
      await noSideways(page);
      await accessible(page, "Home, chips");
    });

    test("the feed: days, the new line, games in place, the cap line", async ({
      page,
    }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      await expect(page.getByText("New since your last visit")).toBeVisible();
      await expect(
        page.getByText(/the 3 newest are shown, and 46 more/),
      ).toBeVisible();
      await page.getByRole("button", { name: "View games" }).click();
      await expect(page.getByText(/^Win, Trophy Road$/)).toBeVisible();
      await noSideways(page);
    });

    test("the bell: lit while something needs you, and the sheet lists it", async ({
      page,
    }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      const bell =
        width === 390
          ? page
              .getByRole("navigation", { name: "Main, phone" })
              .getByRole("button", { name: /Bell/ })
          : page.getByRole("button", {
              name: /^Notifications, \d+ new$/,
            });
      await expect(bell.locator(".kit-bell__dot")).toBeVisible();
      await bell.click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator(".kit-row__title").first()).toContainText(
        "Departure: kicked, left, or ignore? Ada",
      );
      await expect(sheet).toContainText("and 3 more waiting in Clan");
      await accessible(page, "the bell");
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toHaveCount(0);
    });

    test("Home: a failed panel says so and the rest render", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me/home/clan": [200, { clan: { ok: false } }],
          "GET /api/me/home/week": [504, { error: "timeout" }],
        }),
      );
      await page.goto("/home");
      await expect(
        page.getByText("Your clans could not be read just now."),
      ).toBeVisible();
      await expect(
        page.getByText("Your week could not be read just now."),
      ).toBeVisible();
      await expect(page.getByText("Won 3 of 5 in Trophy Road.")).toBeVisible();
      await noSideways(page);
    });

    test("Home: the feed failing is the feed's alone", async ({ page }) => {
      await mockApi(
        page,
        homeApi({ "GET /api/me/timeline": [500, { error: "boom" }] }),
      );
      await page.goto("/home");
      await expect(
        page.getByText("Your feed could not be read just now"),
      ).toBeVisible();
      await expect(page.getByText("23–14")).toBeVisible();
      await expect(
        page.getByText("Season 137, week 4: 2nd, 84,200 fame"),
      ).toBeVisible();
    });

    test("Home: paints before a slow panel, which then fills in alone", async ({
      page,
    }) => {
      // Each panel is held until its turn is released, so nothing here hangs
      // on a clock.
      const held = new Map<string, () => void>();
      await mockApi(page, homeApi());
      const hold = (path: string, body: unknown) =>
        page.route(`**${path}`, async (route) => {
          await new Promise<void>((go) => held.set(path, go));
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
        });
      await hold("/api/me/home/clan", { clan: HOME.clan });
      await hold("/api/me/home/week", { week: HOME.week });
      await page.goto("/home");
      await expect(
        page.locator(".kit-head").getByText("King Thing"),
      ).toBeVisible();
      await expect(page.getByText("Won 3 of 5 in Trophy Road.")).toBeVisible();
      await expect(
        page.locator('.kit-home__side [aria-busy="true"]'),
      ).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect.poll(() => held.size).toBe(2);
      held.get("/api/me/home/clan")!();
      await expect(page.getByText("Ada's Clan").first()).toBeVisible();
      await expect(
        page.locator('.kit-home__side [aria-busy="true"]'),
      ).toHaveCount(1);
      held.get("/api/me/home/week")!();
      await expect(page.getByText("23–14")).toBeVisible();
      await expect(
        page.locator('.kit-home__side [aria-busy="true"]'),
      ).toHaveCount(0);
      await noSideways(page);
    });

    test("Find: search, Follow, the clan directory and your follow link", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "POST /api/claims": [
            200,
            {
              ok: true,
              player_tag: "#QQQQQQQ",
              added: true,
              first_read: true,
              not_found: false,
              relationship: "friend",
            },
          ],
        }),
      );
      await page.goto("/home/find");
      await expect(
        page.getByRole("heading", { level: 1, name: "Find" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Clan directory/ }),
      ).toHaveAttribute("href", "/clan/directory");
      await expect(page.locator(".kit-find__link code")).toContainText(
        "/home/follow/",
      );
      await expect(
        page.getByText("They aren’t told.", { exact: false }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "Find");
      await page.getByLabel("Follow a friend").fill("#QQQQQQQ");
      await page.getByRole("button", { name: "Follow", exact: true }).click();
      await expect(page.getByText("Recording", { exact: true })).toBeVisible();
      // Search opens the sheet every page has.
      await page.locator(".kit-find__search").click();
      await expect(page.getByRole("dialog")).toBeVisible();
    });

    test("You with no verified player: how to verify, Settings and Sign out", async ({
      page,
    }) => {
      // The fixture's claim is not verified (it has no `status`): You says
      // how to verify one (canvas-shell.spec.ts has the verified page).
      await mockApi(page, homeApi());
      await page.goto("/home/you");
      await expect(
        page.getByRole("heading", { level: 1, name: "You" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Settings/ }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Verify a player/ }),
      ).toHaveAttribute("href", "/settings/players/verify");
      await expect(
        page.getByRole("button", { name: /Sign out/ }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "You");
    });

    test("cheers: one of six on a friend's moment, counted, never who", async ({
      page,
    }) => {
      const sent: unknown[] = [];
      await mockApi(
        page,
        homeApi({
          "PUT /api/me/cheers": (route) => {
            sent.push(route.request().postDataJSON());
            return [
              200,
              {
                item_id: "o1",
                cheers: { on_fire: 2, royal: 1 },
                my_cheer: "royal",
              },
            ];
          },
        }),
      );
      await page.goto("/home");
      const item = page
        .locator(".kit-feed__item")
        .filter({ hasText: "Reached Path of Legends." });
      await expect(
        item.getByRole("button", { name: "On fire, 2" }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(item.getByText("2 people")).toBeVisible();
      await item.getByRole("button", { name: "Cheer" }).click();
      const picker = item.getByRole("group", { name: "Choose a cheer" });
      await expect(picker.getByRole("button")).toHaveCount(6);
      await accessible(page, "Home, cheer picker");
      await picker.getByRole("button", { name: /Royal/ }).click();
      await expect(
        item.getByRole("button", { name: "Royal, 1, yours" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(item.getByText("You and 2 others")).toBeVisible();
      expect(sent).toEqual([
        { item_id: "o1", cheer: "royal", subjects: ["#2YG98VVQ"] },
      ]);
      await noSideways(page);
      await accessible(page, "Home, cheered");
    });

    test("Connections: your RSS link, shown once, then reset or turned off", async ({
      page,
    }) => {
      let on = false;
      await mockApi(
        page,
        homeApi({
          "GET /api/me/rss": () => [
            200,
            on
              ? { on: true, created_at: "2026-11-12T15:00:00.000Z" }
              : { on: false, created_at: null },
          ],
          "POST /api/me/rss": () => {
            on = true;
            return [
              200,
              {
                on: true,
                url: "https://elixir.example.test/api/rss/AbCdEfGhIjKlMnOpQrStUvWxYz012345.xml",
                created_at: "2026-11-12T15:00:00.000Z",
              },
            ];
          },
        }),
      );
      await page.goto("/settings/connections");
      const panel = page
        .locator(".panel")
        .filter({ has: page.getByRole("heading", { name: "Your RSS link" }) });
      await expect(
        panel.getByText("Off: no link reads your timeline."),
      ).toBeVisible();
      await panel.getByRole("button", { name: "Make my link" }).click();
      await expect(
        panel.getByText(/AbCdEfGhIjKlMnOpQrStUvWxYz012345\.xml$/),
      ).toBeVisible();
      await expect(panel.getByText(/keeps only a fingerprint/)).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Reset link" }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Turn off" }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "Connections, RSS link");
    });

    test("the tabs: Home, Find, Clan, You and the bell", async ({ page }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      if (width === 390) {
        const tabs = page.getByRole("navigation", { name: "Main, phone" });
        for (const name of ["Home", "Find", "Clan", "You"])
          await expect(tabs.getByRole("link", { name })).toBeVisible();
        await expect(tabs.getByRole("button", { name: /Bell/ })).toBeVisible();
        await tabs.getByRole("link", { name: "Find" }).click();
        await expect(page).toHaveURL(/\/home\/find$/);
        await expect(tabs.getByRole("link", { name: "Find" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        await tabs.getByRole("link", { name: "You" }).click();
        await expect(page).toHaveURL(/\/home\/you$/);
      } else {
        const nav = page.getByRole("navigation", {
          name: "Main",
          exact: true,
        });
        for (const name of ["Home", "Find", "Clan"])
          await expect(
            nav.getByRole("link", { name }).locator("svg"),
          ).toBeVisible();
        // The feed has news (timeline_pending), so Home wears its dot and
        // says so in words; Find does not.
        await expect(
          nav
            .getByRole("link", { name: "Home, new items" })
            .locator(".kit-bell__dot"),
        ).toHaveCount(1);
        await expect(
          nav.getByRole("link", { name: "Find" }).locator(".kit-bell__dot"),
        ).toHaveCount(0);
        // You is the avatar's on a wide screen.
        await expect(nav.getByRole("link", { name: "You" })).toHaveCount(0);
        await nav.getByRole("link", { name: "Find" }).click();
        await expect(page).toHaveURL(/\/home\/find$/);
      }
      await accessible(page, "the tabs");
    });
  });
}

test("Home's old tabs land on the feed, and Friends' follow form on Find", async ({
  page,
}) => {
  await mockApi(page, homeApi());
  await page.goto("/home/timeline");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText("Won 3 of 5 in Trophy Road.")).toBeVisible();
  await page.goto("/home/friends");
  await expect(page).toHaveURL(/\/home\/find$/);
  await expect(page.getByLabel("Follow a friend")).toBeVisible();
});

test("following someone before a player of your own: the steps, then the feed", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [200, { first: { ok: true, player: null } }],
      "GET /api/me": [
        200,
        {
          authenticated: true,
          role: "owner",
          email: "reader@example.test",
          claims: [
            {
              player_tag: "#2YG98VVQ",
              name: "Ada",
              is_primary: false,
              relationship: "friend",
            },
          ],
          recordings: [],
          signals: {},
        },
      ],
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Welcome to Elixir" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your feed" })
      .getByText("Reached Path of Legends."),
  ).toBeVisible();
});

test("a new account gets the steps, not the feed, and reads no panel", async ({
  page,
}) => {
  const panels: string[] = [];
  page.on("request", (req) => {
    if (/\/api\/me\/(home\/(clan|week)|timeline)/.test(req.url()))
      panels.push(req.url());
  });
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [200, { first: { ok: true, player: null } }],
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Welcome to Elixir" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your player tag")).toBeVisible();
  expect(panels).toEqual([]);
});

test("adding your player from Ladder's or Clan's link stays on Home's steps", async ({
  page,
}) => {
  let added = false;
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": () => [
        200,
        {
          first: {
            ok: true,
            player: added
              ? { player_tag: "#2PYQ8GJ0", name: "New Player" }
              : null,
          },
        },
      ],
      "POST /api/claims": () => {
        added = true;
        return [200, { ok: true }];
      },
    }),
  );
  await page.goto("/home#add-player");
  await page.getByLabel("Your player tag").fill("#2PYQ8GJ0");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("your main player.")).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
});

// 2026-11-09, a production walk: the tag added was already on record as an
// opponent (one battle from another player's log). Home drew its panels with
// "Battle log read: never" at once and never read again.
test("a player known as an opponent waits for their own battle log, then Home draws without a reload", async ({
  page,
}) => {
  const stub = {
    ...HOME.first.player,
    verified: false,
    tracked_since: new Date().toISOString(),
    profile_available: false,
    battlelog_observed_at: null,
    last_battle_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    battles_30d: 1,
  };
  let read = false;
  let checks = 0;
  const now = () => ({
    ...stub,
    ...(read
      ? {
          profile_available: true,
          battlelog_observed_at: new Date().toISOString(),
          battles_30d: 6,
        }
      : {}),
  });
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": () => [
        200,
        { first: { ...HOME.first, player: now() } },
      ],
      "GET /api/me/first-answer": () => {
        checks += 1;
        return [
          200,
          { ...HOME.first, as_of: new Date().toISOString(), player: now() },
        ];
      },
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Welcome to Elixir" }),
  ).toBeVisible();
  await expect(
    page.getByText(/usually arrive within a minute; at busy times/).first(),
  ).toBeVisible();
  await expect(page.getByText("Battle log read: never")).toHaveCount(0);
  await expect.poll(() => checks).toBeGreaterThan(0);
  read = true;
  await expect(
    page.getByRole("heading", { level: 1, name: "Home" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^Battle log read /).first()).toBeVisible();
});

test("the head leads with your nickname, as Ladder does", async ({ page }) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [
        200,
        {
          first: {
            ...HOME.first,
            player: { ...HOME.first.player, nickname: "Sam" },
          },
        },
      ],
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-head").getByText("Sam")).toBeVisible();
});

test("signed out, /home is the wall and remembers where it was", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
  await page.goto("/home/find");
  await expect(
    page.getByRole("heading", { name: "Sign in first" }),
  ).toBeVisible();
  await expect(page.locator(".disclaimer__text")).toHaveText(DISCLAIMER);
  expect(
    await page.evaluate(() => sessionStorage.getItem("elixir.after_sign_in")),
  ).toBe("/home/find");
});

test("the old Overview address lands on Home, with no offer to try it", async ({
  page,
}) => {
  await mockApi(page, homeApi());
  await page.goto("/console/account/overview");
  await expect(page).toHaveURL(/\/home$/);
  await expect(
    page.getByRole("link", { name: /Try the new Home/ }),
  ).toHaveCount(0);
});

test("the signed-in bar shows the app's places as tabs, and Help has no stray border", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 844 });
  await mockApi(page, homeApi());
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  for (const name of ["Home", "Find", "Clan"])
    await expect(nav.getByRole("link", { name }).locator("svg")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("button", { name: "Help for this page" }),
  ).toHaveCSS("border-top-width", "0px");
  // Search shares a rule with Help, and keeps the outline Help must not have.
  await expect(page.locator(".kit-top__search")).toHaveCSS(
    "border-top-width",
    "1px",
  );
});
