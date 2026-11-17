import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * The Timeline by mode (Jamie, 2026-11-17: "a player should be able to
 * filter the timeline by these same groups: Trophy Road, Ranked, War,
 * Casual"). A Mode list sits beside the Show chips, All modes by default.
 * The server reads the mode (`?mode=` on the feed read), so each page is
 * that mode's; the choice is in the address, so a link and Back keep it,
 * and it is kept in this browser like the Show chip. A mode with nothing in
 * it says so and offers All modes. Invented players only.
 *
 * MODES_SHOTS=<dir> saves the screenshots the change was reviewed with.
 */
const shots = process.env.MODES_SHOTS;
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const WEEK = { from: AGO(10_080), to: AGO(0) };

const MOSS = "#0YRL2GQP";
const QUILL = "#0UVC8J9R";
const ASH = "#0GUQ28PV";
const TIN = "#0LCVJ8YR";

const WORD = {
  ladder: "Trophy Road",
  ranked: "Ranked",
  war: "War",
  casual: "Casual",
} as const;
type Mode = keyof typeof WORD;

function sitting(
  id: string,
  tag: string,
  name: string,
  min: number,
  mode: Mode,
  groups: string[],
) {
  return {
    id,
    at: AGO(min),
    observed_at: AGO(min - 1),
    subject_tag: tag,
    subject_name: name,
    subjects: [{ tag, kind: "player", name }],
    text: `${name} won 3 of 5 in ${WORD[mode]}.`,
    kind: "battle_session",
    facts: {
      player_tag: tag,
      started_at: AGO(min + 30),
      ended_at: AGO(min),
      battles: 5,
      won: 3,
      lost: 2,
      drawn: 0,
      by_mode: { [mode]: 5 },
      events: [],
      open: false,
    },
    groups,
    modes: [mode],
  };
}

const ITEMS = [
  sitting("s-moss", MOSS, "Moss Lantern", 20, "ladder", ["friends"]),
  sitting("s-quill", QUILL, "Quill Harbor", 60, "ranked", ["friends"]),
  sitting("s-ash", ASH, "Ash Wren", 120, "ranked", ["clan"]),
  sitting("s-tin", TIN, "Tin Heron", 240, "casual", ["friends", "clan"]),
];

const count = (items: typeof ITEMS, g: string) =>
  items.filter((it) => it.groups.includes(g)).length;

/** The feed read as the server answers it: the week filtered by `mode`
 *  before the page is cut, with the whole week's size beside it. */
function feed(asked: string[]) {
  return (route: { request(): { url(): string } }) => {
    const mode = new URL(route.request().url()).searchParams.get("mode");
    asked.push(mode ?? "all");
    const items = mode
      ? ITEMS.filter((it) => it.modes.includes(mode as Mode))
      : ITEMS;
    return [
      200,
      {
        window: WEEK,
        seen_to: AGO(1),
        timeline: items.map(({ modes: _m, ...it }) => it),
        total: items.length,
        next: null,
        timeline_more: 0,
        mode,
        ...(mode ? { week_total: ITEMS.length } : {}),
        counts: {
          everyone: items.length,
          close: 0,
          friends: count(items, "friends"),
          clan: count(items, "clan"),
          you: 0,
          new: 0,
          new_since: AGO(1),
        },
      },
    ] as [number, unknown];
  };
}

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
  ["@narrow 320", 320],
  ["@narrow 390", 390],
  ["wide", 1280],
] as const) {
  test(`${label}: All modes by default; a mode is asked of the server and kept in the address`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const asked: string[] = [];
    await mockApi(page, homeApi({ "GET /api/me/home/feed": feed(asked) }));
    await page.goto("/timeline");
    const list = page.getByRole("combobox", { name: "Mode" });
    await expect(list).toHaveValue("all");
    const feedEl = page.locator(".kit-feed");
    await expect(feedEl).toContainText("Moss Lantern");
    await expect(feedEl).toContainText("Tin Heron");
    // A 44 px target, and a different control from the Show chips.
    expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("group", { name: "Show" })).toBeVisible();
    await noSideways(page);
    await accessible(page, `all modes at ${width}`);
    await capture(page, "all", width);

    for (const mode of ["ladder", "ranked", "war", "casual"] as const) {
      await list.selectOption(mode);
      await expect(page).toHaveURL(new RegExp(`[?&]mode=${mode}`));
      await expect.poll(() => asked.at(-1)).toBe(mode);
      await noSideways(page);
      await capture(page, mode, width);
    }
    // Ranked holds Quill and Ash only.
    await list.selectOption("ranked");
    await expect(feedEl).toContainText("Quill Harbor");
    await expect(feedEl).toContainText("Ash Wren");
    await expect(feedEl).not.toContainText("Moss Lantern");
    await accessible(page, `ranked at ${width}`);

    // Back walks the choices; the list follows the address.
    await page.goBack();
    await expect(list).toHaveValue("casual");
    await expect(page.locator(".kit-feed")).toContainText("Tin Heron");
    await page.goForward();
    await expect(list).toHaveValue("ranked");

    await list.selectOption("all");
    await expect(page).not.toHaveURL(/mode=/);
    await expect(page.locator(".kit-feed")).toContainText("Moss Lantern");
  });

  test(`${label}: a mode and a Show chip combine`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, homeApi({ "GET /api/me/home/feed": feed([]) }));
    await page.goto("/timeline?mode=ranked");
    await expect(page.getByRole("combobox", { name: "Mode" })).toHaveValue(
      "ranked",
    );
    const friends = page.getByRole("button", { name: /^Friends/ });
    await friends.click();
    await expect(friends).toHaveAttribute("aria-pressed", "true");
    const feedEl = page.locator(".kit-feed");
    await expect(feedEl).toContainText("Quill Harbor");
    await expect(feedEl).not.toContainText("Ash Wren");
    await expect(feedEl).not.toContainText("Moss Lantern");
    await noSideways(page);
    await accessible(page, `ranked and friends at ${width}`);
    await capture(page, "ranked-friends", width);
  });

  test(`${label}: a mode with nothing this week says so and offers All modes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, homeApi({ "GET /api/me/home/feed": feed([]) }));
    await page.goto("/timeline?mode=war");
    await expect(
      page.getByText("Nothing in War in the last seven days."),
    ).toBeVisible();
    await expect(page.getByText("Find your people")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Mode" })).toHaveValue(
      "war",
    );
    await noSideways(page);
    await accessible(page, `empty war at ${width}`);
    await capture(page, "empty-war", width);
    await page.getByRole("button", { name: "Show all modes" }).click();
    await expect(page).not.toHaveURL(/mode=/);
    await expect(page.locator(".kit-feed")).toContainText("Moss Lantern");
  });
}

test("the mode is kept in this browser and comes back on a bare /timeline", async ({
  page,
}) => {
  const asked: string[] = [];
  await mockApi(page, homeApi({ "GET /api/me/home/feed": feed(asked) }));
  await page.goto("/timeline");
  await page.getByRole("combobox", { name: "Mode" }).selectOption("casual");
  await expect(page).toHaveURL(/mode=casual/);
  await page.goto("/timeline");
  await expect(page).toHaveURL(/mode=casual/);
  await expect(page.getByRole("combobox", { name: "Mode" })).toHaveValue(
    "casual",
  );
  await expect(page.locator(".kit-feed")).toContainText("Tin Heron");
  await expect(page.locator(".kit-feed")).not.toContainText("Moss Lantern");
  expect(asked.at(-1)).toBe("casual");
});
