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
  for (const mode of ["war", "event"]) {
    test(`a browser-only ${mode} player opens on their recorded mode`, async ({
      page,
    }) => {
      const calls: ToolCall[] = [];
      await mockApi(
        page,
        signedIn({
          "POST /api/explore": explore(calls, {
            players_summary: summary({
              [mode]: { battles: 12, wins: 7, losses: 5 },
            }),
          }),
        }),
      );
      await page.goto("/ladder");
      await expect(
        page.getByRole("navigation", { name: "Mode" }).getByRole("link", {
          name: mode === "war" ? "War" : "Events",
          exact: true,
        }),
      ).toHaveAttribute("aria-current", "true");
      await expect
        .poll(() =>
          calls.some(
            (c) => c.tool === "battles_performance" && c.args.mode === mode,
          ),
        )
        .toBe(true);
      expect(
        calls.filter(
          (c) => c.tool === "battles_performance" && c.args.mode === "ladder",
        ),
      ).toEqual([]);
      await accessible(page, `${mode} first record`);
    });
  }
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
    await expect(page).toHaveTitle("Season - Ladder - Elixir");
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

    // Trophy Road and War tie in this summary; the tab order breaks ties.
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
      page.getByRole("heading", {
        level: 1,
        name: "17 days with recorded battles",
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Days played - Ladder - Elixir");
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
    await expect(tiles.nth(0)).toContainText("in 23 season days so far");
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
    await expect(tiles.nth(3)).toContainText("Unknown");
    await expect(tiles.nth(3)).toContainText("No fully covered quiet days");

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
    await expect(days.nth(22)).toContainText("today · capture incomplete");
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
      limit: 40,
      include_total: true,
    });
    expect(reads[1]?.args.cursor).toBe("at:40");
  });

  test("a page over the result cap is read again at the limit the refusal names", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({ "POST /api/explore": explore(calls, { fits: 23 }) }),
    );
    await page.goto("/ladder/days");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "17 days with recorded battles",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show all 17 nights" }).click();
    await expect(page.locator(".ladder-night")).toHaveCount(17);

    // One refusal, then the season from the top at the limit that fits.
    const reads = calls.filter((c) => c.tool === "battles_query");
    expect(reads.map((c) => [c.args.limit, c.args.cursor ?? null])).toEqual([
      [40, null],
      [23, null],
      [23, "at:23"],
      [23, "at:46"],
    ]);
    expect(reads[1]?.args.include_total).toBe(true);
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
      page.getByRole("heading", {
        level: 1,
        name: "17 days with recorded battles",
      }),
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

test.describe("Ladder decks", () => {
  test("every deck in the mode it was played in: the trophy decks with their cards, a swap of forms, the rest in one table", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/decks");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Seven decks, three modes",
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Decks - Ladder - Elixir");
    await expect(
      page
        .getByRole("navigation", { name: "Ladder sections" })
        .getByRole("link", { name: "Decks" }),
    ).toHaveAttribute("aria-current", "page");

    // Trophy Road: the mode's season record in the heading, then each
    // deck with its eight cards and its own record there.
    const road = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Trophy Road/ }) });
    await expect(road.getByRole("heading")).toContainText(
      "Trophy Road · 35 battles",
    );
    await expect(
      road.getByRole("heading").getByRole("img", { name: "12 won, 23 lost" }),
    ).toBeVisible();
    const decks = road.locator(".ladder-deckrow");
    await expect(decks).toHaveCount(2);
    const first = decks.nth(0);
    await expect(first).toContainText("Royal Hogs bridge spam");
    await expect(first).toContainText(
      "Evo Witch, Hero Mini P.E.K.K.A, Evo Royal Ghost",
    );
    // Days in the account's zone: the last battle, 04:01Z on the 19th,
    // was the 18th in Chicago.
    await expect(first).toContainText("Sep 8 – Sep 18 · 3.75 average elixir");
    await expect(first.locator(".card-art")).toHaveCount(8);
    await expect(first.getByRole("img", { name: "Evo Witch" })).toBeVisible();
    await expect(first).toContainText("20 battles");
    await expect(
      first.getByRole("img", { name: "8 won, 12 lost" }),
    ).toBeVisible();
    await expect(first).toContainText("40%");
    await expect(first).toContainText("your cards 0.60 levels above theirs");
    // The second deck's Trophy Road record is its own: its two event
    // battles are not in it.
    await expect(
      decks.nth(1).getByRole("img", { name: "4 won, 11 lost" }),
    ).toBeVisible();

    // The two Trophy Road decks are the same eight cards with the
    // evolutions moved, one put down before the other was picked up.
    const swap = page.locator(".ladder-swap");
    await expect(swap.getByRole("heading")).toHaveText(
      "The evolution swap on September 20",
    );
    await expect(swap).toContainText("Trophy Road only");
    const sides = swap.locator(".ladder-swap__side");
    await expect(sides.nth(0)).toContainText("Before, Sep 8 – Sep 18");
    await expect(sides.nth(0)).toContainText(
      "Evolutions on Witch and Royal Ghost",
    );
    await expect(sides.nth(0).locator(".card-art")).toHaveCount(2);
    await expect(sides.nth(1)).toContainText("After, Sep 20 on");
    await expect(sides.nth(1)).toContainText(
      "Evolutions moved to Royal Hogs and Cannon",
    );
    await expect(
      sides.nth(1).getByRole("img", { name: "Evo Cannon" }),
    ).toBeVisible();
    await expect(sides.nth(2).locator(".card-art")).toHaveCount(4);
    await expect(swap).toContainText("it does not say the change caused it");
    // No card on the page is a link.
    await expect(page.locator("a.card-art")).toHaveCount(0);

    // Every other mode: one row per deck per mode, then the duel rounds.
    const table = page.locator(".ladder-table");
    await expect(
      page.getByRole("heading", { name: "War, duels and events" }),
    ).toBeVisible();
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(0)).toContainText("Evo Mortar siege");
    await expect(rows.nth(0)).toContainText("War");
    await expect(rows.nth(0)).toContainText(
      "Evo Mortar, Evo Giant Snowball · your cards 1.75 levels above theirs",
    );
    await expect(
      rows.nth(0).getByRole("img", { name: "5 won, 4 lost" }),
    ).toBeVisible();
    const duel = rows.filter({ hasText: "Evo Skeleton Barrel bait" });
    await expect(duel).toContainText("War duel");
    await expect(duel).toContainText("duel rounds");
    await expect(
      duel.getByRole("img", { name: "3 won, 7 lost" }),
    ).toBeVisible();
    const event = rows.filter({ hasText: "Event" }).first();
    await expect(event).toContainText("Evo Royal Hogs bridge spam");
    await expect(
      event.getByRole("img", { name: "0 won, 2 lost" }),
    ).toBeVisible();
    await accessible(page, "ladder decks");

    // One read over every mode, one per mode, one per Trophy Road deck
    // for its cards; no war deck was read for cards.
    const reads = calls.filter((c) => c.tool === "battles_decks");
    expect(
      reads
        .filter((c) => !c.args.deck_hash)
        .map((c) => c.args.mode ?? null)
        .sort(),
    ).toEqual(["event", "ladder", "war", null].sort());
    const full = reads.filter((c) => c.args.deck_hash);
    expect(full.map((c) => c.args.mode)).toEqual(["ladder", "ladder"]);
    expect(reads.every((c) => c.args.season === "current")).toBe(true);
    expect(reads.every((c) => c.args.player_tag === "#20JJJ2CCRU")).toBe(true);
  });

  test("the season home links to every deck", async ({ page }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder");
    await page.getByRole("link", { name: "Every deck you played ›" }).click();
    await expect(page).toHaveURL(/\/ladder\/decks(\?mode=ladder)?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /decks,/ }),
    ).toBeVisible();
  });

  test("@narrow a deck's cards fall under its record, and nothing scrolls sideways", async ({
    page,
  }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/decks");
    await expect(page.locator(".ladder-deckrow .card-art")).toHaveCount(16);
    const grid = page.locator(".ladder-deckrow .deck-grid").first();
    const columns = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(4);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await accessible(page, "ladder decks narrow");
  });
});

test.describe("Ladder cards", () => {
  test("the cards you played and faced in one mode, each form its own row, and the opponents", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/cards");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Cards you played, cards you faced",
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Cards - Ladder - Elixir");
    await expect(page.locator(".page__lede")).toContainText(
      "Trophy Road, this season.",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Mode" })
        .getByRole("link", { name: "Trophy Road" }),
    ).toHaveAttribute("aria-current", "true");

    // Yours: twelve rows, eight cards (four of them in two forms).
    await expect(
      page.getByRole("heading", { name: "Your cards · 12 rows, 8 cards" }),
    ).toBeVisible();
    const mine = page.locator(".ladder-cards").nth(0).locator("tbody tr");
    await expect(mine).toHaveCount(12);
    await expect(mine.nth(0)).toContainText("Hero Mini P.E.K.K.A");
    await expect(mine.nth(0)).toContainText("35");
    await expect(
      mine.nth(0).getByRole("img", { name: "12 won, 23 lost" }),
    ).toBeVisible();
    await expect(mine.nth(0)).toContainText("34%");
    // The name is the one link, to the card's public page; the art is not
    // a link.
    await expect(
      mine.nth(4).getByRole("link", { name: "Evo Witch" }),
    ).toHaveAttribute("href", "/cards/26000007/");
    await expect(
      mine.nth(10).getByRole("link", { name: "Witch", exact: true }),
    ).toHaveAttribute("href", "/cards/26000007/");
    await expect(page.locator("a.card-art")).toHaveCount(0);
    await expect(page.locator(".ladder-cards").nth(0)).toBeVisible();

    // Theirs: the first twelve of fourteen, then the rest in place.
    await expect(
      page.getByRole("heading", { name: "Across the table from you" }),
    ).toBeVisible();
    await expect(page.locator(".panel").nth(1)).toContainText(
      "35 battles · 34 opponents",
    );
    const theirs = page.locator(".ladder-cards").nth(1).locator("tbody tr");
    await expect(theirs).toHaveCount(12);
    await expect(theirs.nth(0)).toContainText("Evo Witch");
    await expect(
      theirs.nth(0).getByRole("img", { name: "1 won, 8 lost" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show all 14 rows" }).click();
    await expect(theirs).toHaveCount(14);

    // The opponents: the tool's count and the one who came back.
    const opp = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Opponents" }) });
    await expect(opp).toContainText(
      "34 different opponents on Trophy Road this season. One came back:",
    );
    await expect(opp.getByRole("link", { name: "A Rival" })).toHaveAttribute(
      "href",
      "/console/explore/player/2Q8L9V0P",
    );
    await expect(opp).toContainText("#2Q8L9V0P, twice,");
    await accessible(page, "ladder cards");

    const reads = calls.filter(
      (c) => c.tool === "battles_cards" || c.tool === "battles_opponents",
    );
    expect(
      reads.map((c) => [c.tool, c.args.perspective ?? null, c.args.mode]),
    ).toEqual(
      expect.arrayContaining([
        ["battles_cards", "mine", "ladder"],
        ["battles_cards", "opponent", "ladder"],
        ["battles_opponents", null, "ladder"],
      ]),
    );
    expect(reads.every((c) => c.args.season === "current")).toBe(true);
  });

  test("a mode with no battles says so", async ({ page }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/cards?mode=war");
    await expect(
      page.getByRole("heading", { name: "No War battles this season" }),
    ).toBeVisible();
    await expect(page.locator(".ladder-cards")).toHaveCount(0);
  });

  test("@narrow the card tables fit a phone", async ({ page }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/cards");
    await expect(
      page.locator(".ladder-cards").nth(0).locator("tbody tr"),
    ).toHaveCount(12);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await accessible(page, "ladder cards narrow");
  });
});
