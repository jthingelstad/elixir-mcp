import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi } from "./fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";
import { HOME, homeApi } from "./home-fixture.ts";

/**
 * The canvas's remaining social pieces (2026-11-12): People to follow and
 * this week's race on Home's side, cheers on a player page and a battle
 * page (only for items in your own feed), and Find's sections. Desktop and
 * phone widths, axe on each, nothing scrolling sideways. Invented players.
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

const SUGGESTED = {
  ok: true,
  used: 3,
  limit: 50,
  people: [
    {
      tag: "#0JYQYV0",
      name: "Hedy",
      why: [
        { kind: "battles", against: 2, with_you: 0, days: 7 },
        { kind: "clan", clan_name: "Ada's Clan" },
      ],
      free: false,
      reason: null,
    },
    {
      tag: "#0GPY999",
      name: "Edsger",
      why: [
        {
          kind: "followed_by",
          via: { tag: "#00C298UC", name: "Ada" },
          others: 0,
        },
      ],
      free: true,
      reason: "followed_by_others",
    },
  ],
};

const CLAN_RACE = {
  ...HOME.clan,
  race_now: {
    season_id: 137,
    section_index: 1,
    is_colosseum: false,
    day_kind: "war",
    war_day: 2,
    finished: false,
    place: 2,
    fame: 8200,
  },
};

const ADA = {
  player: {
    tag: "#00C298UC",
    name: "Ada",
    clan_tag: "#0JQ0JQ8",
    clan_name: "Grove",
    trophies: 9400,
    recorded: true,
  },
  you: { own: false, following: true, relationship: "friend", clanmate: null },
  badges: { verified_player: true, discord: false },
  follows: { count: 0, players: [] },
  followers: { count: 1, players: [], unnamed: 1 },
  window_days: 30,
  timeline: [
    {
      id: "tl_00000000000000000001",
      kind: "pol_league_up",
      at: "2026-11-10T14:00:00.000Z",
      text: "Reached Path of Legends.",
    },
    {
      id: "tl_00000000000000000002",
      kind: "badge_earned",
      at: "2026-10-01T14:00:00.000Z",
      text: "Earned a badge.",
    },
  ],
  timeline_more: 0,
  moments: [],
  highlights: [],
};

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("Home's side: People to follow, each with why and its cost, and this week's race", async ({
      page,
    }) => {
      const costs: string[] = [];
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await mockApi(
        page,
        homeApi({
          "GET /api/me/home/clan": [200, { clan: CLAN_RACE }],
          "GET /api/me/follow-cost": (route) => {
            costs.push(route.request().url());
            return [404, { error: "unexpected" }];
          },
        }),
      );
      // Registered after mockApi, so it answers first: the panel's read is
      // held until the feed has painted.
      await page.route("**/api/me/people/suggested", async (route) => {
        await held;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(SUGGESTED),
        });
      });
      await page.goto("/home");
      const feed = page.locator(".kit-feed");
      await expect(feed.getByText("Won 3 of 5 in Trophy Road.")).toBeVisible();
      release();

      const panel = page.locator(".panel").filter({
        has: page.getByRole("heading", { name: "People to follow" }),
      });
      await expect(
        panel.getByRole("link", { name: "Hedy", exact: true }),
      ).toHaveAttribute("href", "/home/player/0JYQYV0");
      await expect(
        panel.getByText("You played them twice this week · In your clan"),
      ).toBeVisible();
      await expect(panel.getByText("Uses a slot")).toBeVisible();
      await expect(panel.getByText("Ada follows them")).toBeVisible();
      await expect(panel.getByText("Free · already recorded")).toBeVisible();
      await expect(
        panel.getByText("Your follows: 3 of 50 slots"),
      ).toBeVisible();
      await expect(
        panel.getByRole("link", { name: "Find more people" }),
      ).toHaveAttribute("href", "/home/find");
      // Priced from the panel's own read: no cost request per person.
      expect(costs).toEqual([]);
      await expect(
        page.getByText(
          "Season 137, week 2, war day 2: 2nd by fame, 8,200 fame",
        ),
      ).toBeVisible();

      // On a phone the side panels go below the feed.
      const feedBox = await feed.boundingBox();
      const panelBox = await panel.boundingBox();
      if (width === 390)
        expect(panelBox!.y).toBeGreaterThan(feedBox!.y + feedBox!.height - 1);
      else expect(panelBox!.x).toBeGreaterThan(feedBox!.x);
      await noSideways(page);
      await accessible(page, "Home, People to follow");
    });

    test("a player page: cheers only on the items in your own feed", async ({
      page,
    }) => {
      const sent: unknown[] = [];
      await mockApi(
        page,
        homeApi({
          "GET /api/player": [200, ADA],
          "GET /api/me/cheers": [
            200,
            {
              ok: true,
              items: [
                {
                  id: "tl_00000000000000000001",
                  kind: "pol_league_up",
                  at: "2026-11-10T14:00:00.000Z",
                  text: "Reached Path of Legends.",
                  cheers: { on_fire: 1 },
                  my_cheer: null,
                },
              ],
              subjects: ["#00C298UC", "#0JQ0JQ8"],
            },
          ],
          "PUT /api/me/cheers": (route) => {
            sent.push(route.request().postDataJSON());
            return [
              200,
              {
                item_id: "tl_00000000000000000001",
                cheers: { on_fire: 2 },
                my_cheer: "on_fire",
              },
            ];
          },
        }),
      );
      await page.goto("/home/player/00C298UC");
      await expect(
        page.getByRole("heading", { level: 1, name: "Ada" }),
      ).toBeVisible();
      // Each item is its own card (canvas Player .item, 2026-11-13).
      const legends = page
        .locator(".kit-pitem")
        .filter({ hasText: "Reached Path of Legends." });
      const badge = page
        .locator(".kit-pitem")
        .filter({ hasText: "Earned a badge." });
      await expect(legends.getByText("1 person")).toBeVisible();
      // An item older than your feed's week takes no cheers and shows none.
      await expect(badge).toBeVisible();
      await expect(badge.getByRole("button", { name: "Cheer" })).toHaveCount(0);
      await legends.getByRole("button", { name: "Cheer" }).click();
      await accessible(page, "player page, cheer picker");
      await legends
        .getByRole("group", { name: "Choose a cheer" })
        .getByRole("button", { name: /On fire/ })
        .click();
      await expect(
        legends.getByRole("button", { name: "On fire, 2, yours" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(sent).toEqual([
        {
          item_id: "tl_00000000000000000001",
          cheer: "on_fire",
          subjects: ["#00C298UC", "#0JQ0JQ8"],
        },
      ]);
      await noSideways(page);
      await accessible(page, "player page, cheered");
    });

    test("a battle page: its highlight's cheers signed in, nothing signed out", async ({
      page,
    }) => {
      const asked: string[] = [];
      const sent: unknown[] = [];
      let authed = true;
      const route = `GET /api/public/battles/${BATTLE.battle.short_id}`;
      await mockApi(page, {
        "GET /api/me": () => [200, authed ? ME : SIGNED_OUT],
        "GET /api/me/home/needs": [200, { needs: { ok: true, state: "none" } }],
        [route]: [200, BATTLE],
        "GET /api/me/cheers": (r) => {
          asked.push(new URL(r.request().url()).search);
          return [
            200,
            {
              ok: true,
              items: [
                {
                  id: "tl_00000000000000000003",
                  kind: "highlight",
                  at: "2026-09-03T14:20:00.000Z",
                  text: "Posted a highlight: a three-crown win.",
                  cheers: { royal: 2 },
                  my_cheer: null,
                },
              ],
              subjects: ["#00C298UC"],
            },
          ];
        },
        "PUT /api/me/cheers": (r) => {
          sent.push(r.request().postDataJSON());
          return [
            200,
            {
              item_id: "tl_00000000000000000003",
              cheers: { royal: 2, wow: 1 },
              my_cheer: "wow",
            },
          ];
        },
      });
      await page.goto(`/battle/${BATTLE.battle.short_id}`);
      const cheers = page.getByRole("region", { name: "Cheers" });
      await expect(
        cheers.getByText("Posted a highlight: a three-crown win."),
      ).toBeVisible();
      await expect(cheers.getByText("2 people")).toBeVisible();
      expect(asked).toEqual([`?battle=${BATTLE.battle.id}`]);
      await cheers.getByRole("button", { name: "Cheer" }).click();
      await cheers
        .getByRole("group", { name: "Choose a cheer" })
        .getByRole("button", { name: /Wow/ })
        .click();
      await expect(
        cheers.getByRole("button", { name: "Wow, 1, yours" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(sent).toEqual([
        {
          item_id: "tl_00000000000000000003",
          cheer: "wow",
          subjects: ["#00C298UC"],
        },
      ]);
      await noSideways(page);
      await accessible(page, "battle page, cheers");

      // Signed out: no cheers, no counts, and no cheers read at all.
      authed = false;
      asked.length = 0;
      await page.goto(`/battle/${BATTLE.battle.short_id}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Join Elixir" }),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: "Cheers" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Cheer" })).toHaveCount(0);
      expect(asked).toEqual([]);
      await accessible(page, "battle page, signed out");
    });

    test("Find: Your clan, From your battles, and no Near you", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me/people/clan": [
            200,
            {
              ok: true,
              clan: { clan_tag: "#0QC8RCGY", name: "Ada's Clan" },
              players: [
                {
                  player_tag: "#0JYQYV0",
                  name: "Hedy",
                  following: false,
                  free: false,
                  reason: null,
                  role: "member",
                },
                {
                  player_tag: "#00C298UC",
                  name: "Ada",
                  following: true,
                  free: true,
                  reason: null,
                  role: "elder",
                },
              ],
              yours: ["#20JJJ2CCRU"],
              to_follow: 1,
              free: 0,
              slots: 1,
              following: 1,
              used: 3,
              limit: 50,
              fits: true,
            },
          ],
          "GET /api/me/people/battles": [
            200,
            {
              ok: true,
              days: 30,
              people: [
                {
                  tag: "#0GPY999",
                  name: "Edsger",
                  against: 3,
                  with_you: 0,
                  wins: 2,
                  losses: 1,
                  draws: 0,
                  last_met: "2026-11-11T14:00:00.000Z",
                  following: false,
                  free: true,
                  reason: "recorded",
                },
                {
                  tag: "#00C298UC",
                  name: "Ada",
                  against: 0,
                  with_you: 2,
                  wins: 0,
                  losses: 0,
                  draws: 0,
                  last_met: "2026-11-09T14:00:00.000Z",
                  following: true,
                  free: true,
                  reason: null,
                },
              ],
              more: 0,
              used: 3,
              limit: 50,
            },
          ],
        }),
      );
      await page.goto("/home/find");
      const find = page.getByRole("tablist", { name: "Find" });
      await expect(find.getByRole("tab")).toHaveText([
        "Your clan",
        "Search",
        "From your battles",
        "Clan directory",
        "Your link",
      ]);
      await expect(page.getByText(/Near you/)).toHaveCount(0);

      // Search is where Find opens: the phone's search, and a tag to follow.
      await expect(find.getByRole("tab", { name: "Search" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByLabel("Follow a friend")).toBeVisible();

      // Your clan: its members, what each costs, and Follow my clan.
      await find.getByRole("tab", { name: "Your clan" }).click();
      await expect(
        page.getByRole("button", { name: "Follow my clan" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Hedy", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Uses a slot", { exact: true }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "Find, Your clan");

      await find.getByRole("tab", { name: "From your battles" }).click();
      await expect(
        page.getByRole("heading", {
          name: "From your battle log, last 30 days",
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/^Met 3 times · 2 wins, 1 loss · last /),
      ).toBeVisible();
      await expect(
        page.getByText("Free · already recorded", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Your 2v2 teammate twice")).toBeVisible();
      await expect(
        page.getByText("No ratings, no guesses.", { exact: false }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "Find, From your battles");
    });
  });
}
