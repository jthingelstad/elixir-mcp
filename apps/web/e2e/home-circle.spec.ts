import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * Your circle this week and close friends (2026-11-16). Home draws the
 * circle above the feed: a strip of faces with one line of fact each, the
 * friend with no battle said plainly, about one card tall on a phone and
 * never a sideways page. With nobody marked it offers players you follow,
 * one tap each. The feed's Close friends chip shows only them and is kept
 * for the next visit. Invented players only.
 *
 * CIRCLE_SHOTS=<dir> saves the screenshots the change was reviewed with.
 */
const shots = process.env.CIRCLE_SHOTS;
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const WEEK = { from: AGO(10_080), to: AGO(0) };

const MOSS = "#0YRL2GQP";
const QUILL = "#0UVC8J9R";
const TIN = "#0LCVJ8YR";
const FERN = "#0RQYGC2L";
const ASH = "#0GUQ28PV";
const OWL = "#0QYC9U2P";

const CARDS = [
  [26000000, "Knight", 3],
  [26000001, "Archers", 3],
  [26000002, "Goblins", 2],
  [26000003, "Giant", 5],
  [26000004, "P.E.K.K.A", 7],
  [26000005, "Minions", 3],
  [26000006, "Balloon", 5],
  [26000007, "Witch", 5],
].map(([id, name, elixir_cost]) => ({ id, name, form: "base", elixir_cost }));

/** A friend's sitting as the feed keeps it, with its deck's art. */
function sitting(
  id: string,
  tag: string,
  name: string,
  min: number,
  close: boolean,
) {
  return {
    id,
    at: AGO(min),
    observed_at: AGO(min - 1),
    subject_tag: tag,
    subject_name: name,
    subjects: [{ tag, kind: "player", name }],
    text: `${name} won 4 of 6 in Trophy Road.`,
    kind: "battle_session",
    facts: {
      player_tag: tag,
      started_at: AGO(min + 40),
      ended_at: AGO(min),
      battles: 6,
      won: 4,
      lost: 2,
      drawn: 0,
      by_mode: { ladder: 6 },
      trophy_net: 31,
      won_in_a_row: 3,
      decks: [{ label: "Giant beatdown", battles: 6 }],
      events: [],
      open: false,
    },
    deck: { label: "Giant beatdown", cards: CARDS },
    groups: close ? ["friends", "close"] : ["friends"],
    spark: [
      { r: "w", m: 1 },
      { r: "w", m: 3 },
      { r: "l", m: 1 },
      { r: "w", m: 2 },
      { r: "l", m: 1 },
      { r: "w", m: 1 },
    ],
    evidence: { kind: "session", version: "v1" },
  };
}

const ITEMS = [
  sitting("s-moss", MOSS, "Moss Lantern", 25, true),
  sitting("s-ash", ASH, "Ash Wren", 80, false),
  sitting("s-quill", QUILL, "Quill Harbor", 300, true),
  {
    id: "m-moss",
    at: AGO(900),
    observed_at: AGO(899),
    subject_tag: MOSS,
    subject_name: "Moss Lantern",
    subjects: [{ tag: MOSS, kind: "player", name: "Moss Lantern" }],
    text: "Moss Lantern reached Path of Legends.",
    kind: "pol_league",
    facts: {},
    groups: ["friends", "close"],
  },
];

const FEED = {
  window: WEEK,
  seen_to: AGO(120),
  timeline: ITEMS,
  total: ITEMS.length,
  next: null,
  timeline_more: 0,
  counts: {
    everyone: 4,
    close: 3,
    friends: 4,
    clan: 0,
    you: 0,
    new: 2,
    new_since: AGO(120),
  },
};

const FRIENDS = [
  {
    tag: MOSS,
    name: "Moss Lantern",
    battles: 23,
    days: 4,
    last_battle_at: AGO(25),
    sittings: 3,
    session: { id: "s-moss", started_at: AGO(65) },
    moments: [
      { kind: "pol_league", text: "Moss Lantern reached Path of Legends." },
    ],
  },
  {
    tag: QUILL,
    name: "Quill Harbor",
    battles: 6,
    days: 1,
    last_battle_at: AGO(300),
    sittings: 1,
    session: { id: "s-quill", started_at: AGO(340) },
    moments: [],
  },
  {
    tag: FERN,
    name: "Fern Ladder",
    battles: 2,
    days: 2,
    last_battle_at: AGO(2000),
    sittings: null,
    session: null,
    moments: [],
  },
  {
    tag: TIN,
    name: "Tin Heron",
    battles: 0,
    days: 0,
    last_battle_at: null,
    sittings: null,
    session: null,
    moments: [],
  },
];

const circleApi = (circle: unknown, posted: unknown[] = []) =>
  homeApi({
    "GET /api/me/home/feed": [200, FEED],
    "GET /api/me/home/circle": [200, { circle }],
    "POST /api/claims": (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      posted.push(body);
      return [
        200,
        {
          ok: true,
          close: body.action === "close_on",
          tags: [body.player_tag],
        },
      ];
    },
  });

async function noSideways(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
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

async function capture(page: Page, name: string, width: number) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/${name}-${width}.png` });
}

for (const [label, width] of [
  ["@narrow phone", 420],
  ["wide", 1280],
] as const) {
  test(`${label}: before, nobody marked and nobody to offer draws no circle`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, homeApi({ "GET /api/me/home/feed": [200, FEED] }));
    await page.goto("/home");
    await expect(page.locator(".kit-feed")).toBeVisible();
    await expect(page.locator(".kit-circle")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Close friends/ }),
    ).toHaveCount(0);
    await capture(page, "before", width);
  });

  test(`${label}: marked friends sit above the feed, about one card tall`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(
      page,
      circleApi({ ok: true, from: WEEK.from, friends: FRIENDS }),
    );
    await page.goto("/home");
    const circle = page.locator(".kit-circle");
    await expect(circle).toBeVisible();
    const faces = circle.getByRole("list", { name: "Your close friends" });
    await expect(faces.getByRole("listitem")).toHaveText([
      /Moss Lantern\s*23 battles · 4 days/,
      /Quill Harbor\s*6 battles · 1 day/,
      /Fern Ladder\s*2 battles · 2 days/,
      /Tin Heron\s*No battles this week/,
    ]);
    // The newest sitting opens its own page.
    await expect(faces.getByRole("link").first()).toHaveAttribute(
      "href",
      /\/home\/player\/0YRL2GQP\/session\/s-moss/,
    );
    // Above the feed, in the same column, and no taller than a session card.
    const box = (await circle.boundingBox())!;
    const card = (await page
      .locator(".kit-feed .kit-day")
      .first()
      .boundingBox())!;
    expect(box.y).toBeLessThan(card.y);
    expect(box.height).toBeLessThanOrEqual(200);
    await noSideways(page);
    await accessible(page, `circle at ${width}`);
    await capture(page, "circle", width);

    await circle.getByRole("button", { name: "See all" }).click();
    await expect(circle).toContainText("23 battles · 4 days · 3 sessions");
    await expect(circle).toContainText("Moss Lantern reached Path of Legends.");
    await noSideways(page);
    await accessible(page, `circle list at ${width}`);
    await capture(page, "circle-all", width);
  });

  test(`${label}: a quiet week says so plainly`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const quiet = FRIENDS.map((f) => ({
      ...f,
      battles: 0,
      days: 0,
      last_battle_at: null,
      sittings: null,
      session: null,
      moments: [],
    }));
    await mockApi(
      page,
      circleApi({ ok: true, from: WEEK.from, friends: quiet }),
    );
    await page.goto("/home");
    const faces = page.getByRole("list", { name: "Your close friends" });
    await expect(faces.getByRole("listitem")).toHaveCount(4);
    for (const li of await faces.getByRole("listitem").all())
      await expect(li).toContainText("No battles this week");
    await noSideways(page);
    await capture(page, "quiet", width);
  });

  test(`${label}: nobody marked offers players you follow, one tap each`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const posted: unknown[] = [];
    await mockApi(
      page,
      circleApi(
        {
          ok: true,
          from: WEEK.from,
          friends: [],
          suggestions: [
            {
              tag: MOSS,
              name: "Moss Lantern",
              follows_you: true,
              clanmate: true,
            },
            {
              tag: QUILL,
              name: "Quill Harbor",
              follows_you: true,
              clanmate: false,
            },
            { tag: ASH, name: "Ash Wren", follows_you: false, clanmate: true },
            {
              tag: OWL,
              name: "Slate Owl",
              follows_you: false,
              clanmate: false,
            },
          ],
        },
        posted,
      ),
    );
    await page.goto("/home");
    const circle = page.locator(".kit-circle");
    await expect(
      circle.getByRole("heading", { name: "Your circle" }),
    ).toBeVisible();
    await expect(circle).toContainText("Only you see who you star.");
    await expect(circle.getByRole("listitem").first()).toContainText(
      "Follows you · Clanmate",
    );
    await noSideways(page);
    await accessible(page, `circle offer at ${width}`);
    await capture(page, "offer", width);
    await circle
      .getByRole("button", { name: "Mark Ash Wren a close friend" })
      .click();
    await expect
      .poll(() => posted)
      .toEqual([{ action: "close_on", player_tag: ASH }]);
  });

  test(`${label}: the Close friends chip shows only them and is kept`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const seen: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/me/timeline/seen")
        seen.push(r.postData() ?? "");
    });
    await mockApi(
      page,
      circleApi({ ok: true, from: WEEK.from, friends: FRIENDS }),
    );
    await page.goto("/home");
    const chip = page.getByRole("button", { name: /^Close friends/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const feed = page.locator(".kit-feed");
    await expect(feed).toContainText("Moss Lantern");
    await expect(feed).toContainText("Quill Harbor");
    await expect(feed).not.toContainText("Ash Wren");
    await noSideways(page);
    await accessible(page, `close chip at ${width}`);
    await capture(page, "filter", width);
    // Kept for the next visit in this browser.
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^Close friends/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".kit-feed")).not.toContainText("Ash Wren");
    // The place moves as it does under any chip: once per window shown.
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });

  test(`${label}: the close friends notice's address opens on the chip, not kept`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(
      page,
      circleApi({ ok: true, from: WEEK.from, friends: FRIENDS }),
    );
    await page.goto("/timeline?show=close");
    await expect(
      page.getByRole("button", { name: /^Close friends/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".kit-feed")).not.toContainText("Ash Wren");
    await page.goto("/timeline");
    await expect(
      page.getByRole("button", { name: /^Close friends/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });
}
