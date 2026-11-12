import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, SIGNED_OUT } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import { explore } from "./ladder-fixture.ts";

/**
 * The canvas's remaining shell pieces (2026-11-12): the signed-out shell
 * (Docs, Sign in, Create account; the front page is the way in), You with
 * Stats (your verified player's page, Ladder as its Stats tab, every old
 * Ladder address landing there) and the bell's own sections (reactions as
 * counts, followers, answers). Desktop and phone widths, with axe.
 * Invented players only.
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

const TAG = "#2YQLRP8V";
const VERIFIED_ME = {
  ...ME,
  claims: [
    {
      player_tag: TAG,
      name: "Invented Owl",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
    {
      player_tag: "#9PQ2R8L",
      name: "Invented Alt",
      is_primary: false,
      relationship: "alt",
      status: "pending",
    },
  ],
};

const PAGE = {
  player: {
    tag: TAG,
    name: "Invented Owl",
    clan_tag: "#9GQLV20",
    clan_name: "Grove",
    trophies: 9400,
    recorded: true,
  },
  you: { own: true, following: false, relationship: "primary", clanmate: null },
  badges: { verified_player: true, discord: false },
  follows: { count: 0, players: [] },
  followers: { count: 0, players: [], unnamed: 0 },
  window_days: 30,
  timeline: [
    {
      id: "t1",
      kind: "pol_league_up",
      at: "2026-11-10T14:00:00.000Z",
      text: "Reached Path of Legends.",
    },
  ],
  timeline_more: 0,
  moments: [],
  highlights: [],
};

const BELL = {
  seen_at: "2026-11-11T12:00:00.000Z",
  players: 1,
  new: 3,
  reactions: {
    new: 1,
    items: [
      {
        item_id: "tl_0123456789abcdef0123",
        text: "Invented Owl won five in a row",
        at: "2026-11-12T10:00:00.000Z",
        battle_url: null,
        cheers: { on_fire: 2, royal: 1 },
        total: 3,
        new: true,
      },
    ],
  },
  followers: {
    count: 3,
    new: 1,
    unnamed: 2,
    players: [
      {
        tag: "#8QRLV2YP",
        name: "Invented Fan",
        followed_tag: TAG,
        followed_name: "Invented Owl",
        new: true,
      },
    ],
  },
  answers: {
    new: 1,
    items: [
      {
        id: 42,
        about: "The war tab is slow on a phone",
        status: "planned",
        responded_at: "2026-11-11T10:00:00.000Z",
        new: true,
      },
    ],
  },
};

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("signed out: Docs, Sign in and Create account, the way in, and the footer", async ({
      page,
    }) => {
      await page.goto("/");
      const bar = page.locator(".kit-top");
      await expect(
        bar.locator('.kit-top__out[data-session-face="out"] a'),
      ).toHaveText(["Docs"]);
      await expect(bar.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        "/signin",
      );
      await expect(
        bar.getByRole("link", { name: "Create account" }),
      ).toHaveAttribute("href", "/signin?signup");
      await expect(bar.getByRole("link", { name: /Play Drop/ })).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Keep up with your friends in Clash Royale",
        }),
      ).toBeVisible();
      const gate = page.locator("main");
      await expect(
        gate.getByRole("link", { name: "Create an account" }),
      ).toHaveAttribute("href", "/signin?signup");
      await expect(
        gate.getByRole("link", { name: "Sign in", exact: true }),
      ).toHaveAttribute("href", "/signin");
      const foot = page.locator("footer.kit-foot");
      for (const [name, href] of [
        ["Cards", "/cards"],
        ["Updates", "/updates"],
      ] as const)
        await expect(
          foot.getByRole("link", { name, exact: true }),
        ).toHaveAttribute("href", href);
      await expect(
        foot.getByRole("link", { name: /Play Drop/ }),
      ).toHaveAttribute("target", "_blank");
      await noSideways(page);
      await accessible(page, "signed-out front page");
    });

    test("signed out in the app: the same bar", async ({ page }) => {
      await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
      await page.goto("/home/you/stats");
      await expect(
        page.getByRole("heading", { name: "Your season, read back" }),
      ).toBeVisible();
      const nav = page
        .locator(".kit-top")
        .getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link")).toHaveText(["Docs"]);
      await expect(
        page.locator(".kit-top").getByRole("link", { name: /Play Drop/ }),
      ).toHaveCount(0);
      await noSideways(page);
      await accessible(page, "signed-out app bar");
    });

    test("You: your verified player's page, Stats as its last tab, your other players to you", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, VERIFIED_ME],
          "GET /api/player": [200, PAGE],
          "POST /api/explore": explore(),
        }),
      );
      await page.goto("/home/you");
      await expect(
        page.getByRole("heading", { level: 1, name: "Invented Owl" }),
      ).toBeVisible();
      await expect(page.getByText("Reached Path of Legends.")).toBeVisible();
      const others = page.getByRole("region", { name: "Your other players" });
      await expect(others).toContainText("Invented Alt");
      await expect(others).toContainText("not verified");
      await noSideways(page);
      await accessible(page, "You");

      await page.getByRole("tab", { name: "Stats" }).click();
      await expect(page).toHaveURL(/\/home\/you\/stats$/);
      await expect(page).toHaveTitle("Season - Stats - Elixir");
      const tabs = page.getByRole("tablist", { name: "You" });
      await expect(tabs.getByRole("tab", { name: "Stats" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // Stats is Ladder unchanged: its scope bar and its four tabs.
      await expect(page.getByRole("group", { name: "Mode" })).toBeVisible();
      await expect(
        page.getByRole("tablist", { name: "Stats" }).getByRole("tab"),
      ).toHaveText(["Season", "Battles", "Decks", "Cards"]);
      await noSideways(page);
      await accessible(page, "You, Stats");

      // Back to the player page by its tab.
      await tabs.getByRole("tab", { name: "Moments" }).click();
      await expect(page).toHaveURL(/\/home\/you\?tab=moments$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Invented Owl" }),
      ).toBeVisible();
    });

    test("an old Ladder address lands on Stats, its player and mode kept", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, VERIFIED_ME],
          "POST /api/explore": explore(),
        }),
      );
      await page.goto("/ladder/cards?mode=war");
      await expect(page).toHaveURL(/\/home\/you\/stats\/cards\?mode=war$/);
      await expect(page).toHaveTitle("Cards - Stats - Elixir");
      await page.goto("/ladder");
      await expect(page).toHaveURL(/\/home\/you\/stats$/);
    });

    test("the bell: cheers as counts, followers named or counted, answers; opening it marks them seen", async ({
      page,
    }) => {
      const seen: string[] = [];
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, VERIFIED_ME],
          "GET /api/me/bell": [200, BELL],
          "PUT /api/me/bell/seen": (route) => {
            seen.push(route.request().method());
            return [200, { seen_at: "2026-11-12T12:00:00.000Z" }];
          },
        }),
      );
      await page.goto("/home");
      const bell =
        width === 390
          ? page
              .getByRole("navigation", { name: "Main, phone" })
              .getByRole("button", { name: /Bell/ })
          : page.getByRole("button", { name: /^Notifications, \d+ new$/ });
      await expect(bell.locator(".kit-bell__dot")).toBeVisible();
      await bell.click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      const reactions = sheet.getByRole("region", {
        name: "Reactions to your items",
      });
      await expect(reactions).toContainText("Invented Owl won five in a row");
      await expect(reactions.getByLabel("On fire 2, Royal 1")).toBeVisible();
      await expect(reactions).toContainText("Counts only: never who cheered.");
      const followers = sheet.getByRole("region", { name: "New followers" });
      await expect(
        followers.getByRole("link", { name: /Invented Fan/ }),
      ).toHaveAttribute("href", "/home/player/8QRLV2YP");
      await expect(followers).toContainText("2 more accounts follow you");
      const answers = sheet.getByRole("region", {
        name: "Answers to your feedback",
      });
      await expect(
        answers.getByRole("link", { name: /The war tab is slow/ }),
      ).toHaveAttribute("href", "/settings/feedback/42");
      await expect(
        sheet.getByRole("region", { name: "Needs you" }),
      ).toBeVisible();
      await expect.poll(() => seen.length).toBe(1);
      await noSideways(page);
      await accessible(page, "the bell's sections");
    });
  });
}
