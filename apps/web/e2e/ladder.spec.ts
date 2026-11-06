import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import {
  FORM,
  explore,
  summary,
  tally,
  type ToolCall,
} from "./ladder-fixture.ts";

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
  test("/ladder says what it is and offers an account, with no rail", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/ladder/decks?mode=ranked");
    await expect(
      page.getByRole("heading", { name: "Your season, read back" }),
    ).toBeVisible();
    await expect(page.locator(".rail")).toHaveCount(0);
    // A new account comes back to the Ladder page it was asked from.
    await expect(
      page.getByRole("link", { name: "Create your account" }),
    ).toHaveAttribute(
      "href",
      "/signin?signup&return_to=%2Fladder%2Fdecks%3Fmode%3Dranked",
    );
    await expect(
      page.getByRole("link", { name: "How Ladder works" }),
    ).toHaveAttribute("href", "/docs/ladder");
    await expect(
      page.getByRole("link", { name: "See a recorded battle" }),
    ).toHaveAttribute("href", /^\/battle\/[0-9a-f]{12}$/);
    await accessible(page, "ladder invite");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
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
        page.getByRole("group", { name: "Mode" }).getByRole("button", {
          name: mode === "war" ? "War" : "Events",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
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
  test("the season home: the head, the scope bar, the tabs, and the mode's season", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");

    await expect(
      page.getByRole("heading", { level: 1, name: "Season 136" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Season - Ladder - Elixir");
    // Times are prose in the account's zone: 10:00Z is 5:00 am Central.
    await expect(page.locator(".kit-head__sub")).toContainText(
      "King Thing · 24 days in. The season ends Mon Oct 5, 5:00 am.",
    );

    // The bar marks Ladder as the place you are in, not Home.
    const places = page
      .getByRole("banner")
      .getByRole("navigation", { name: "Main" });
    await expect(places.getByRole("link", { name: "Ladder" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      places.getByRole("link", { name: "Home" }),
    ).not.toHaveAttribute("aria-current", "page");

    // No rail: one player names itself, and the tabs are the pages.
    await expect(page.locator(".rail")).toHaveCount(0);
    await expect(page.locator(".ladder-scope__one")).toContainText(
      "King Thing",
    );
    await expect(page.locator(".ladder-scope__one")).toContainText(
      "#20JJJ2CCRU",
    );
    await expect(
      page.getByRole("tab", { name: "Season", exact: true }),
    ).toHaveAttribute("aria-selected", "true");

    // Freshness says what a gap means, and never that no battles happened.
    const fresh = page.locator(".kit-fresh");
    await expect(fresh).toContainText("Battle log read");
    await fresh.locator("summary").click();
    await expect(fresh).toContainText(
      "A gap means unknown. It does not mean no battles.",
    );
    await fresh.locator("summary").click();

    // Trophy Road and War tie in this summary; the chip order breaks ties.
    const modes = page.getByRole("group", { name: "Mode" });
    await expect(modes.getByRole("button")).toHaveText([
      "Trophy Road",
      "Path of Legends",
      "War",
      "Events",
      "Casual",
    ]);
    await expect(
      modes.getByRole("button", { name: "Trophy Road" }),
    ).toHaveAttribute("aria-pressed", "true");

    const tiles = page.locator(".ladder-tile");
    await expect(tiles).toHaveCount(4);
    await expect(tiles.nth(0)).toContainText("35");
    await expect(tiles.nth(0)).toContainText("since Mon Sep 7, 5:00 am");
    await expect(
      tiles.nth(1).getByRole("img", { name: "12 won, 23 lost" }),
    ).toBeVisible();
    await expect(tiles.nth(2)).toContainText("34%");
    await expect(tiles.nth(3)).toContainText("Trophy range");
    await expect(tiles.nth(3)).toContainText("12,500–12,562");
    await expect(page.getByText("You stood on the 12,500 floor")).toContainText(
      "(Ultimate Clash Pit) this season. Six losses there cost nothing",
    );

    // Week by week, newest first, the clipped weeks marked.
    const weeks = page.locator(".ladder-wk");
    await expect(weeks).toHaveCount(4);
    await expect(weeks.nth(3)).toContainText("Week of Sep 7 (part of a week)");
    await expect(weeks.nth(3)).toContainText("4–6 · 40% won · −6");
    await expect(weeks.nth(2)).toContainText("+29");

    // The deck played most in this mode and this season, in real art.
    const deck = page.locator(".ladder-top");
    await expect(deck).toContainText("Royal Hogs bridge spam");
    await expect(deck).toContainText("20 battles, last played");
    await expect(deck).toContainText("3.75 average elixir.");
    await expect(deck).toContainText("Your cards 0.60 levels above theirs.");
    await expect(deck.locator(".card-art")).toHaveCount(8);
    await expect(deck.getByRole("img", { name: "Evo Witch" })).toBeVisible();

    // What the record is, folded at the foot.
    await page.getByText("About this record", { exact: true }).click();
    await expect(
      page.getByText("without pooling modes or rating players"),
    ).toBeVisible();

    // The docs strip names Ladder's own page.
    await expect(
      page.locator(".page__docs").getByRole("link", { name: "Ladder" }),
    ).toHaveAttribute("href", "/docs/ladder");

    // Every read went through the bridge, as the reader's player. Each read
    // with a mode names one; only the scope bar's read has none.
    const perf = calls.filter(
      (c) => c.tool === "battles_performance" && !c.args.from,
    );
    expect(perf.map((c) => [c.args.mode, c.args.group_by ?? null])).toEqual(
      expect.arrayContaining([
        ["ladder", null],
        ["ladder", "week"],
      ]),
    );
    expect(perf.every((c) => c.args.player_tag === "#20JJJ2CCRU")).toBe(true);
    expect(
      perf.every(
        (c) =>
          c.args.season === "current" ||
          (c.args.season === 135 && c.args.mode === "ladder"),
      ),
    ).toBe(true);
    await accessible(page, "ladder season");
  });

  test("the week beside the four before it, and the season before and since the deck played most: numbers and counts only", async ({
    page,
  }) => {
    // Thursday 4:00 pm Central: the game week began Monday 10:00Z.
    await page.clock.setFixedTime(new Date("2026-10-01T21:00:00Z"));
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");

    const week = page.getByRole("region", { name: "This week vs your last 4" });
    await expect(week).toContainText("Trophy Road");
    const head = week.locator("thead th");
    await expect(head.nth(1)).toHaveText("This week");
    await expect(head.nth(2)).toHaveText("Last 4 weeks");
    const rows = week.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Win rate");
    await expect(rows.nth(0).locator("td").nth(0)).toContainText("57%");
    await expect(rows.nth(0).locator("td").nth(0)).toContainText("14 battles");
    await expect(rows.nth(0).locator("td").nth(1)).toContainText("34%");
    await expect(rows.nth(0).locator("td").nth(1)).toContainText("35 battles");
    await expect(rows.nth(1)).toContainText("Three-crown rate");
    await expect(rows.nth(1).locator("td").nth(0)).toContainText("13 battles");
    await expect(rows.nth(2)).toContainText("Net trophies");
    await expect(rows.nth(2).locator("td").nth(0)).toContainText("+58");
    await expect(rows.nth(2).locator("td").nth(1)).toContainText("−10");
    await expect(week).toContainText("this one began Mon 5:00 am");
    await expect(week).toContainText("at least 10 battles");

    // The week is UTC on the policy grid: Monday 10:00Z, the four before.
    const read = calls.find(
      (c) => c.tool === "battles_performance" && c.args.compare_from,
    );
    expect(read?.args).toEqual({
      player_tag: "#20JJJ2CCRU",
      from: "2026-09-28T10:00:00.000Z",
      compare_from: "2026-08-31T10:00:00.000Z",
      compare_to: "2026-09-28T10:00:00.000Z",
      mode: "ladder",
    });

    // The season split at the first battle on the deck played most.
    const deck = page.getByRole("region", {
      name: "Before and since Royal Hogs bridge spam",
    });
    await expect(deck).toContainText(
      "Royal Hogs bridge spam is the deck you played most",
    );
    await expect(deck.locator("thead th").nth(1)).toHaveText(/^Before Sep 8/);
    await expect(deck.locator("thead th").nth(2)).toHaveText(/^Since Sep 8/);
    const split = deck.locator("tbody tr").nth(0);
    await expect(split.locator("td").nth(0)).toContainText("25%");
    await expect(split.locator("td").nth(0)).toContainText("12 battles");
    await expect(split.locator("td").nth(1)).toContainText("39%");
    await expect(split.locator("td").nth(1)).toContainText("23 battles");
    await expect(deck).toContainText(
      "A deck's name describes its cards, never how well it plays.",
    );
    const ba = calls.find(
      (c) => c.tool === "battles_performance" && c.args.before_after,
    );
    expect(ba?.args).toEqual({
      player_tag: "#20JJJ2CCRU",
      season: "current",
      mode: "ladder",
      before_after: "2026-09-08T05:07:03.000Z",
    });

    // Numbers, never a verdict.
    for (const panel of [week, deck])
      await expect(panel).not.toContainText(
        /improv|better|worse|good|bad|great|declin|trend/i,
      );
    await accessible(page, "ladder form");
  });

  test("a form panel under the minimum is not drawn, and a mode without one draws neither", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, {
          form: { ...FORM, week: { ...FORM.week, decided_battles: 9 } },
        }),
      }),
    );
    await page.goto("/ladder");
    const change = page.getByRole("region", {
      name: "Before and since Royal Hogs bridge spam",
    });
    await expect(change).toBeVisible();
    // The deck's first battle is a date, not whatever `when` means globally.
    await expect(change).toContainText(/Its first battle was \w{3} /);
    await expect
      .poll(() =>
        calls.some(
          (c) => c.tool === "battles_performance" && c.args.compare_from,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("region", { name: "This week vs your last 4" }),
    ).toHaveCount(0);

    await page
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "War" })
      .click();
    await expect(page).toHaveURL(/\/ladder\?mode=war$/);
    await expect(page.locator(".ladder-tile").nth(3)).toContainText("Crowns");
    // Neither the week nor the deck panel: the one form panel is the
    // season's, with no War battle in Season 135 to set beside.
    await expect(
      page.getByRole("region", { name: "This season vs last" }),
    ).toContainText("Elixir recorded no War battles in Season 135");
    await expect(page.locator(".ladder-form")).toHaveCount(1);
  });

  test("a mode is an address, and a mode with no battles says so", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");
    await page
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "Path of Legends" })
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
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "War" })
      .click();
    await expect(page).toHaveURL(/\/ladder\?mode=war$/);
    await expect(page.locator(".ladder-tile").nth(3)).toContainText("Crowns");
    await expect(page.locator(".ladder-tile").nth(3)).toContainText("61–44");
    await expect(page.getByText("This week:")).toHaveCount(0);
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
        .getByRole("group", { name: "Mode" })
        .getByRole("button", { name: "Path of Legends" }),
    ).toHaveAttribute("aria-pressed", "true");
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

  test("the player select lists your players only, and switching is an address", async ({
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
    const select = page.getByLabel("Player", { exact: true });
    await expect(select.locator("option")).toHaveText([
      "King Thing, your main player",
      "Second Thing, also you",
    ]);
    await accessible(page, "ladder player list");
    await select.selectOption("#9PQ2R8L");
    await expect(page).toHaveURL(/\/ladder\?player=9PQ2R8L&mode=war$/);
    await expect(select).toHaveValue("#9PQ2R8L");
    await expect
      .poll(() =>
        calls.some(
          (c) =>
            c.tool === "battles_performance" &&
            c.args.player_tag === "#9PQ2R8L",
        ),
      )
      .toBe(true);
    // The tabs keep whose season and which mode as you move.
    await expect(page.getByRole("tab", { name: "Decks" })).toHaveAttribute(
      "href",
      "/ladder/decks?player=9PQ2R8L&mode=war",
    );

    // The main player needs no name in the address.
    await select.selectOption("#20JJJ2CCRU");
    await expect(page).toHaveURL(/\/ladder\?mode=war$/);

    // A tag that is not yours reads your primary instead.
    await page.goto("/ladder?player=8LQ2R9P");
    await expect(select).toHaveValue("#20JJJ2CCRU");
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
      page.getByRole("heading", { level: 1, name: /Season 136/ }),
    ).toBeVisible();
  });

  for (const [state, attempts, words] of [
    ["on its way", [], "Second Thing\u2019s first battles are on their way"],
    [
      "not found",
      [
        {
          endpoint: "player",
          last_failed_at: "2026-09-29T20:00:00Z",
          last_failed_status: 404,
        },
      ],
      "Tag not found",
    ],
  ] as const) {
    test(`a selected player ${state} keeps the player list, and switching back reads the other`, async ({
      page,
    }) => {
      const base = explore();
      await mockApi(
        page,
        signedIn({
          "GET /api/me": [200, { ...ME, claims: [...ME.claims, ALT] }],
          "GET /api/me/first-answer": [
            200,
            {
              as_of: "2026-09-29T21:00:00Z",
              player: {
                player_tag: ALT.player_tag,
                name: ALT.name,
                profile_available: false,
                battles_7d: 0,
                battles_30d: 0,
                capture_attempts: attempts,
              },
              clan: null,
              connection: { active_connections: 0 },
            },
          ],
          "POST /api/explore": (route) => {
            const { tool, args } = route.request().postDataJSON() as ToolCall;
            if (args.player_tag !== ALT.player_tag) return base(route);
            return [
              200,
              {
                tool,
                is_error: true,
                body: {
                  error: {
                    code: "not_recorded",
                    class: "input",
                    message: "Not recorded yet.",
                  },
                },
              },
            ];
          },
        }),
      );
      await page.goto("/ladder/decks?player=9PQ2R8L&mode=war");
      await expect(page.getByRole("heading", { name: words })).toBeVisible();
      const select = page.getByLabel("Player", { exact: true });
      await expect(select).toHaveValue("#9PQ2R8L");
      await accessible(page, `ladder pending ${state}`);

      // The way out keeps the page and the mode, and the main needs no name.
      await select.selectOption("#20JJJ2CCRU");
      await expect(page).toHaveURL(/\/ladder\/decks\?mode=war$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Decks" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: words })).toHaveCount(0);
    });
  }

  test("@narrow a pending player's list is 44px and nothing scrolls sideways", async ({
    page,
  }) => {
    const base = explore();
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, { ...ME, claims: [...ME.claims, ALT] }],
        "GET /api/me/first-answer": [
          200,
          {
            player: { player_tag: ALT.player_tag, name: ALT.name },
            clan: null,
          },
        ],
        "POST /api/explore": (route) => {
          const { tool, args } = route.request().postDataJSON() as ToolCall;
          if (args.player_tag !== ALT.player_tag) return base(route);
          return [
            200,
            {
              tool,
              is_error: true,
              body: { error: { code: "not_recorded", message: "Not yet." } },
            },
          ];
        },
      }),
    );
    await page.goto("/ladder?player=9PQ2R8L");
    const select = page.getByLabel("Player", { exact: true });
    await expect(select).toBeVisible();
    expect((await select.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      44,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("with no player of your own, Ladder says so and offers the way in", async ({
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
      page.getByRole("link", { name: "Add your player" }),
    ).toHaveAttribute("href", "/console/account/tracking#add-player-tag");
    await accessible(page, "ladder no players");
  });

  test("@narrow the scope bar is 44px tall to touch, and nothing scrolls sideways", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, { ...ME, claims: [...ME.claims, ALT] }],
        "POST /api/explore": explore(),
      }),
    );
    await page.goto("/ladder");
    await expect(
      page.getByRole("heading", { level: 1, name: "Season 136" }),
    ).toBeVisible();
    await expect(page.locator(".rail__toggle")).toHaveCount(0);
    await expect(page.locator(".ladder-wk")).toHaveCount(4);
    for (const target of [
      page.getByLabel("Player", { exact: true }),
      page.getByLabel("Season", { exact: true }),
      page.getByRole("group", { name: "Mode" }).getByRole("button").first(),
      page.locator(".kit-fresh > summary"),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await accessible(page, "ladder narrow");
  });
});

test.describe("Ladder days and battles", () => {
  // Tuesday, September 29, 4:00 pm Central: the board's "today".
  const TODAY = new Date("2026-09-29T21:00:00Z");

  test("the season's days on the account's calendar, in this chip's mode", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");
    const panel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Days played" }) });
    await expect(panel).toContainText(
      "days with recorded battles, of 23 so far",
    );
    const days = panel.locator(".ladder-day");
    await expect(days).toHaveCount(28);
    // Another mode's battles are a count on their day, never pooled in.
    const other = days.filter({ hasText: "in other modes" }).first();
    await expect(other).toHaveClass(/ladder-day--other/);
    // A day no read covers is unknown; the key lists what the calendar draws.
    await expect(days.nth(0)).toContainText("Unknown");
    await expect(panel.locator(".ladder-legend")).toContainText(
      "Unknown. No read covers this day.",
    );
    await expect(panel.locator(".ladder-legend")).not.toContainText("Not read");
    // Today is the ring, and the days to come say nothing.
    await expect(days.nth(22)).toHaveAttribute("aria-current", "date");
    await expect(days.nth(23)).toHaveClass(/ladder-day--fut/);
    await expect(panel.locator(".panel__foot")).toContainText(
      "Season 136 runs Mon Sep 7, 5:00 am to Mon Oct 5, 5:00 am. Battles after midnight count on the next day.",
    );
    await accessible(page, "ladder calendar");

    // War: the same sweep, its own counts, no second read of the season.
    const reads = () => calls.filter((c) => c.tool === "battles_query").length;
    const before = reads();
    await page
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "War" })
      .click();
    await expect(page).toHaveURL(/\/ladder\?mode=war$/);
    await expect(panel.locator(".panel__foot")).toContainText(
      "Other modes show as a count, never pooled into this one.",
    );
    expect(reads()).toBe(before);
  });

  test("a whole day read with nothing is no battles; a partly read one is not", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": (route) => {
          const { tool } = route.request().postDataJSON() as ToolCall;
          if (tool === "elixir_coverage")
            return [
              200,
              {
                tool,
                is_error: false,
                body: {
                  observation_intervals: [
                    {
                      observed_from: "2026-09-13T04:59:00Z",
                      observed_to: "2026-09-14T05:01:00Z",
                      is_complete: true,
                      expected_battles: 0,
                      captured_battles: 0,
                    },
                  ],
                },
              },
            ];
          return explore(calls)(route);
        },
      }),
    );
    await page.goto("/ladder");
    const days = page.locator(".ladder-day");
    await expect(days.nth(6)).toContainText("Sep 13");
    await expect(days.nth(6)).toContainText("No battles");
    await expect(days.nth(6)).toHaveClass(/ladder-day--quiet/);
    await expect(page.locator(".ladder-legend")).toContainText(
      "No battles: the whole day was read.",
    );
    await expect(
      page.locator("section").filter({ hasText: "Days played" }),
    ).toContainText(
      "Longest stretch with no battles in this mode, all days fully read: 1 day, Sep 13.",
    );
  });

  test("coverage that does not answer says so, and no day is called quiet", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": (route) => {
          const { tool } = route.request().postDataJSON() as ToolCall;
          if (tool === "elixir_coverage")
            return [
              200,
              {
                tool,
                is_error: true,
                body: { error: { code: "unavailable", message: "no" } },
              },
            ];
          return explore()(route);
        },
      }),
    );
    await page.goto("/ladder");
    await expect(page.getByText("Coverage could not be checked")).toBeVisible();
    await expect(page.locator(".ladder-day--quiet")).toHaveCount(0);
  });

  test("Battles: by day and by sitting, in this chip's mode, each battle opening on its page", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/battles");
    await expect(
      page.getByRole("heading", { level: 1, name: "Battles" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Battles - Ladder - Elixir");
    await expect(page.locator(".kit-head__sub")).toHaveText(
      "King Thing · Season 136, Trophy Road",
    );
    await expect(
      page.getByRole("tab", { name: "Battles", exact: true }),
    ).toHaveAttribute("aria-selected", "true");

    const day = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Mon Sep 28" }) });
    await expect(day).toContainText("3 battles · 0–3");
    // The newest sitting is open; the floor loss shows no trophies.
    const sitting = day.locator(".ladder-sit").first();
    await expect(sitting).toHaveAttribute("open", "");
    await expect(sitting.locator("summary")).toContainText("10:53 – 11:09 pm");
    await expect(sitting.locator("summary")).toContainText(
      "3 battles · 0–3 · 12,530 to 12,500",
    );
    const rows = sitting.locator(".ladder-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("11:09 pm");
    await expect(rows.first()).toContainText("lost 0–1");
    await expect(rows.first().locator(".ladder-row__tr")).toHaveText("");
    await expect(rows.nth(2).locator(".ladder-row__tr")).toHaveText("−30");
    // Links come from the tool's url, never built here.
    await expect(rows.first().getByRole("link")).toHaveAttribute(
      "href",
      /^\/battle\/[0-9a-f]{12}$/,
    );
    await accessible(page, "ladder battles");

    await expect(page.locator(".ladder-sit")).toHaveCount(7);
    await page.getByRole("button", { name: "Show older days" }).click();
    await expect(page.locator(".ladder-sit").last()).toBeAttached();
    expect(await page.locator(".ladder-sit").count()).toBeGreaterThan(7);

    // Every page of this mode's season was read, compact, as the reader.
    const reads = calls.filter(
      (c) => c.tool === "battles_query" && c.args.mode === "ladder",
    );
    expect(reads[0]?.args).toMatchObject({
      player_tag: "#20JJJ2CCRU",
      season: "current",
      verbosity: "compact",
      limit: 40,
      include_total: true,
    });
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
    await page.goto("/ladder");
    await expect(page.locator(".ladder-day")).toHaveCount(28);
    // One refusal, then the season from the top at the limit that fits.
    const reads = calls.filter(
      (c) => c.tool === "battles_query" && !c.args.mode,
    );
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
    await page.goto("/ladder/battles?mode=war");
    await expect(page.locator(".ladder-row").first()).toBeVisible();
    // The fixture's fifty-fifth battle, a war loss on the 26th, has no url.
    const day = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Sat Sep 26" }) });
    await expect(day.locator(".ladder-row__who a")).toHaveCount(2);
    await expect(day.locator(".ladder-row__who:not(:has(a))")).toHaveCount(1);
  });

  test("a mode with no battles says so on Battles", async ({ page }) => {
    await page.clock.setFixedTime(TODAY);
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder/battles?mode=ranked");
    await expect(
      page.getByRole("heading", {
        name: "No Path of Legends battles recorded this season yet",
      }),
    ).toBeVisible();
    await accessible(page, "ladder battles empty");
  });

  test("@narrow the calendar is a list of days, and Battles fits a phone", async ({
    page,
  }) => {
    await page.clock.setFixedTime(TODAY);
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder");
    await expect(page.locator(".ladder-day")).toHaveCount(28);
    await expect(page.locator(".ladder-cal__wd").first()).toBeHidden();
    // Newest first, naming its weekday.
    const cal = page.locator(".ladder-cal");
    await expect(
      cal.evaluate((el) => getComputedStyle(el).flexDirection),
    ).resolves.toBe("column-reverse");
    await expect(page.locator(".ladder-day__wd").first()).toBeVisible();
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
    expect(await fits()).toBeLessThanOrEqual(0);
    await accessible(page, "ladder calendar narrow");
    await page.goto("/ladder/battles");
    await expect(page.locator(".ladder-row").first()).toBeVisible();
    const summary = await page
      .locator(".ladder-sit > summary")
      .first()
      .boundingBox();
    expect(summary?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await fits()).toBeLessThanOrEqual(0);
    await accessible(page, "ladder battles narrow");
  });
});

test.describe("Ladder scope, moved pages and the other chips", () => {
  const RACE = {
    current: {
      season_id: 136,
      section_index: 3,
      is_colosseum: false,
      day_kind: "war",
      race_finished_at: null,
      period: { source_observed_at: "2026-09-29T20:00:00Z" },
      standings: [{ clan_tag: "#CLAN" }],
    },
    history: {
      member_weeks: [
        { season_id: 136, section_index: 3, points: 2150, decks_used: 12 },
        { season_id: 136, section_index: 2, points: 3000, decks_used: 16 },
      ],
    },
  };

  for (const [from, to] of [
    ["/ladder/days", "/ladder/battles"],
    [
      "/ladder/days?player=9PQ2R8L&mode=war&season=135",
      "/ladder/battles?player=9PQ2R8L&mode=war&season=135",
    ],
  ] as const) {
    test(`${from} lands on ${to}`, async ({ page }) => {
      await mockApi(
        page,
        signedIn({
          "GET /api/me": [200, { ...ME, claims: [...ME.claims, ALT] }],
          "POST /api/explore": explore(),
        }),
      );
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to.replace(/[?]/g, "\\?")}$`));
      await expect(
        page.getByRole("heading", { level: 1, name: "Battles" }),
      ).toBeVisible();
    });
  }

  test("a link with a player and a mode lands on that player and mode", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, { ...ME, claims: [...ME.claims, ALT] }],
        "POST /api/explore": explore(),
      }),
    );
    // Home's Open in Ladder, and the same shape from Friends and mail.
    await page.goto("/ladder?player=9PQ2R8L&mode=casual");
    await expect(page.getByLabel("Player", { exact: true })).toHaveValue(
      "#9PQ2R8L",
    );
    await expect(
      page
        .getByRole("group", { name: "Mode" })
        .getByRole("button", { name: "Casual" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/ladder/decks?season=135");
    await expect(page.getByLabel("Season", { exact: true })).toHaveValue("135");
  });

  test("War's pages carry this race week's decks and points, with no out-of", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore([], { warRace: RACE }),
        "GET /api/me": [
          200,
          {
            ...ME,
            claims: [{ ...ME.claims[0], last_known_clan_tag: "#CLAN" }],
          },
        ],
      }),
    );
    await page.goto("/ladder?mode=war");
    const line = page.locator(".ladder-war");
    await expect(line).toContainText(
      "This week: 12 war decks used, 2,150 points.",
    );
    await expect(line).toContainText("Season 136, week 4.");
    await expect(line).toContainText(
      "A duel spends one deck a round, so decks and battles differ.",
    );
    await expect(line).not.toHaveText(/\d of \d/);
    await expect(
      line.getByRole("link", { name: "See the race in Clan › Season" }),
    ).toHaveAttribute("href", "/clan/CLAN/season");
    await page.getByRole("tab", { name: "Battles", exact: true }).click();
    await expect(line).toContainText("This week: 12 war decks used");
    await expect(
      page.getByText("War battles are listed one by one, like any other."),
    ).toBeVisible();
    await accessible(page, "ladder war line");
    // Not on Trophy Road, and no line where the clan's war cannot be read.
    await page.goto("/ladder");
    await expect(page.locator(".ladder-tile").first()).toBeVisible();
    await expect(line).toHaveCount(0);
  });

  test("Other's Battles keeps Challenge and Tournament apart: no day or sitting pools them", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-29T21:00:00Z"));
    const row = (id: string, mode: string, at: string, win: boolean) => ({
      battle_id: id.repeat(64),
      url: null,
      battle_time: at,
      type: mode === "challenge" ? "challenge" : "tournament",
      game_mode: { id: 72000006, name: "Challenge" },
      mode_group: mode,
      me: { outcome: win ? "win" : "loss", crowns: win ? 2 : 0 },
      teammates: [],
      opponents: [
        {
          player_tag: "#2PQ8RV0L",
          name: "A Rival",
          name_known: true,
          crowns: win ? 0 : 1,
        },
      ],
    });
    // Ten minutes apart on one evening: as one list, one day and one sitting.
    const rows: Record<string, unknown[]> = {
      challenge: [row("a", "challenge", "2026-09-28T23:00:00.000Z", true)],
      tournament: [row("b", "tournament", "2026-09-28T23:10:00.000Z", false)],
    };
    const calls: ToolCall[] = [];
    const base = explore(calls, {
      otherModes: { challenge: tally(1, 1, 0), tournament: tally(1, 0, 0) },
    });
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": (route) => {
          const { tool, args } = route.request().postDataJSON() as ToolCall;
          const mine = rows[String(args.mode)];
          if (tool !== "battles_query" || !mine) return base(route);
          calls.push({ tool, args });
          return [
            200,
            {
              tool,
              is_error: false,
              body: {
                player_tag: args.player_tag,
                applied: { limit: args.limit, verbosity: "compact" },
                battles: mine,
                total_count: mine.length,
                next_cursor: null,
              },
            },
          ];
        },
      }),
    );
    await page.goto("/ladder/battles?mode=other");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { level: 2, name: "Challenge" }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { level: 2, name: "Tournament" }),
    ).toBeVisible();
    // The same day twice, each with its own mode's count and record.
    const days = main.locator("section").filter({
      has: page.getByRole("heading", { name: "Mon Sep 28" }),
    });
    await expect(days).toHaveCount(2);
    await expect(days.nth(0).locator(".ladder-aside")).toHaveText(
      "1 battle · 1–0",
    );
    await expect(days.nth(1).locator(".ladder-aside")).toHaveText(
      "1 battle · 0–1",
    );
    await expect(page.locator(".ladder-sit")).toHaveCount(2);
    await expect(main).not.toContainText("2 battles");
    await expect(main).toContainText("the two are never added up");
    expect(
      calls
        .filter((c) => c.tool === "battles_query" && c.args.mode)
        .map((c) => c.args.mode),
    ).toEqual(expect.arrayContaining(["challenge", "tournament"]));
    await accessible(page, "ladder other battles");
  });

  test("Other appears only with a Challenge or Tournament battle, and never pools the two", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");
    const modes = page.getByRole("group", { name: "Mode" });
    await expect(modes.getByRole("button")).toHaveCount(5);

    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, {
          otherModes: {
            challenge: tally(7, 4, 3),
            tournament: tally(3, 1, 2),
          },
        }),
      }),
    );
    await page.goto("/ladder");
    await modes.getByRole("button", { name: "Other" }).click();
    await expect(page).toHaveURL(/\/ladder\?mode=other$/);
    const challenge = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Challenge this season" }),
    });
    await expect(challenge).toContainText("never pooled");
    await expect(challenge.locator(".ladder-tile").first()).toContainText("7");
    const tournament = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Tournament this season" }),
    });
    await expect(tournament.locator(".ladder-tile").first()).toContainText("3");
    await expect(tournament).toContainText(
      "A Tournament is not a Challenge, so the two are never added up.",
    );
    // Two reads, one each; no calendar, no form, no pooled line.
    await expect(
      page.getByRole("heading", { name: "Days played" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        calls.some(
          (c) =>
            c.tool === "battles_performance" && c.args.mode === "tournament",
        ),
      )
      .toBe(true);
    await accessible(page, "ladder other");
  });
});

test.describe("Ladder decks", () => {
  test("every deck in this chip's mode, with its cards, its record and a swap of forms", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/decks?mode=ladder");

    await expect(
      page.getByRole("heading", { level: 1, name: "Decks" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Decks - Ladder - Elixir");
    await expect(
      page.getByRole("tab", { name: "Decks", exact: true }),
    ).toHaveAttribute("aria-selected", "true");

    const road = page.locator("section").filter({
      has: page.getByRole("heading", { name: "2 decks in Trophy Road" }),
    });
    await expect(road).toContainText("Most played first");
    const decks = road.locator(".ladder-deckrow");
    await expect(decks).toHaveCount(2);
    const first = decks.nth(0);
    await expect(first).toContainText("Royal Hogs bridge spam");
    await expect(first).toContainText(
      "Evo Witch, Hero Mini P.E.K.K.A, Evo Royal Ghost",
    );
    // Days in the account's zone: the last battle, 04:01Z on the 19th,
    // was the 18th in Chicago.
    await expect(first).toContainText("Sep 8 to Sep 18 · 3.75 average elixir");
    await expect(first.locator(".card-art")).toHaveCount(8);
    await expect(first.getByRole("img", { name: "Evo Witch" })).toBeVisible();
    await expect(first).toContainText("20 battles");
    await expect(
      first.getByRole("img", { name: "8 won, 12 lost" }),
    ).toBeVisible();
    await expect(first).toContainText("40% won");
    await expect(first).toContainText("your cards 0.60 levels above theirs");
    // The second deck's Trophy Road record is its own: its two event
    // battles are not in it.
    await expect(
      decks.nth(1).getByRole("img", { name: "4 won, 11 lost" }),
    ).toBeVisible();
    await expect(road).toContainText(
      "A deck is its exact cards, forms and tower troop",
    );

    // The two Trophy Road decks are the same eight cards with the
    // evolutions moved, one put down before the other was picked up.
    const swap = page.locator(".ladder-swap");
    await expect(swap.getByRole("heading")).toHaveText(
      "The evolution swap on Sun Sep 20",
    );
    await expect(swap).toContainText("Trophy Road only");
    const sides = swap.locator(".ladder-swap__side");
    await expect(sides.nth(0)).toContainText("Before, Sep 8 to Sep 18");
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
    await accessible(page, "ladder decks");

    // One read of this mode, one per deck for its cards, and no pooled read.
    const reads = calls.filter((c) => c.tool === "battles_decks");
    expect(reads.every((c) => c.args.mode === "ladder")).toBe(true);
    expect(reads.every((c) => c.args.season === "current")).toBe(true);
    expect(reads.every((c) => c.args.player_tag === "#20JJJ2CCRU")).toBe(true);
    expect(reads.filter((c) => c.args.deck_hash).length).toBe(2);
  });

  test("War's decks have real cards too, and duel rounds their own panel", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/decks?mode=war");
    const war = page.locator("section").filter({
      has: page.getByRole("heading", { name: "3 decks in War" }),
    });
    const mortar = war.locator(".ladder-deckrow").first();
    await expect(mortar).toContainText("Evo Mortar siege");
    await expect(
      mortar.getByRole("img", { name: "5 won, 4 lost" }),
    ).toBeVisible();
    await expect(mortar.locator(".card-art")).toHaveCount(8);
    const duels = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Duel rounds" }),
    });
    await expect(duels).toContainText("Evo Skeleton Barrel bait");
    await expect(duels).toContainText("10 rounds");
    await expect(
      duels.getByRole("img", { name: "3 won, 7 lost" }),
    ).toBeVisible();
    await accessible(page, "ladder war decks");
  });

  test("the season home links to every deck", async ({ page }) => {
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder");
    await page.getByRole("link", { name: "Every deck you played ›" }).click();
    await expect(page).toHaveURL(/\/ladder\/decks(\?mode=ladder)?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Decks" }),
    ).toBeVisible();
  });

  test("@narrow a deck's cards sit in two rows of four, and nothing scrolls sideways", async ({
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
        name: "Cards",
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Cards - Ladder - Elixir");
    await expect(page.locator(".kit-head__sub")).toContainText(
      "King Thing · Season 136, Trophy Road",
    );
    await expect(
      page
        .getByRole("group", { name: "Mode" })
        .getByRole("button", { name: "Trophy Road" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Yours: twelve rows, eight cards (four of them in two forms).
    const yours = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Your cards" }) });
    await expect(yours).toContainText("12 rows, 8 cards");
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
    await expect(opp).toContainText("A Rival, twice,");
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

  test("most losses first is a choice: the default order stays, the address keeps it, and each row has its level gap", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder/cards");

    // The default is the tools' own order, and says its floors.
    const order = page.getByRole("group", {
      name: "Order what you faced",
    });
    await expect(
      order.getByRole("button", { name: "Most faced" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      order.getByRole("button", { name: "Most losses" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".ladder-order")).toContainText(
      "Most battles first. A card is listed from 3 battles, a player from 2.",
    );
    const theirs = page.locator(".ladder-cards").nth(1);
    await expect(
      theirs.getByRole("columnheader", { name: "Level gap" }),
    ).toBeVisible();
    const rows = theirs.locator("tbody tr");
    await expect(rows.nth(0)).toContainText("Evo Witch");
    await expect(rows.nth(0)).toContainText("+0.60");
    await expect(rows.nth(1)).toContainText("Graveyard");
    await expect(rows.nth(1)).toContainText("−0.35");
    // A row whose battles carry no levels shows a dash, never a zero.
    await expect(rows.nth(4)).toContainText("Skeletons");
    await expect(rows.nth(4).locator("td").last()).toHaveText("—");
    expect(
      calls
        .filter(
          (c) => c.tool === "battles_cards" || c.tool === "battles_opponents",
        )
        .every((c) => c.args.sort === undefined),
    ).toBe(true);

    // Choosing most losses is going to its address, and the reads ask
    // the tools for that order.
    await order.getByRole("button", { name: "Most losses" }).click();
    await expect(page).toHaveURL(/\/ladder\/cards\?.*order=losses/);
    await expect(
      order.getByRole("button", { name: "Most losses" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".ladder-order")).toContainText(
      "Most battles lost first, then most battles. A card is listed from 3 battles, a player from 2.",
    );
    await expect(rows.nth(0)).toContainText("Evo Witch");
    await expect(rows.nth(1)).toContainText("Graveyard");
    await expect(rows.nth(2)).toContainText("Fireball");
    await expect(rows.nth(3)).toContainText("Skeletons");
    await expect(page.locator(".panel").nth(1)).toContainText(
      "most battles lost first",
    );
    const opp = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Opponents" }) });
    await expect(opp).toContainText("One came back, most battles lost first:");
    await expect(opp).toContainText("level gap −0.50");
    // A chip keeps the order; Your cards does not take it.
    await page
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "War" })
      .click();
    await expect(page).toHaveURL(
      /mode=war.*order=losses|order=losses.*mode=war/,
    );
    await page
      .getByRole("group", { name: "Mode" })
      .getByRole("button", { name: "Trophy Road" })
      .click();
    const sorted = calls.filter((c) => c.args.sort === "losses");
    expect(sorted.map((c) => [c.tool, c.args.perspective ?? null])).toEqual(
      expect.arrayContaining([
        ["battles_cards", "opponent"],
        ["battles_opponents", null],
      ]),
    );
    expect(
      calls.some(
        (c) =>
          c.tool === "battles_cards" &&
          c.args.perspective === "mine" &&
          c.args.sort !== undefined,
      ),
    ).toBe(false);
    // No label and no verdict on the page: the record, in an order.
    await expect(page.locator("body")).not.toContainText(/nemesis/i);
    await accessible(page, "ladder cards by losses");
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

test.describe("Ladder seasons", () => {
  test("the picker lists the player's seasons, and a season is an address every page honours", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder?mode=ladder");
    const picker = page.getByLabel("Season", { exact: true });
    await expect(picker).toHaveValue("136");
    await expect(picker.locator("option")).toHaveText([
      "Season 136 (now)",
      "Season 135",
    ]);

    // Choosing one goes to its address, and the page reads that season.
    await picker.selectOption("135");
    await expect(page).toHaveURL(/\/ladder\?mode=ladder&season=135$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Season 135" }),
    ).toBeVisible();
    await expect(page.locator(".kit-head__sub")).toContainText(
      "The season ran Mon Aug 3, 5:00 am to Mon Sep 7, 5:00 am.",
    );
    // Its most played deck is that season's, a link from all of them.
    await expect(
      page.getByRole("link", { name: "Every deck you played ›" }),
    ).toHaveAttribute("href", "/ladder/decks?mode=ladder&season=135");
    await expect
      .poll(() =>
        calls.some(
          (c) =>
            c.tool === "battles_performance" &&
            c.args.season === 135 &&
            c.args.mode === "ladder",
        ),
      )
      .toBe(true);

    // The tabs keep the season, and so does a chip.
    await page.getByRole("tab", { name: "Decks", exact: true }).click();
    await expect(page).toHaveURL(/\/ladder\/decks\?mode=ladder&season=135$/);
    await expect(page.getByLabel("Season", { exact: true })).toHaveValue("135");
    await expect(
      page.getByRole("heading", { level: 1, name: "Decks" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        calls
          .filter((c) => c.tool === "battles_decks")
          .some((c) => c.args.season === 135),
      )
      .toBe(true);

    // A reload keeps it: the season is in the address, not the page.
    await page.reload();
    await expect(page.getByLabel("Season", { exact: true })).toHaveValue("135");
    await accessible(page, "ladder decks, an earlier season");
  });

  test("an empty current season opens on the last one, says so, and the empty one is a click away", async ({
    page,
  }) => {
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, { emptyCurrent: true }),
      }),
    );
    await page.goto("/ladder?mode=ladder");
    const note = page.locator(".ladder-season-note");
    await expect(note).toContainText(
      "Season 136 has no recorded battles yet, so this is Season 135.",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Season 135" }),
    ).toBeVisible();
    await expect(page.getByLabel("Season", { exact: true })).toHaveValue("135");
    // Its record is shown, not an empty page.
    await expect(page.locator(".ladder-tiles").first()).toContainText("52");
    await accessible(page, "ladder, an empty current season");

    // The empty season itself, one click away, says it is empty.
    await note.getByRole("link", { name: "Show Season 136 ›" }).click();
    await expect(page).toHaveURL(/\/ladder\?mode=ladder&season=136$/);
    await expect(
      page.getByRole("heading", {
        name: "No Trophy Road battles this season",
      }),
    ).toBeVisible();
    await expect(note).toHaveCount(0);
  });
});

/* "This season vs last" (Jamie, 2026-10-20): the season home's mode,
   this season beside the one before it on record. Thursday 4:00 pm
   Central, 24 days and 11 hours into Season 136. */
test.describe("Ladder this season vs last", () => {
  const NOW = new Date("2026-10-01T21:00:00Z");
  const PLAYER = "#20JJJ2CCRU";
  /** The reads that name a season other than the current one, or a
   *  stretch of it: the comparison's own. */
  const added = (calls: ToolCall[]) =>
    calls.filter(
      (c) =>
        (c.args.season != null && c.args.season !== "current") ||
        c.args.from === "2026-08-03T10:00:00.000Z",
    );

  test("a running season so far, beside last season to the same point and in full: counts and numbers, no verdict", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder");

    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel).toContainText("Trophy Road");
    await expect(panel).toContainText(
      "Your Trophy Road record so far this season, beside Season 135's.",
    );
    const head = panel.locator("thead th");
    await expect(head.nth(1)).toHaveText("Season 136 so far");
    await expect(head.nth(2)).toHaveText("Season 135 to the same point");
    await expect(head.nth(3)).toHaveText("All of Season 135");
    const rows = panel.locator("tbody tr");
    await expect(rows.locator("th")).toHaveText([
      "Won–lost",
      "Win rate",
      "Net trophies",
      "Decks played",
    ]);
    const cells = (i: number) => rows.nth(i).locator("td");
    // Every side shows its counts, each number over the battles it is over.
    await expect(cells(0).nth(0)).toContainText("12–23");
    await expect(cells(0).nth(0)).toContainText("12 won, 23 lost");
    await expect(cells(0).nth(0)).toContainText("35 battles");
    await expect(cells(0).nth(1)).toContainText("12–9");
    await expect(cells(0).nth(1)).toContainText("21 battles");
    await expect(cells(0).nth(2)).toContainText("28–24");
    await expect(cells(0).nth(2)).toContainText("52 battles");
    await expect(cells(1)).toHaveText([
      "34%35 battles",
      "57%21 battles",
      "54%52 battles",
    ]);
    await expect(cells(2)).toHaveText([
      "−1035 battles",
      "+5421 battles",
      "+9652 battles",
    ]);
    await expect(cells(3)).toHaveText([
      "235 battles",
      "221 battles",
      "352 battles",
    ]);

    // Fairness and its limits, said plainly.
    const foot = panel.locator(".panel__foot");
    await expect(foot).toContainText(
      "Season 135 to the same point is its first 24 days and 11 hours, to Thu Aug 27, 4:00 pm: as far into it, to the hour, as this season is now. All of Season 135 ran 35 days.",
    );
    await expect(foot).toContainText(
      "Elixir's record of you begins Wed Aug 19, partway through Season 135, so not all of that season is on record.",
    );
    await expect(foot).toContainText(
      "In Season 136 you stood on an arena floor, where a loss costs no trophies.",
    );
    await expect(foot).toContainText("A side is shown from 10 decided battles");
    await expect(foot).toContainText("they do not say why the seasons differ.");
    await expect(panel).not.toContainText(
      /improv|better|worse|good|bad|great|declin|trend|ahead|behind|score|rating|should|try /i,
    );

    // Three reads added, each once: Season 135 with its same point, and
    // the decks of each; this season's side is the page's own reads.
    const reads = added(calls);
    expect(reads).toHaveLength(3);
    expect(reads.map((c) => [c.tool, c.args])).toEqual(
      expect.arrayContaining([
        [
          "battles_performance",
          {
            player_tag: PLAYER,
            season: 135,
            mode: "ladder",
            compare_from: "2026-08-03T10:00:00.000Z",
            compare_to: "2026-08-27T21:00:00.000Z",
          },
        ],
        // The Decks page's own read of Season 135 (the same key).
        [
          "battles_decks",
          { player_tag: PLAYER, season: 135, mode: "ladder", limit: 100 },
        ],
        // limit 1: total_decks counts every deck whatever the page size.
        [
          "battles_decks",
          {
            player_tag: PLAYER,
            mode: "ladder",
            from: "2026-08-03T10:00:00.000Z",
            to: "2026-08-27T21:00:00.000Z",
            limit: 1,
          },
        ],
      ]),
    );
    // This season's decks: the deck panel's read, made once.
    expect(
      calls.filter(
        (c) =>
          c.tool === "battles_decks" &&
          c.args.season === "current" &&
          c.args.mode === "ladder" &&
          !c.args.deck_hash,
      ),
    ).toHaveLength(1);
    await accessible(page, "ladder this season vs last");
  });

  test("a mode with no battles last season says so, and reads no decks for it", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder?mode=war");
    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel).toContainText("War");
    await expect(panel).toContainText(
      "Elixir recorded no War battles in Season 135, so there is nothing to set beside this season.",
    );
    await expect(panel.locator("table")).toHaveCount(0);
    await expect(panel.locator(".panel__foot")).toContainText(
      "partway through Season 135",
    );
    // One read: Season 135 in War. With no battle, no deck read.
    expect(added(calls).map((c) => [c.tool, c.args])).toEqual([
      [
        "battles_performance",
        {
          player_tag: PLAYER,
          season: 135,
          mode: "war",
          compare_from: "2026-08-03T10:00:00.000Z",
          compare_to: "2026-08-27T21:00:00.000Z",
        },
      ],
    ]);
    await accessible(page, "ladder this season vs last, none last season");
  });

  test("this season under the minimum is not set beside last season, which is not read", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    // Events: three battles this season.
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder?mode=event");
    await expect(
      page.getByRole("region", { name: "This season vs last" }),
    ).toContainText(
      "This season has fewer than 10 decided Events battles so far, so it is not set beside Season 135 yet.",
    );
    expect(added(calls)).toEqual([]);
    await accessible(page, "ladder this season vs last, too few so far");
  });

  test("last season under the minimum is not set beside this one, and its decks are not read", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    // Six Trophy Road battles in all of Season 135.
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, {
          past: { ladder: tally(6, 2, -40) },
          samePoint: { ladder: tally(4, 1, -40) },
        }),
      }),
    );
    await page.goto("/ladder?mode=ladder");
    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel).toContainText(
      "Elixir recorded fewer than 10 decided Trophy Road battles in Season 135, so it is not set beside this season.",
    );
    await expect(panel.locator("table")).toHaveCount(0);
    expect(added(calls).map((c) => c.tool)).toEqual(["battles_performance"]);
  });

  test("last season to the same point under the minimum drops out, and all of last season stays", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, {
          samePoint: { ladder: tally(7, 3, 12) },
        }),
      }),
    );
    await page.goto("/ladder?mode=ladder");
    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel.locator("thead th")).toHaveText([
      "Number",
      "Season 136 so far",
      "All of Season 135",
    ]);
    await expect(panel.locator("tbody tr").nth(1).locator("td")).toHaveText([
      "34%35 battles",
      "54%52 battles",
    ]);
    await expect(panel.locator(".panel__foot")).toContainText(
      "Season 135 to the same point is its first 24 days and 11 hours, to Thu Aug 27, 4:00 pm: as far into it, to the hour, as this season is now. It has fewer than 10 decided Trophy Road battles, so it is not shown. All of Season 135 ran 35 days.",
    );
    // No decks read for a side that is not shown.
    expect(
      added(calls).map((c) => [c.tool, c.args.season ?? c.args.from]),
    ).toEqual([
      ["battles_performance", 135],
      ["battles_decks", 135],
    ]);
  });

  test("in a season's first hour there is no same point yet, and the foot says so", async ({
    page,
  }) => {
    // 40 minutes after Season 136 began (Monday, September 7, 10:00Z).
    await page.clock.setFixedTime(new Date("2026-09-07T10:40:00Z"));
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder?mode=ladder");
    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel.locator("thead th")).toHaveText([
      "Number",
      "Season 136 so far",
      "All of Season 135",
    ]);
    const foot = panel.locator(".panel__foot");
    await expect(foot).toContainText(
      "This season is not yet an hour old, so Season 135 to the same point is not shown: it is set beside this season from its first whole hour. All of Season 135 ran 35 days.",
    );
    await expect(foot).not.toContainText("run as long as");
    // Last season whole: the Season page's own key, and no same point.
    expect(added(calls).map((c) => [c.tool, c.args])).toEqual(
      expect.arrayContaining([
        [
          "battles_performance",
          { player_tag: PLAYER, season: 135, mode: "ladder" },
        ],
      ]),
    );
    expect(calls.some((c) => c.args.compare_from && c.args.season)).toBe(false);
    expect(calls.some((c) => c.args.from === "2026-08-03T10:00:00.000Z")).toBe(
      false,
    );
  });

  test("in a season's first hour with last season's start unknown, no same point is promised", async ({
    page,
  }) => {
    // 40 minutes into Season 136, whose start the tools name; the season
    // list names Season 135 with no start.
    await page.clock.setFixedTime(new Date("2026-09-07T10:40:00Z"));
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": explore(calls, { pastStart: false }),
      }),
    );
    await page.goto("/ladder?mode=ladder");
    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel.locator("thead th")).toHaveText([
      "Number",
      "Season 136 so far",
      "All of Season 135",
    ]);
    const foot = panel.locator(".panel__foot");
    await expect(foot).toContainText("All of Season 135 ran 35 days.");
    await expect(foot).not.toContainText("not yet an hour old");
    await expect(foot).not.toContainText("first whole hour");
    expect(calls.some((c) => c.args.compare_from && c.args.season)).toBe(false);
  });

  test("a past season sits beside the one before it, both whole, on the Season page's own reads", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    const calls: ToolCall[] = [];
    await mockApi(
      page,
      signedIn({ "POST /api/explore": explore(calls, { earlier: true }) }),
    );
    await page.goto("/ladder?mode=ladder&season=135");
    const panel = page.getByRole("region", {
      name: "Season 135 vs Season 134",
    });
    await expect(panel).toContainText(
      "Your Trophy Road record in Season 135, beside Season 134's.",
    );
    const head = panel.locator("thead th");
    await expect(head).toHaveText(["Number", "Season 135", "Season 134"]);
    const rows = panel.locator("tbody tr");
    await expect(rows.nth(0).locator("td")).toContainText(["28–24", "10–8"]);
    await expect(rows.nth(1).locator("td")).toHaveText([
      "54%52 battles",
      "56%18 battles",
    ]);
    await expect(rows.nth(2).locator("td")).toHaveText([
      "+9652 battles",
      "+6018 battles",
    ]);
    await expect(rows.nth(3).locator("td")).toHaveText([
      "352 battles",
      "118 battles",
    ]);
    const foot = panel.locator(".panel__foot");
    await expect(foot).toContainText(
      "Season 135 ran 35 days and Season 134 ran 28 days; each is read whole.",
    );
    await expect(foot).toContainText(
      "Elixir's record of you begins Thu Jul 9, partway through Season 134",
    );
    await expect(foot).not.toContainText("arena floor");
    await expect(panel).not.toContainText("so far");

    // Two reads, both the keys the Season and Decks pages use for 134.
    const of134 = () =>
      calls.filter((c) => c.args.season === 134).map((c) => [c.tool, c.args]);
    expect(of134()).toEqual(
      expect.arrayContaining([
        [
          "battles_performance",
          { player_tag: PLAYER, season: 134, mode: "ladder" },
        ],
        [
          "battles_decks",
          { player_tag: PLAYER, season: 134, mode: "ladder", limit: 100 },
        ],
      ]),
    );
    expect(of134()).toHaveLength(2);
    await accessible(page, "ladder a past season vs the one before");

    // Opening Season 134 reads its record from the same cache entry.
    await page.getByLabel("Season", { exact: true }).selectOption("134");
    await expect(page).toHaveURL(/\/ladder\?mode=ladder&season=134$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Season 134" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Season 134 vs the season before" }),
    ).toContainText(
      "Elixir's record of you holds no season before Season 134, so there is nothing to set beside it.",
    );
    expect(
      calls.filter(
        (c) =>
          c.tool === "battles_performance" &&
          c.args.season === 134 &&
          c.args.mode === "ladder" &&
          !c.args.group_by,
      ),
    ).toHaveLength(1);
  });

  test("the first season on record has none before it, and reads nothing for one", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    const calls: ToolCall[] = [];
    await mockApi(page, signedIn({ "POST /api/explore": explore(calls) }));
    await page.goto("/ladder?mode=ladder&season=135");
    await expect(
      page.getByRole("region", { name: "Season 135 vs the season before" }),
    ).toContainText(
      "Elixir's record of you holds no season before Season 135, so there is nothing to set beside it.",
    );
    expect(calls.some((c) => c.args.season === 134)).toBe(false);
    await accessible(page, "ladder no season before");
  });

  test("@narrow the season table fits a phone, three sides and all", async ({
    page,
  }) => {
    await page.clock.setFixedTime(NOW);
    await mockApi(page, signedIn({ "POST /api/explore": explore() }));
    await page.goto("/ladder");
    const panel = page.getByRole("region", { name: "This season vs last" });
    await expect(panel.locator("thead th")).toHaveCount(4);
    await expect(panel.locator("tbody tr")).toHaveCount(4);
    await panel.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await accessible(page, "ladder this season vs last narrow");
  });
});
