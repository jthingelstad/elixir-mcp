import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { HOME, homeApi, ownerPassport } from "./home-fixture.ts";

/**
 * Home's profile list (#1015): "Your profile, N of 6 done" above the feed,
 * its next step on top with the Stamp it earns, the six folded under it,
 * the map's Not now, the follow step's catching-up line, and an older
 * account's remaining steps with Hide. The passport catch-up runs after
 * the first paint and never holds the page. Invented players only.
 */
const withList = (
  passport: unknown,
  more: Parameters<typeof homeApi>[0] = {},
  week: Record<string, unknown> = {},
) =>
  homeApi({
    "GET /api/me/home": [
      200,
      {
        first: {
          ...HOME.first,
          setup: { following: 1, digest: null },
          starter_hidden_until: null,
        },
      },
    ],
    "GET /api/me/home/week": [200, { week: { ...HOME.week, ...week } }],
    "GET /api/me/passport": [200, passport],
    "POST /api/me/passport/reconcile": [
      200,
      { ...(passport as object), granted: [], more: false },
    ],
    ...more,
  });

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const [label, width] of [
  ["small phone", 320],
  ["phone", 390],
  ["desktop", 1280],
] as const) {
  test(`${label}: a new account's Home opens with its next step, above the feed`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(
      page,
      withList(ownerPassport(["done", "todo", "todo", "todo", "todo", "todo"])),
    );
    await page.goto("/home");
    const list = page.locator(".kit-profile");
    await expect(
      list.getByRole("heading", { name: "Your profile, 1 of 6 done" }),
    ).toBeVisible();
    await expect(list).toContainText("Finish all six for the All Set Stamp.");
    const next = list.locator(".kit-profile__next");
    await expect(next.getByRole("heading", { level: 3 })).toHaveText(
      "Verify it’s you",
    );
    await expect(next).toContainText("Stamp: Player verified");
    await expect(
      next.getByRole("link", { name: "Verify King Thing" }),
    ).toHaveAttribute("href", "/settings/players/verify");
    // Folded: the six open under their summary, in order.
    await list.getByText("See all steps").click();
    await expect(list.locator(".kit-profile__row h3")).toHaveText([
      /^Add your player/,
      /^Verify it’s you/,
      /^Pick your picture/,
      /^Follow someone who plays/,
      /^Choose your email/,
      /^Your place on the clan map/,
    ]);
    await expect(list).toContainText("King Thing, your main player.");
    await expect(
      list.getByRole("link", { name: "Find people to follow" }),
    ).toHaveAttribute("href", "/home/find");
    await expect(
      list.getByRole("link", { name: "Connect Discord" }),
    ).toBeVisible();
    const box = await list.boundingBox();
    const feed = await page.locator(".kit-feed").boundingBox();
    expect(box!.y).toBeLessThan(feed!.y);
    await noSideways(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
  });
}

test("the follow step says when Elixir is still catching up, never a quiet week", async ({
  page,
}) => {
  await mockApi(
    page,
    withList(
      ownerPassport(["done", "done", "done", "unknown", "done", "done"], {
        follows: { following: 2, active: 0, unknown: 2 },
      }),
    ),
  );
  await page.goto("/home");
  const next = page.locator(".kit-profile__next");
  await expect(next).toContainText(
    "Elixir is still catching up on their battles.",
  );
  await expect(next).not.toContainText("hasn’t played");
});

test("the map's Not now finishes the step without the Stamp", async ({
  page,
}) => {
  const done = ownerPassport(["done", "done", "done", "todo", "done", "done"]);
  let posted: unknown = null;
  // Stateful, as the server is: a read after the write sees it.
  let now = ownerPassport(["done", "done", "done", "todo", "done", "todo"]);
  await mockApi(
    page,
    withList(now, {
      "GET /api/me/passport": () => [200, now],
      "POST /api/me/passport/map": (route) => {
        posted = route.request().postDataJSON();
        now = done;
        return [200, { ...done, granted: [], more: false }];
      },
    }),
  );
  await page.goto("/home");
  const list = page.locator(".kit-profile");
  // The map is not the next step here: its Not now is in the folded row.
  await expect(list.locator(".kit-profile__next")).toHaveAttribute(
    "data-step",
    "follow_active",
  );
  await list.getByText("See all steps").click();
  await list.getByRole("button", { name: "Not now" }).click();
  await expect(
    list.getByRole("heading", { name: "Your profile, 5 of 6 done" }),
  ).toBeVisible();
  expect(posted).toEqual({ choice: "not_now" });
  await expect(list.getByRole("button", { name: "Not now" })).toHaveCount(0);
});

for (const [label, width] of [
  ["small phone", 320],
  ["phone", 390],
  ["desktop", 1280],
] as const) {
  test(`${label}: the map step sets the place on Home, with no clan page`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const saved: unknown[] = [];
    let place: unknown = null;
    let now = ownerPassport(["done", "done", "done", "done", "done", "todo"]);
    await mockApi(
      page,
      withList(now, {
        "GET /api/me/passport": () => [200, now],
        "GET /api/clan/me/place": () => [200, { place }],
        "PUT /api/clan/me/place": (route) => {
          saved.push(route.request().postDataJSON());
          place = {
            country: "CA",
            country_name: "Canada",
            region: "08",
            region_name: "Ontario",
            city: null,
            city_name: null,
            precision: "region",
          };
          // The server's hook latches the step once the save succeeds.
          now = ownerPassport(
            ["done", "done", "done", "done", "done", "done"],
            { complete: true },
          );
          return [200, { place }];
        },
      }),
    );
    await page.goto("/home");
    const next = page.locator(".kit-profile__next");
    await expect(next).toHaveAttribute("data-step", "map");
    await expect(next.locator("a[href*='/clan']")).toHaveCount(0);
    const open = next.getByRole("button", { name: "Set a place" });
    await expect(open).toBeVisible();
    await open.click();
    const country = next.getByLabel("Country");
    await expect(country).toBeFocused();
    await expect(country.locator("option")).not.toHaveCount(1);
    await expect(next).toContainText(
      "Who sees it: your clan’s verified members, on the clan map, when its leaders have the map on.",
    );
    await country.selectOption("CA");
    await next.getByLabel("State or region").selectOption("08");
    await expect(next.getByLabel(/City/)).toBeVisible();
    await noSideways(page);
    for (const target of await next.locator("select, button").all()) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
    if (process.env.PLACE_SHOTS)
      await page.screenshot({
        path: `${process.env.PLACE_SHOTS}/home-map-step-${width}.png`,
        fullPage: false,
      });
    await next.getByRole("button", { name: "Add me" }).click();
    await expect(page.getByText("Your profile is done")).toBeVisible();
    expect(saved).toEqual([{ country: "CA", region: "08", city: null }]);
  });
}

test("the map step: Cancel and Escape close the picker and return focus", async ({
  page,
}) => {
  await mockApi(
    page,
    withList(ownerPassport(["done", "done", "done", "done", "done", "todo"]), {
      "GET /api/clan/me/place": [200, { place: null }],
    }),
  );
  await page.goto("/home");
  const next = page.locator(".kit-profile__next");
  await next.getByRole("button", { name: "Set a place" }).click();
  await expect(next.getByLabel("Country")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(next.getByRole("button", { name: "Set a place" })).toBeFocused();
  await next.getByRole("button", { name: "Set a place" }).click();
  await next.getByRole("button", { name: "Cancel" }).click();
  await expect(next.getByRole("button", { name: "Set a place" })).toBeFocused();
});

test("before a verified player, the map step waits on verifying", async ({
  page,
}) => {
  await mockApi(
    page,
    withList(ownerPassport(["done", "todo", "done", "done", "done", "todo"]), {
      "GET /api/clan/me/place": [403, { error: "gate", reason: "unverified" }],
    }),
  );
  await page.goto("/home");
  const list = page.locator(".kit-profile");
  await list.getByText("See all steps").click();
  const row = list.locator(".kit-profile__row").last();
  await expect(row).toContainText(
    "First verify your player. A place belongs to a verified player.",
  );
  await expect(
    row.getByRole("link", { name: "Verify your player first" }),
  ).toHaveAttribute("href", "/settings/players/verify");
  await expect(row.getByRole("button", { name: "Set a place" })).toHaveCount(0);
});

test("after the older welcome: only what is left, and Hide puts it away", async ({
  page,
}) => {
  let hidden = 0;
  const left = ownerPassport(["done", "done", "todo", "done", "done", "todo"], {
    older_welcome_finished: true,
  });
  // Stateful, as the server is: a read after the write sees it.
  let now = left;
  await mockApi(
    page,
    withList(left, {
      "GET /api/me/passport": () => [200, now],
      "POST /api/me/passport/dismiss": () => {
        hidden += 1;
        now = ownerPassport(["done", "done", "todo", "done", "done", "todo"], {
          older_welcome_finished: true,
          dismissed_at: new Date().toISOString(),
        });
        return [200, now];
      },
    }),
  );
  await page.goto("/home");
  const list = page.locator(".kit-profile");
  await expect(list).toContainText(
    "You finished your welcome. Here’s what’s left for the All Set Stamp.",
  );
  await list.getByText("See what’s left").click();
  await expect(list.locator(".kit-profile__row")).toHaveCount(2);
  await list.getByRole("button", { name: "Hide your profile list" }).click();
  await expect(list).toHaveCount(0);
  expect(hidden).toBe(1);
});

test("a finished list is gone for good, and a failed passport read shows nothing", async ({
  page,
}) => {
  await mockApi(
    page,
    withList(
      ownerPassport(["done", "done", "done", "done", "done", "done"], {
        complete: true,
        completed_at: "2026-11-10T12:00:00Z",
      }),
    ),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed .kit-feed__item").first()).toBeVisible();
  await expect(page.locator(".kit-profile")).toHaveCount(0);
  await mockApi(
    page,
    withList(null, {
      "GET /api/me/passport": [500, { error: "internal" }],
      "POST /api/me/passport/reconcile": [500, { error: "internal" }],
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed .kit-feed__item").first()).toBeVisible();
  await expect(page.locator(".kit-profile")).toHaveCount(0);
});

test("the catch-up never holds the first paint, and repeats while more", async ({
  page,
}) => {
  let calls = 0;
  const open = ownerPassport(["done", "done", "todo", "todo", "done", "todo"]);
  await mockApi(
    page,
    withList(open, {
      "POST /api/me/passport/reconcile": () => {
        calls += 1;
        return [200, { ...open, granted: [], more: calls < 2 }];
      },
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed .kit-feed__item").first()).toBeVisible();
  await expect.poll(() => calls).toBe(2);
});

test("your week counts the cheers others gave since Monday (G4)", async ({
  page,
}) => {
  await mockApi(
    page,
    withList(
      ownerPassport(["done", "done", "done", "done", "done", "done"], {
        complete: true,
      }),
      {},
      { cheers: 4 },
    ),
  );
  await page.goto("/home");
  const week = page.locator(".kit-week");
  await expect(week.getByText("Cheers", { exact: true })).toBeVisible();
  await expect(week).toContainText("from others on your items since Monday");
  await expect(week.locator(".kit-stats")).toContainText("4");
});
