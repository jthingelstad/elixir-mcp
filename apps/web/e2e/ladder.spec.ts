import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { explore, summary, type ToolCall } from "./ladder-fixture.ts";

/** Nothing serious or critical, on every page a journey lands on. */
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

const ALT = {
  player_tag: "#9PQ2R8L",
  name: "Second Thing",
  is_primary: false,
  relationship: "alt",
  claim_status: "verified",
};
const FRIEND = {
  player_tag: "#8LQ2R9P",
  name: "A Friend",
  is_primary: false,
  relationship: "friend",
  claim_status: "verified",
};

test.describe("Ladder signed out", () => {
  test("/ladder meets the console's sign-in wall, with no rail", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/ladder");
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    await expect(page.locator(".rail")).toHaveCount(0);
    await accessible(page, "ladder sign-in wall");
  });
});

test.describe("Ladder signed in", () => {
  test("the season home: the mode's season, week by week, and the deck played most", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "September season · 24 days in",
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Season - Ladder - Elixir MCP");
    // Times are prose in the account's zone: 10:00Z is 5:00 am Central.
    await expect(page.locator(".page__lede")).toContainText(
      "The season ends Monday, October 5 at 5:00 am.",
    );
    await expect(page.locator(".freshness")).toContainText("battle log read");

    // The bar marks Ladder as the place you are in, not the Console.
    const places = page.getByRole("navigation", { name: "Products" });
    await expect(places.getByRole("link", { name: "Ladder" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      places.getByRole("link", { name: "Console" }),
    ).not.toHaveAttribute("aria-current", "page");

    // The rail: Ladder's own, the player at its head, Season current.
    const rail = page.getByRole("navigation", { name: "Ladder sections" });
    await expect(rail.getByRole("link", { name: "Season" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".ladder-player")).toContainText("King Thing");
    await expect(page.locator(".ladder-player")).toContainText("#20JJJ2CCRU");
    await expect(page.locator(".ladder-rail__note")).toHaveText(
      "A mirror, not a coach: your record, read back.",
    );

    // Opens on Trophy Road: the summary's last 30 days hold no Path of
    // Legends, so the mode played most of the two is Trophy Road.
    const modes = page.getByRole("navigation", { name: "Mode" });
    await expect(
      modes.getByRole("link", { name: "Trophy Road" }),
    ).toHaveAttribute("aria-current", "true");

    const tiles = page.locator(".ladder-tile");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText("35");
    await expect(
      tiles.nth(1).getByRole("img", { name: "12 won, 23 lost" }),
    ).toBeVisible();
    await expect(tiles.nth(2)).toContainText("34%");
    await expect(tiles.nth(3)).toContainText("Trophy range");
    await expect(tiles.nth(3)).toContainText("12,500–12,562");
    await expect(page.locator(".callout--info")).toContainText(
      "You stood on the 12,500 floor (Ultimate Clash Pit) this season. Six losses there cost nothing",
    );

    // Week by week, oldest on the left, the clipped weeks marked.
    const weeks = page.locator(".ladder-week");
    await expect(weeks).toHaveCount(4);
    await expect(weeks.nth(0)).toContainText("Sep 7");
    await expect(weeks.nth(0)).toContainText("partial · −6");
    await expect(weeks.nth(0)).toContainText("40% won");
    await expect(weeks.nth(1)).toContainText("+29");
    await expect(weeks.nth(3)).toContainText("partial · −30");
    await expect(
      page.getByRole("img", { name: "Week of Sep 21: 4 won, 7 lost" }),
    ).toBeVisible();

    // The deck played most, with the kit's card tiles.
    const deck = page.locator(".ladder-deck");
    await expect(deck).toContainText("Royal Hogs bridge spam");
    await expect(deck).toContainText(
      "3.75 average elixir · last played Sep 18",
    );
    await expect(deck.locator(".card-art")).toHaveCount(8);
    await expect(deck.getByRole("img", { name: "Evo Witch" })).toBeVisible();
    await expect(
      deck.getByRole("img", { name: "9 won, 15 lost" }),
    ).toBeVisible();
    await expect(deck).toContainText("38%");
    await expect(deck).toContainText("+0.57");

    // The docs strip names Ladder's own page.
    await expect(
      page.locator(".page__docs").getByRole("link", { name: "Ladder" }),
    ).toHaveAttribute("href", "/docs/ladder");

    // Every read went through the bridge, one mode, the reader's player.
    const perf = calls.filter((c) => c.tool === "battles_performance");
    expect(perf.map((c) => [c.args.mode, c.args.group_by ?? null])).toEqual(
      expect.arrayContaining([
        ["ladder", null],
        ["ladder", "week"],
      ]),
    );
    expect(perf.every((c) => c.args.player_tag === "#20JJJ2CCRU")).toBe(true);
    expect(perf.every((c) => c.args.season === "current")).toBe(true);
    await accessible(page, "ladder season");
  });

  test("a mode is an address, and a mode with no battles says so", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");
    await page
      .getByRole("navigation", { name: "Mode" })
      .getByRole("link", { name: "Path of Legends" })
      .click();
    await expect(page).toHaveURL(/\/ladder\?mode=ranked$/);
    await expect(
      page.getByRole("heading", {
        name: "No Path of Legends battles this season",
      }),
    ).toBeVisible();
    await expect(page.locator(".ladder-tile")).toHaveCount(0);
    expect(
      calls.some(
        (c) => c.tool === "battles_performance" && c.args.mode === "ranked",
      ),
    ).toBe(true);
    await accessible(page, "ladder empty mode");

    // War moves no trophies: its fourth tile is crowns, and its weeks
    // carry no signed numbers.
    await page
      .getByRole("navigation", { name: "Mode" })
      .getByRole("link", { name: "War" })
      .click();
    await expect(page).toHaveURL(/\/ladder\?mode=war$/);
    await expect(page.locator(".ladder-tile").nth(3)).toContainText("Crowns");
    await expect(page.locator(".ladder-tile").nth(3)).toContainText("61–44");
    await expect(page.locator(".callout--info")).toHaveCount(0);
  });

  test("the default mode is Path of Legends when it was played more than Trophy Road", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, {
          players_summary: summary({
            ladder: { battles: 4, wins: 2, losses: 2 },
            ranked: { battles: 40, wins: 22, losses: 18 },
          }),
        }),
      }),
    );
    await page.goto("/ladder");
    await expect(
      page
        .getByRole("navigation", { name: "Mode" })
        .getByRole("link", { name: "Path of Legends" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      page.getByRole("heading", {
        name: "No Path of Legends battles this season",
      }),
    ).toBeVisible();
    // The page waited for the summary: no Trophy Road read was wasted.
    expect(
      calls.filter(
        (c) => c.tool === "battles_performance" && c.args.mode === "ladder",
      ),
    ).toEqual([]);
  });

  test("the player switch lists your players only, and switching is an address", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, { ...ME, claims: [...ME.claims, ALT, FRIEND] }],
        "POST /api/explore": explore(calls),
      }),
    );
    await page.goto("/ladder?mode=war");
    const head = page.locator(".ladder-player__head");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await head.click();
    const list = page.locator("#ladder-players");
    await expect(list.getByRole("link")).toHaveCount(2);
    await expect(list).not.toContainText("A Friend");
    await accessible(page, "ladder player list");
    await list.getByRole("link", { name: /Second Thing/ }).click();
    await expect(page).toHaveURL(/\/ladder\?player=9PQ2R8L&mode=war$/);
    await expect(page.locator(".ladder-player")).toContainText("Second Thing");
    await expect
      .poll(() =>
        calls.some(
          (c) =>
            c.tool === "battles_performance" &&
            c.args.player_tag === "#9PQ2R8L",
        ),
      )
      .toBe(true);
    // The rail keeps whose season and which mode as you move.
    await expect(
      page
        .getByRole("navigation", { name: "Ladder sections" })
        .getByRole("link", { name: "Season" }),
    ).toHaveAttribute("href", "/ladder?player=9PQ2R8L&mode=war");

    // A tag that is not yours reads your primary instead.
    await page.goto("/ladder?player=8LQ2R9P");
    await expect(page.locator(".ladder-player")).toContainText("King Thing");
  });

  test("the season slug and a stale page resolve to the season home", async ({
    page,
  }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/season?mode=war");
    await expect(page).toHaveURL(/\/ladder\?mode=war$/);
    await page.goto("/ladder/not-a-page");
    await expect(page).toHaveURL(/\/ladder$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /September season/ }),
    ).toBeVisible();
  });

  test("with no player of your own, Ladder points at Tracking", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, { ...ME, claims: [FRIEND] }],
        "POST /api/explore": explore(),
      }),
    );
    await page.goto("/ladder");
    await expect(
      page.getByRole("heading", { name: "No player of yours yet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to Tracking" }),
    ).toHaveAttribute("href", "/console/account/tracking");
    await accessible(page, "ladder no players");
  });

  test("@narrow the rail is a disclosure that keeps the player, and nothing scrolls sideways", async ({
    page,
  }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder");
    await expect(
      page.getByRole("heading", { level: 1, name: /September season/ }),
    ).toBeVisible();
    await expect(page.locator(".ladder-player")).toContainText("King Thing");
    const toggle = page.locator(".rail__toggle");
    await expect(toggle).toContainText("Season");
    await expect(
      page.getByRole("navigation", { name: "Ladder sections" }),
    ).toHaveCount(0);
    await toggle.click();
    await expect(
      page.getByRole("navigation", { name: "Ladder sections" }),
    ).toBeVisible();
    await expect(page.locator(".ladder-week")).toHaveCount(4);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await accessible(page, "ladder narrow");
  });
});

test.describe("Ladder days played", () => {
  // Tuesday, September 29, 4:00 pm Central: the board's "today".
  const TODAY = new Date("2026-09-29T21:00:00Z");

  test("the season's days on the account's calendar, each mode its own mark, and the nights", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/days");

    await expect(
      page.getByRole("heading", { level: 1, name: "17 of 23 days played" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Days played - Ladder - Elixir MCP");
    await expect(page.locator(".page__lede")).toContainText(
      "Every day of the September season, Central time.",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Ladder sections" })
        .getByRole("link", { name: "Days played" }),
    ).toHaveAttribute("aria-current", "page");

    const tiles = page.locator(".ladder-tile");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText("17");
    await expect(tiles.nth(0)).toContainText("of 23 so far");
    await expect(tiles.nth(1)).toContainText("Trophy Road days");
    await expect(tiles.nth(1)).toContainText("14");
    await expect(tiles.nth(1)).toContainText("34 battles");
    await expect(
      tiles.nth(1).getByRole("img", { name: "12 won, 22 lost" }),
    ).toBeVisible();
    await expect(tiles.nth(2)).toContainText("War days");
    await expect(
      tiles.nth(2).getByRole("img", { name: "13 won, 12 lost" }),
    ).toBeVisible();
    await expect(tiles.nth(3)).toContainText("2 days");
    await expect(tiles.nth(3)).toContainText("Sep 13 and 14");

    // Monday the 7th to Sunday, October 4, each day its own cell.
    const days = page.locator(".ladder-cal > li:not(.ladder-day--blank)");
    await expect(days).toHaveCount(28);
    const sep10 = days.nth(3);
    await expect(sep10).toContainText("Sep 10");
    await expect(sep10.locator(".ladder-day__n")).toHaveText("4");
    await expect(
      sep10.getByRole("img", { name: "2 won, 1 lost" }),
    ).toBeVisible();
    await expect(sep10.locator(".ladder-day__mode").nth(0)).toContainText(
      "Trophy Road",
    );
    // A boat defense is not the member's battle: the 24th holds its
    // three attacks and nothing more.
    await expect(days.nth(17).locator(".ladder-day__n")).toHaveText("3");
    await expect(days.nth(22)).toHaveAttribute("aria-current", "date");
    await expect(days.nth(22)).toContainText("today · nothing yet");
    await expect(days.nth(23)).toContainText("to come");
    await expect(page.locator(".panel__foot").first()).toContainText(
      "The season runs Monday, September 7 at 5:00 am to Monday, October 5 at 5:00 am.",
    );

    // Nights, newest first: Monday's two events then three on Trophy
    // Road, a record per mode, down to the floor.
    const nights = page.locator(".ladder-night");
    await expect(nights).toHaveCount(5);
    const night = nights.first();
    await expect(night).toContainText("Mon, Sep 28");
    await expect(night).toContainText("10:37 – 11:09 pm");
    await expect(night).toContainText("2 event battles");
    await expect(night).toContainText("then 3 on Trophy Road");
    await expect(night).toContainText("Ended on the 12,500 floor");
    await expect(night).toContainText("12,530 → 12,500");
    await expect(
      night.getByRole("img", { name: "0 won, 3 lost" }),
    ).toBeVisible();
    // Two modes: no one record for the night.
    await expect(night.locator(".ladder-night__record")).toHaveText("");

    const open = night.getByRole("button");
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    const rows = night.locator(".battle-row");
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText("11:09 pm");
    await expect(rows.first()).toContainText("lost 0–1");
    // Links come from the tool's url, never built here.
    await expect(rows.first()).toHaveAttribute(
      "href",
      /^\/battle\/[0-9a-f]{12}$/,
    );
    await accessible(page, "ladder days");

    await page.getByRole("button", { name: "Show all 17 nights" }).click();
    await expect(nights).toHaveCount(17);

    // Every page of the season was read, compact, as the reader's player.
    const reads = calls.filter((c) => c.tool === "battles_query");
    expect(reads.length).toBe(2);
    expect(reads[0]?.args).toMatchObject({
      player_tag: "#20JJJ2CCRU",
      season: "current",
      verbosity: "compact",
      limit: 50,
      include_total: true,
    });
    expect(reads[1]?.args.cursor).toBe("at:50");
  });

  test("a battle without a page is a row, not a link", async ({ page }) => {
    await page.clock.setFixedTime(TODAY);
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/days");
    await page.getByRole("button", { name: "Show all 17 nights" }).click();
    // The fixture's fifty-fifth battle, a war loss on the 26th, has no url.
    const night = page
      .locator(".ladder-night")
      .filter({ hasText: "Sat, Sep 26" });
    await night.getByRole("button").click();
    await expect(night.locator("span.battle-row")).toHaveCount(1);
    await expect(night.locator("a.battle-row")).toHaveCount(3);
  });

  test("@narrow the calendar is a list of the days so far, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/days");
    await expect(
      page.getByRole("heading", { level: 1, name: "17 of 23 days played" }),
    ).toBeVisible();
    await expect(page.locator(".ladder-cal__weekdays")).toBeHidden();
    await expect(page.locator(".ladder-day--future").first()).toBeHidden();
    await expect(
      page.locator(".ladder-day").filter({ hasText: "Sep 10" }),
    ).toContainText("Thu Sep 10");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await accessible(page, "ladder days narrow");
  });
});
