import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import {
  SHARED_ID,
  SHARED_MEMBER,
  SHARED_NAME,
  SHARED_PATH,
  SHARED_PUBLIC,
  SHARED_START,
  SHARED_TAG,
} from "./session-fixture.ts";

/**
 * A session's public page (2026-11-17): /session/<tag>/<id>/<start> opens
 * for anyone with the link and no account, the same session the member
 * page draws, read as nobody: game names only and unlinked, no comments,
 * no highlight, no verified mark, and the way in. Signed in, the same
 * address opens the member page. Invented players only.
 */
const SHOTS = process.env.SHARE_SESSION_SHOTS ?? null;
const HEADLINE = "Won 8 of 12 on Trophy Road, 5 in a row";
const API = `/api/public/sessions/${SHARED_TAG.slice(1)}/${SHARED_ID}/${SHARED_START}`;
const MEMBER_PATH = `/home/player/${SHARED_TAG.slice(1)}/session/${SHARED_ID}`;
const ME_COMMENTS = { ...ME, features: { ...ME.features, comments: true } };

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

const publicReads = {
  "GET /api/me": [200, SIGNED_OUT] as [number, unknown],
  [`GET ${API}`]: [200, SHARED_PUBLIC] as [number, unknown],
};

for (const [label, width, tag] of [
  ["320", 320, "@narrow "],
  ["phone", 390, "@narrow "],
  ["wide", 1280, ""],
] as const) {
  test(`${tag}${label}: signed out, the session and the way in`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, publicReads);
    await page.goto(SHARED_PATH);
    await expect(
      page.getByRole("heading", { level: 1, name: HEADLINE }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${SHARED_NAME}: ${HEADLINE} - Elixir`);
    // The player's game name, as text: no link into the signed-in app,
    // no verified mark, and markup never drawn.
    await expect(page.locator(".page__crumb")).toHaveText(SHARED_NAME);
    await expect(page.locator(".page__crumb a")).toHaveCount(0);
    await expect(page.locator(".kit-player-name")).toHaveCount(0);
    await expect(page.locator(".page__crumb i")).toHaveCount(0);
    // The figures, both decks with their art, and every game.
    await expect(page.locator(".kit-sfacts")).toContainText("12");
    await expect(page.locator(".kit-session__deck")).toHaveCount(2);
    await expect(page.locator(".kit-session__deck").first()).toContainText(
      "Hog Rider cycle · 8 battles",
    );
    const rows = page.locator(".kit-session__games .kit-sgame");
    await expect(rows).toHaveCount(12);
    // Opponents by game name, unlinked; each game opens its battle page.
    await expect(page.getByText("<b>Quill</b>")).toBeVisible();
    await expect(page.locator("a.kit-sgame__name")).toHaveCount(0);
    await expect(
      rows.first().getByRole("link", { name: /^Battle/ }),
    ).toHaveAttribute("href", /^\/battle\/[0-9a-f]+$/);
    // None of a member's things: comments, highlight, Follow from here.
    await expect(page.getByRole("region", { name: "Comments" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Highlight/ })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Follow from here" }),
    ).toHaveCount(0);
    // The way in, up top and below, back to this session.
    const back = `return_to=${encodeURIComponent(SHARED_PATH)}`;
    await expect(
      page.getByText("Follow your friends’ battles on Elixir. It’s free."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Join free" })).toHaveAttribute(
      "href",
      `/signin?signup&${back}`,
    );
    const invite = page.getByRole("region", {
      name: `Follow ${SHARED_NAME} on Elixir`,
    });
    await expect(invite).toBeVisible();
    await expect(invite.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/signin?${back}`,
    );
    // Share: the link, the picture and a line for a post.
    const share = page.getByRole("region", { name: "Share this session" });
    await expect(share).toContainText(SHARED_PUBLIC.url);
    await expect(
      share.getByRole("link", { name: "Share image" }),
    ).toHaveAttribute("href", SHARED_PUBLIC.image);
    await expect(
      share.getByRole("button", { name: "Copy link" }),
    ).toBeVisible();
    await expect(
      share.getByRole("button", { name: "Copy for a post" }),
    ).toBeVisible();
    await noSideways(page);
    await accessible(page, `${label} public session`);
    if (SHOTS && label !== "320")
      await page.screenshot({
        path: `${SHOTS}/public-${width}.png`,
        fullPage: true,
      });
    if (SHOTS && label === "wide")
      await share.screenshot({ path: `${SHOTS}/share-controls.png` });
  });
}

test("Copy for a post puts the headline and the link on the clipboard", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium's");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockApi(page, publicReads);
  await page.goto(SHARED_PATH);
  const share = page.getByRole("region", { name: "Share this session" });
  await share.getByRole("button", { name: "Copy for a post" }).click();
  await expect(share.getByRole("button", { name: "Copied" })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(`${SHARED_NAME}: ${HEADLINE}\n${SHARED_PUBLIC.url}`);
});

test("an address that names no session says so", async ({ page }) => {
  await mockApi(page, {
    "GET /api/me": [200, SIGNED_OUT],
    [`GET ${API}`]: [404, { error: "not_found" }],
  });
  await page.goto(SHARED_PATH);
  await expect(
    page.getByText("Elixir has no record of this session"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Join free" })).toHaveCount(0);
});

test("an old member link, signed out, opens the public page", async ({
  page,
}) => {
  await mockApi(page, publicReads);
  const at = new Date(SHARED_START * 1000).toISOString();
  await page.goto(`${MEMBER_PATH}?at=${encodeURIComponent(at)}`);
  await expect(page).toHaveURL(new RegExp(`${SHARED_PATH}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: HEADLINE }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Join free" })).toBeVisible();
});

test("signed in, the public address opens the member page", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/me": [200, ME_COMMENTS],
      "GET /api/player/session": [200, SHARED_MEMBER],
    }),
  );
  await page.goto(SHARED_PATH);
  await expect(page).toHaveURL(new RegExp(`${MEMBER_PATH}\\?at=`));
  await expect(
    page.getByRole("heading", { level: 1, name: HEADLINE }),
  ).toBeVisible();
  // The member's things are here: the crumb opens the player's page, the
  // comments, and the same Share panel.
  await expect(page.locator(".page__crumb a")).toHaveAttribute(
    "href",
    `/home/player/${SHARED_TAG.slice(1)}`,
  );
  await expect(page.getByRole("region", { name: "Comments" })).toBeVisible();
  await expect(page.locator("a.kit-sgame__name").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Join free" })).toHaveCount(0);
  const share = page.getByRole("region", { name: "Share this session" });
  await expect(
    share.getByRole("link", { name: "Share image" }),
  ).toHaveAttribute("href", SHARED_PUBLIC.image);
});

test("joining from the page lands back on the session", async ({ page }) => {
  let authed = false;
  await mockApi(
    page,
    signedIn({
      ...homeApi(),
      "GET /api/me": () => [
        200,
        authed ? { ...ME, role: "member" } : SIGNED_OUT,
      ],
      [`GET ${API}`]: [200, SHARED_PUBLIC],
      "GET /api/player/session": [200, SHARED_MEMBER],
      "POST /api/auth": [200, { ok: true }],
      "POST /api/auth/code": () => {
        authed = true;
        return [200, { authenticated: true }];
      },
    }),
  );
  await page.goto(SHARED_PATH);
  await page
    .getByRole("region", { name: `Follow ${SHARED_NAME} on Elixir` })
    .getByRole("link", { name: "Sign in" })
    .click();
  await expect(page).toHaveURL(/\/signin\?return_to=/);
  await page.getByLabel("Email", { exact: true }).fill("someone@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${MEMBER_PATH}\\?at=`));
  await expect(
    page.getByRole("heading", { level: 1, name: HEADLINE }),
  ).toBeVisible();
});
