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
