import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { HOME, homeApi, ownerPassport } from "./home-fixture.ts";
import { ADA } from "./player-fixture.ts";

const SHARED = { clan_tag: "#0U082URG", name: "Willow Guild" };
const ALT_CLAN = { clan_tag: "#0LJR0G22", name: "Birch Guild" };
const MATE = {
  tag: ADA.player.tag,
  name: ADA.player.name,
  following: false,
  connection: "clanmate",
  clanmate: SHARED.clan_tag,
  shared_clan: SHARED,
  close: false,
};
const shots = process.env.CLANMATE_SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots)
    await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
async function noSideways(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}
async function target(control: Locator) {
  const box = await control.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}
async function accessible(page: Page, include: string) {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
}

for (const width of [320, 390, 1280]) {
  test(`clanmate becomes Friend and Close friend, then remains clanmate after Unfriend at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let friend = false;
    let close = false;
    const writes: unknown[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(
      page,
      homeApi({
        "GET /api/player": () => [
          200,
          {
            ...ADA,
            player: { ...ADA.player, clan_tag: null, clan_name: null },
            claimants: [
              {
                id: "aa000000-0000-0000-0000-000000000001",
                verified: true,
                relationship: "primary",
                player: { tag: ADA.player.tag, name: "Ada" },
              },
            ],
            you: {
              ...ADA.you,
              ...MATE,
              following: friend,
              relationship: friend ? "friend" : null,
              connection: friend ? "friend" : "clanmate",
              pair: friend,
              close,
            },
          },
        ],
        "GET /api/me/follow-cost": [
          200,
          {
            player_tag: ADA.player.tag,
            following: false,
            free: true,
            reason: "recorded",
            used: 3,
            limit: 50,
          },
        ],
        "POST /api/claims": (route) => {
          const body = route.request().postDataJSON();
          writes.push(body);
          if (body.action === "close_on") close = true;
          else if (body.action === "remove") {
            friend = false;
            close = false;
          } else friend = true;
          return [
            200,
            {
              ok: true,
              player_tag: ADA.player.tag,
              relationship: friend ? "friend" : null,
              close,
            },
          ];
        },
      }),
    );
    await page.goto(`/home/player/${ADA.player.tag.slice(1)}`);
    const head = page.getByRole("navigation", {
      name: "More about this player",
    });
    const state = page.locator(
      ".kit-clanmate-connection .kit-connection-state__primary",
    );
    await expect(state).toHaveText("Clanmate");
    await expect(page.locator(".kit-clanmate-connection")).toContainText(
      SHARED.name,
    );
    await expect(page.locator(".kit-phead__line")).toContainText(SHARED.name);
    await expect(page.locator(".kit-phead__line")).not.toContainText("No clan");
    await expect(
      page.getByText("No account has claimed this player", { exact: false }),
    ).toHaveCount(0);
    await expect(
      head.getByRole("button", { name: /close friend/ }),
    ).toHaveCount(0);
    await expect(head.getByRole("link", { name: "Their stats" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("tab", { name: "Clan", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Together", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Followed on Elixir", { exact: false }),
    ).toHaveCount(0);
    const add = head.getByRole("button", { name: "Friend", exact: true });
    await target(add);
    await noSideways(page);
    await shot(page, `clanmate-${width}`);
    await accessible(page, ".kit-player");
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Friend Ada?" });
    await expect(dialog).toContainText(
      "Clanmates' posts and questions appear in your Timeline automatically",
    );
    expect(writes).toEqual([]);
    const confirm = dialog.getByRole("button", { name: "Friend", exact: true });
    await target(confirm);
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(state).toHaveText("Friend");
    await expect(head.getByRole("link", { name: "Their stats" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Together", exact: true }),
    ).toBeVisible();
    await shot(page, `friend-${width}`);
    const mark = head.getByRole("button", { name: "Mark Ada a close friend" });
    await target(mark);
    await mark.focus();
    await page.keyboard.press("Enter");
    await expect(state).toHaveText("Close friend");
    await expect(
      head.getByRole("button", { name: "Ada: close friend" }),
    ).toHaveAttribute("aria-pressed", "true");
    await shot(page, `close-${width}`);
    await accessible(page, ".kit-player");
    await head.getByRole("button", { name: "Friend", exact: true }).click();
    const remove = page.getByRole("dialog", { name: "Unfriend Ada?" });
    await expect(remove).toContainText("clanmate connection stays");
    await remove.getByRole("button", { name: "Unfriend", exact: true }).click();
    await expect(state).toHaveText("Clanmate");
    await expect(
      head.getByRole("button", { name: /close friend/ }),
    ).toHaveCount(0);
    await noSideways(page);
    await shot(page, `unfriend-${width}`);
    expect(writes).toEqual([
      { player_tag: ADA.player.tag, relationship: "friend" },
      { action: "close_on", player_tag: ADA.player.tag },
      { player_tag: ADA.player.tag, action: "remove" },
    ]);
    expect(errors).toEqual([]);
  });

  test(`Find groups automatic clanmates from each verified player at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(
      page,
      homeApi({
        "GET /api/me/people/clan": [
          200,
          {
            ok: true,
            clans: [SHARED, ALT_CLAN],
            players: [
              { ...MATE, player_tag: MATE.tag },
              {
                ...MATE,
                tag: "#02G2PJC0",
                player_tag: "#02G2PJC0",
                name: "Cedar",
                shared_clan: ALT_CLAN,
                clanmate: ALT_CLAN.clan_tag,
                connection: "friend",
                following: true,
                close: true,
              },
            ],
            used: 3,
            limit: 50,
          },
        ],
      }),
    );
    await page.goto("/home/find");
    await page.getByRole("tab", { name: "Your clan", exact: true }).click();
    const list = page.locator(".kit-clanpeople-list");
    await expect(list).toContainText(SHARED.name);
    await expect(list).toContainText(ALT_CLAN.name);
    await expect(
      list.getByRole("button", { name: /Follow|Friend/ }),
    ).toHaveCount(0);
    await expect(list.locator(".kit-connection-state__primary")).toHaveText([
      "Clanmate",
      "Close friend",
    ]);
    const link = list.getByRole("link", { name: "Ada", exact: true });
    await expect(link).toHaveAttribute(
      "href",
      `/home/player/${ADA.player.tag.slice(1)}`,
    );
    await link.focus();
    await expect(link).toBeFocused();
    await noSideways(page);
    await accessible(page, ".kit-clanpeople-list");
    await shot(page, `find-${width}`);
  });

  test(`onboarding shows connected clanmates before the first battle without a friend prompt at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const now = new Date("2026-11-18T17:00:00Z");
    await page.clock.setFixedTime(now);
    const first = {
      ...HOME.first,
      as_of: now.toISOString(),
      player: {
        ...HOME.first.player,
        profile_available: true,
        tracked_since: now.toISOString(),
        verified: true,
        battlelog_observed_at: null,
        last_battle_at: null,
        battles_30d: 0,
      },
      setup: { following: 0, following_played: 0 },
    };
    await mockApi(
      page,
      homeApi({
        "GET /api/me/home": [200, { first }],
        "GET /api/me/first-answer": [200, first],
        "GET /api/me/people/onboarding": [
          200,
          { state: "ready", may_request: false, poll_ms: null },
        ],
        "GET /api/me/people/starter": [
          200,
          {
            ok: true,
            offer: false,
            people: [],
            clanmate_count: 3,
            clanmates: [
              MATE,
              {
                ...MATE,
                tag: "#02G2PJC0",
                name: "Cedar",
                connection: "friend",
              },
              {
                ...MATE,
                tag: "#0LJR0G22",
                name: "Birch",
                connection: "friend",
                close: true,
              },
            ],
            used: 0,
            limit: 50,
          },
        ],
        "GET /api/me/passport": [200, ownerPassport([], { complete: true })],
      }),
    );
    await page.goto("/timeline");
    const connected = page.getByRole("region", {
      name: "Your clanmate connections",
    });
    await expect(
      connected.getByRole("heading", { name: "3 clanmates connected" }),
    ).toBeVisible();
    await expect(connected).toContainText("Ada");
    await expect(connected).toContainText("Close friend");
    await expect(connected.getByRole("checkbox")).toHaveCount(0);
    await expect(
      connected.getByRole("button", { name: /Friend|Follow/ }),
    ).toHaveCount(0);
    const open = connected.getByRole("button", {
      name: "Open Timeline",
      exact: true,
    });
    await target(open);
    await open.focus();
    await expect(open).toBeFocused();
    await noSideways(page);
    await accessible(page, ".kit-starter--connected");
    await shot(page, `onboarding-${width}`);
    await page.keyboard.press("Enter");
    await expect(connected).toBeHidden();
  });
}

test("a blocked canonical clanmate has no Friend or Close controls", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/player": [
        200,
        {
          ...ADA,
          you: {
            ...ADA.you,
            ...MATE,
            connection: "friend",
            following: true,
            blocked: true,
          },
        },
      ],
    }),
  );
  await page.goto(`/home/player/${ADA.player.tag.slice(1)}`);
  const head = page.getByRole("navigation", { name: "More about this player" });
  await expect(head).toContainText("Blocked");
  await expect(
    head.getByRole("button", { name: /Friend|close friend/ }),
  ).toHaveCount(0);
  await expect(page.locator(".kit-clanmate-connection")).toHaveCount(0);
});
