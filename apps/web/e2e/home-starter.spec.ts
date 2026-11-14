import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { HOME, homeApi } from "./home-fixture.ts";

/**
 * Home's suggested follows (2026-11-13), the first thing a person who
 * follows few players sees: on every visit, not only the first (Jamie:
 * "the suggested follows is CRITICAL for first user experience"). A
 * phone's first screen holds Follow these and at least three rows with
 * their reasons; every row is ticked, untick anyone, then one confirmed
 * follow; "Not now" puts it aside; with nobody to suggest, one line
 * points to Find. Invented players only.
 */
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const HOSTILE = "<img src=x onerror=alert(1)>Fern";

const PEOPLE = [
  {
    tag: "#00JRG2RU",
    name: "Amber",
    why: [{ kind: "clan", clan_name: "Grove", recorded: true }],
    free: true,
    reason: "comprehensive_clan",
  },
  {
    tag: "#0YP8U0Y0",
    name: HOSTILE,
    why: [
      {
        kind: "battles",
        against: 1,
        with_you: 0,
        friendly: 1,
        clanmate_battles: 0,
        days: 30,
      },
    ],
    free: false,
    reason: null,
  },
  {
    tag: "#080J2V9Q",
    name: "Elm",
    why: [
      {
        kind: "battles",
        against: 0,
        with_you: 2,
        friendly: 0,
        clanmate_battles: 0,
        days: 30,
      },
    ],
    free: false,
    reason: null,
  },
  ...["#02G2PJC0", "#08VP8VYY", "#0J9YCYL2", "#09VURCVC", "#0VJLCPJ0"].map(
    (tag, i) => ({
      tag,
      name: `Invented Clanmate ${i + 1}`,
      why: [{ kind: "clan", clan_name: "Grove", last_battle: AGO(30 + i) }],
      free: false,
      reason: null,
    }),
  ),
];

const offer = (people = PEOPLE) => ({
  ok: true,
  offer: true,
  people,
  used: 1,
  limit: 50,
  slots_cap: 10,
});

const home = (
  welcome: Record<string, unknown>,
  starter: unknown,
  more: Parameters<typeof homeApi>[0] = {},
) =>
  homeApi({
    "GET /api/me/home": [
      200,
      { first: { ...HOME.first, welcome, starter_hidden_until: null } },
    ],
    "GET /api/me/people/starter": [200, starter],
    ...more,
  });

const NEW = { following: 0, digest: null, finished_at: null };

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const [label, width, height] of [
  ["phone", 390, 844],
  ["small phone", 375, 667],
  ["desktop", 1180, 844],
] as const) {
  test(`${label}: the first screen holds Follow these and three rows with their reasons`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await mockApi(page, home(NEW, offer()));
    await page.goto("/home");
    const set = page.locator(".kit-starter");
    await expect(
      set.getByRole("heading", { name: "People you know" }),
    ).toBeVisible();
    const go = set.getByRole("button", { name: "Follow these (8)" });
    await expect(go).toBeVisible();
    // Above the welcome steps and the feed.
    const top = await set.boundingBox();
    const welcome = await page.locator(".kit-welcome").boundingBox();
    expect(top!.y).toBeLessThan(welcome!.y);
    // Without scrolling: the button and the first three rows, reasons and
    // all, end inside the first screen.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The first screen ends at the phone's bottom tabs, which cover the page.
    const tabs = page.locator("nav.kit-bottom");
    const floor = (await tabs.isVisible())
      ? (await tabs.boundingBox())!.y
      : height;
    const inView = async (box: { y: number; height: number } | null) =>
      expect(box!.y + box!.height).toBeLessThanOrEqual(floor);
    await inView(await go.boundingBox());
    const rows = set.locator(".kit-starter__row");
    await expect(rows).toHaveCount(5);
    for (let i = 0; i < 3; i++) {
      await inView(await rows.nth(i).boundingBox());
      await expect(rows.nth(i).locator(".kit-people__why")).not.toBeEmpty();
    }
    await expect(rows.nth(0)).toContainText("In your clan, already in Elixir");
    await expect(rows.nth(1)).toContainText(
      "You played a friendly battle in the last 30 days",
    );
    await expect(rows.nth(2)).toContainText(
      "Your 2v2 teammate twice in the last 30 days",
    );
    await expect(rows.nth(3)).toContainText("In your clan, played today");
    await noSideways(page);
    if (label !== "desktop")
      await page.screenshot({
        path: test.info().outputPath(`home-starter-${width}.png`),
      });
    const results = await new AxeBuilder({ page })
      .include(".kit-starter")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
  });
}

test("a hostile name is text; untick, then one confirmed follow of the ticked", async ({
  page,
}) => {
  const posted: unknown[] = [];
  await mockApi(
    page,
    home(NEW, offer(), {
      "POST /api/me/follow-all": (route) => {
        posted.push(route.request().postDataJSON());
        return [200, { ok: true, followed: 6 }];
      },
    }),
  );
  await page.goto("/home");
  const set = page.locator(".kit-starter");
  await expect(set.getByText(HOSTILE)).toBeVisible();
  await expect(set.locator("img[src=x]")).toHaveCount(0);
  // Every row ticked; untick two.
  await set.getByRole("checkbox", { name: "Follow Elm" }).uncheck();
  await set
    .getByRole("checkbox", { name: "Follow Invented Clanmate 1" })
    .uncheck();
  await expect(set.getByRole("status")).toContainText(
    "6 players · uses 5 of your 50 follows",
  );
  expect(posted).toEqual([]);
  await set.getByRole("button", { name: "Follow these (6)" }).click();
  const dialog = page.getByRole("dialog", { name: "Follow 6 players?" });
  await expect(dialog).toBeVisible();
  expect(posted).toEqual([]);
  await dialog.getByRole("button", { name: "Follow these" }).click();
  await expect(dialog).toBeHidden();
  expect(posted).toEqual([
    {
      player_tags: PEOPLE.map((p) => p.tag).filter(
        (t) => t !== "#080J2V9Q" && t !== "#02G2PJC0",
      ),
    },
  ]);
});

test("offered to an account following few after its welcome is done, and Not now puts it aside", async ({
  page,
}) => {
  let hidden = 0;
  await mockApi(
    page,
    home(
      {
        following: 3,
        digest: { chosen_at: AGO(600), enabled: true, cadence: "weekly" },
        finished_at: AGO(500),
      },
      offer(),
      {
        "POST /api/me/people/starter/hide": () => {
          hidden += 1;
          return [200, { hidden_at: AGO(0) }];
        },
      },
    ),
  );
  await page.goto("/home");
  const set = page.locator(".kit-starter");
  await expect(set).toBeVisible();
  await expect(page.locator(".kit-welcome")).toHaveCount(0);
  await set.getByRole("button", { name: "Not now" }).click();
  await expect(set).toHaveCount(0);
  expect(hidden).toBe(1);
});

test("following five, or put aside: no list, and no read for it", async ({
  page,
}) => {
  let reads = 0;
  const count = () => {
    reads += 1;
    return [200, offer()] as [number, unknown];
  };
  await mockApi(
    page,
    home({ following: 5, digest: null, finished_at: null }, offer(), {
      "GET /api/me/people/starter": count,
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed")).toBeVisible();
  await expect(page.locator(".kit-starter")).toHaveCount(0);
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [
        200,
        {
          first: {
            ...HOME.first,
            welcome: NEW,
            starter_hidden_until: new Date(
              Date.now() + 10 * 86_400_000,
            ).toISOString(),
          },
        },
      ],
      "GET /api/me/people/starter": count,
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed")).toBeVisible();
  await expect(page.locator(".kit-starter")).toHaveCount(0);
  expect(reads).toBe(0);
});

test("nobody to suggest: one line pointing to Find, never an empty box", async ({
  page,
}) => {
  await mockApi(page, home(NEW, offer([])));
  await page.goto("/home");
  const set = page.locator(".kit-starter");
  await expect(set).toContainText("Nobody to suggest yet");
  await expect(
    set.getByRole("link", {
      name: "Search by name or tag, or send your Follow me link",
    }),
  ).toHaveAttribute("href", "/home/find");
  await expect(set.locator(".kit-starter__row")).toHaveCount(0);
  await expect(set.getByRole("button", { name: /Follow these/ })).toHaveCount(
    0,
  );
});
