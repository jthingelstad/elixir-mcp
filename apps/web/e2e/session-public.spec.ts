import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import { BATTLE } from "./battle-fixture.ts";
import {
  SHARED_ID,
  SHARED_MEMBER,
  SHARED_NAME,
  SHARED_PUBLIC,
  SHARED_START,
  SHARED_TAG,
  HOG,
} from "./session-fixture.ts";

// Public links name one capability, never a player, a session window or
// an anonymous path into the surrounding battle history.
const CAPABILITY = "abcdefghijklmnopqrstuvwx";
const PATH = `/share/${CAPABILITY}`;
const API = `/api/public/shared-items/${CAPABILITY}`;
const URL = `https://elixir.poapkings.com${PATH}`;
const HEADLINE = "Won 8 of 12 on Trophy Road, 5 in a row";
const ITEM = {
  ...SHARED_PUBLIC.item,
  visibility: "public",
  section: "player",
  subjects: [{ kind: "player", tag: SHARED_TAG, name: SHARED_NAME }],
};
const PUBLIC = { item: ITEM, url: URL };
const MEMBER_PATH = `/home/player/${SHARED_TAG.slice(1)}/session/${SHARED_ID}`;
const SHOTS = process.env.SHARE_SESSION_SHOTS;
const publicReads = {
  "GET /api/me": [200, SIGNED_OUT] as [number, unknown],
  [`GET ${API}`]: [200, PUBLIC] as [number, unknown],
};

async function noSideways(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
}

for (const [label, width, tag] of [
  ["320", 320, "@narrow "],
  ["phone", 390, "@narrow "],
  ["wide", 1280, ""],
] as const) {
  test(`${tag}${label}: opaque share shows one session item and the way in`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(page, publicReads);
    await page.goto(PATH);
    await expect(
      page.getByRole("heading", { level: 1, name: "Shared on Elixir" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Shared Timeline item - Elixir");
    await expect(page.locator(".kit-scard__head")).toHaveText(HEADLINE);
    await expect(page.locator(".kit-feed__name")).toHaveText(SHARED_NAME);
    await expect(
      page.locator(
        ".kit-feed__name a, .kit-feed__name i, .kit-player-name, .kit-verified",
      ),
    ).toHaveCount(0);
    await expect(page.locator("article.kit-feed__item")).toHaveCount(1);
    await expect(
      page.locator(".kit-session__games, .kit-session__deck"),
    ).toHaveCount(0);
    await expect(
      page.locator(
        '.kit-feed a[href^="/battle/"], .kit-feed a[href^="/home/player/"], .kit-scard[href]',
      ),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Comments" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Follow from here" }),
    ).toHaveCount(0);
    const invite = page.getByRole("region", { name: "See more on Elixir" });
    const back = encodeURIComponent(PATH);
    await expect(
      invite.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", `/signin?signup&return_to=${back}`);
    await expect(invite.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/signin?return_to=${back}`,
    );
    for (const name of ["Create an account", "Sign in"])
      expect(
        (await invite.getByRole("link", { name }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    await noSideways(page);
    await accessible(page);
    await expect(page.locator("vite-error-overlay, nextjs-portal")).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/public-${width}.png`,
        fullPage: true,
      });
  });
}

test("a missing capability says so without an item or anonymous history", async ({
  page,
}) => {
  await mockApi(page, {
    ...publicReads,
    [`GET ${API}`]: [404, { error: "not_found" }],
  });
  await page.goto(PATH);
  await expect(
    page.getByRole("heading", { name: "No item at this link" }),
  ).toBeVisible();
  await expect(page.locator(".kit-feed__item")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Create an account" }),
  ).toBeVisible();
});

test("a member session URL stays behind sign-in instead of minting a public capability", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/public/")) requested.push(request.url());
  });
  await mockApi(page, publicReads);
  await page.goto(
    `${MEMBER_PATH}?at=${encodeURIComponent(new Date(SHARED_START * 1000).toISOString())}`,
  );
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".kit-scard, .kit-session__games")).toHaveCount(0);
  expect(requested).toEqual([]);
});

test("signed-in share viewers remain on the one-item page with an explicit way to their Timeline", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({ "GET /api/me": [200, ME], [`GET ${API}`]: [200, PUBLIC] }),
  );
  await page.goto(PATH);
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(page.locator(".kit-scard__head")).toHaveText(HEADLINE);
  await expect(
    page.getByRole("link", { name: "Open your Timeline" }),
  ).toHaveAttribute("href", "/timeline");
  await expect(page.getByRole("region", { name: "Comments" })).toHaveCount(0);
  await expect(page.locator(".kit-feed__foot, .kit-verified")).toHaveCount(0);
});

test("signing in returns to the same opaque item, without opening member history", async ({
  page,
}) => {
  let authed = false;
  await mockApi(
    page,
    signedIn({
      ...homeApi(),
      "GET /api/me": () => [200, authed ? ME : SIGNED_OUT],
      [`GET ${API}`]: [200, PUBLIC],
      "POST /api/auth": [200, { ok: true }],
      "POST /api/auth/code": () => {
        authed = true;
        return [200, { authenticated: true }];
      },
    }),
  );
  await page.goto(PATH);
  await page
    .getByRole("region", { name: "See more on Elixir" })
    .getByRole("link", { name: "Sign in" })
    .click();
  await page.getByLabel("Email", { exact: true }).fill("someone@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(
    page.getByRole("link", { name: "Open your Timeline" }),
  ).toBeVisible();
  await expect(page.locator(".kit-session__games")).toHaveCount(0);
});

for (const width of [320, 390, 1280]) {
  test(`public post and battle stay one item at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const postId = "bbcdefghijklmnopqrstuvwx";
    const battleId = "cbcdefghijklmnopqrstuvwx";
    const battle = { ...BATTLE.battle, url: undefined, image: undefined };
    const post = {
      id: "tl_1123456789abcdef0123",
      kind: "post",
      at: ITEM.at,
      subjects: [{ kind: "player", tag: SHARED_TAG, name: SHARED_NAME }],
      post: {
        text: "Two pushes at the end.",
        question: true,
        author: { player_tag: SHARED_TAG, name: SHARED_NAME },
        battle: {
          crowns: 2,
          crowns_against: 1,
          outcome: "win",
          mode_group: "ladder",
          opponents: [{ name: "Birch Lantern" }],
        },
        versus: { mine: HOG, theirs: HOG },
      },
    };
    await mockApi(page, {
      "GET /api/me": [200, SIGNED_OUT],
      [`GET /api/public/shared-items/${postId}`]: [200, { item: post }],
      [`GET /api/public/shared-items/${battleId}`]: [
        200,
        {
          item: {
            kind: "battle",
            id: "tl_2123456789abcdef0123",
            at: BATTLE.battle.battle_time,
            battle,
            sides: BATTLE.sides,
          },
        },
      ],
    });
    await page.goto(`/share/${postId}`);
    await expect(page.getByText("Two pushes at the end.")).toBeVisible();
    await expect(page.locator(".kit-vs .kit-deckrow")).toHaveCount(2);
    await expect(
      page.locator(".kit-feed__foot, .kit-player-name, .kit-verified"),
    ).toHaveCount(0);
    await expect(
      page.locator(
        '.kit-feed__item a[href^="/battle/"], .kit-feed__item a[href^="/home/"]',
      ),
    ).toHaveCount(0);
    await noSideways(page);
    await accessible(page);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/post-${width}.png`,
        fullPage: true,
      });
    await page.goto(`/share/${battleId}`);
    await expect(page.getByRole("region", { name: /’s deck$/ })).toHaveCount(2);
    await expect(
      page.locator("a.battle__name, .kit-player-name, .kit-verified"),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: /’s session$/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("region", { name: "Share this battle" }),
    ).toHaveCount(0);
    await noSideways(page);
    await accessible(page);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/battle-${width}.png`,
        fullPage: true,
      });
  });

  test(`member session Share uses a single capability and manual fallback at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      });
    });
    let creates = 0;
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [200, ME],
        "GET /api/player/session": [200, { ...SHARED_MEMBER, item: ITEM }],
        "POST /api/me/item-shares": () => {
          creates++;
          return [200, { url: URL }];
        },
      }),
    );
    await page.goto(
      `${MEMBER_PATH}?at=${encodeURIComponent(ITEM.facts.started_at)}`,
    );
    const share = page.getByRole("region", { name: "Share this session" });
    const button = share.getByRole("button", { name: "Share", exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator("svg.lucide-share-2")).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await button.focus();
    await page.keyboard.press("Enter");
    const link = share.getByLabel("Share link");
    await expect(link).toHaveValue(URL);
    await expect(
      share.getByRole("link", { name: "Share image" }),
    ).toHaveAttribute("href", `${URL}.png`);
    await button.click();
    await expect(link).toHaveValue(URL);
    expect(creates).toBe(1);
    await noSideways(page);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/controls-${width}.png`,
        fullPage: true,
      });
  });
}
