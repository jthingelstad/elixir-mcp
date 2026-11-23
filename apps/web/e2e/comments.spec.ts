import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";
import { BELL_ME, EMPTY_BELL } from "./bell-fixture.ts";

/**
 * Comments (2026-11-16): a feed card's newest two and its thread, the
 * composer's refusal, Settings › Comments & blocks, Admin › Comments and
 * a comment in the bell, at 320 and 390 with axe and nothing scrolling
 * sideways; and nothing at all while comments are off. While a comment is
 * checked (2026-11-23) the box is read-only under a status line, and an
 * unavailable check, a pause and the app giving up each say so and keep
 * the words. Invented players only.
 *
 * COMMENTS_SHOTS=<dir> also saves a capture of each state.
 */
const shots = process.env.COMMENTS_SHOTS;

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

async function capture(page: Page, name: string, width: number) {
  if (!shots) return;
  await page.screenshot({
    path: `${shots}/comments-${name}-${width}.png`,
    fullPage: true,
  });
}

const AUTHOR = {
  account_id: "pp_invented_ada",
  player_tag: "#0GVJ9V",
  name: "Invented Ada",
  verified: true,
};
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const comment = (id: string, text: string, min: number, extra = {}) => ({
  id,
  item_id: "o1",
  text,
  at: AGO(min),
  author: AUTHOR,
  mine: false,
  can_delete: false,
  can_report: true,
  can_block: true,
  ...extra,
});
const LATEST = [
  comment("2", "That push was huge, well played!", 40),
  comment("3", "gg, see you in the River Race", 12),
];
const THREAD = [comment("1", "Nice one", 90), ...LATEST];

const ON_ME = { ...ME, features: { comments: true } };

const feed = (on: boolean) => ({
  ...TIMELINE,
  timeline: TIMELINE.timeline.map((it) =>
    it.id === "o1" && on
      ? { ...it, comments: { count: 3, latest: LATEST, open: true } }
      : it,
  ),
});

const commentsOn = (extra = {}) =>
  homeApi({
    "GET /api/me": [200, ON_ME],
    "GET /api/me/timeline": [200, feed(true)],
    "GET /api/me/comments": [
      200,
      { item_id: "o1", comments: THREAD, count: 3, open: true },
    ],
    "POST /api/me/comments": [
      422,
      {
        error: "refused",
        category: "bullying",
        message: "Keep it friendly.",
      },
    ],
    ...extra,
  });

for (const width of [320, 390]) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("a card shows the newest two; the thread opens; a refusal says why", async ({
      page,
    }) => {
      await mockApi(page, commentsOn());
      await page.goto("/home");
      const card = page.locator("article", {
        hasText: "Reached Path of Legends",
      });
      const section = card.getByRole("region", { name: "Comments" });
      await expect(section).toContainText("That push was huge");
      await expect(section).toContainText("gg, see you in the River Race");
      await noSideways(page);
      await accessible(page, "card");
      await capture(page, "card", width);

      await card.getByRole("button", { name: "See all 3 comments" }).click();
      await expect(section).toContainText("Nice one");
      const box = section.getByRole("textbox", { name: "Your comment" });
      await box.fill("you are so bad at this");
      await section.getByRole("button", { name: "Post" }).click();
      await expect(section.getByRole("alert")).toHaveText(
        "Your comment wasn't posted. Keep it friendly.",
      );
      await expect(box).toBeFocused();
      await expect(box).toHaveValue("you are so bad at this");
      await noSideways(page);
      await accessible(page, "thread");
      await capture(page, "thread-refused", width);

      // Report: one reason, then it's gone for you.
      await section
        .getByRole("listitem")
        .filter({ hasText: "Nice one" })
        .getByRole("button", { name: "Report" })
        .click();
      await expect(
        section.getByRole("group", { name: "What's wrong with it?" }),
      ).toBeVisible();
      await accessible(page, "report");
      await capture(page, "report", width);
    });

    test("Block asks first and says what it does", async ({ page }) => {
      await mockApi(page, commentsOn());
      await page.goto("/home");
      const card = page.locator("article", {
        hasText: "Reached Path of Legends",
      });
      await card
        .getByRole("listitem")
        .filter({ hasText: "That push was huge" })
        .getByRole("button", { name: "Block" })
        .click();
      const ask = page.getByRole("dialog", { name: "Block Invented Ada?" });
      await expect(ask).toContainText("They won't be told.");
      await accessible(page, "block");
      await capture(page, "block", width);
    });

    test("Settings › Comments & blocks: the setting and the list", async ({
      page,
    }) => {
      await mockApi(
        page,
        commentsOn({
          "GET /api/me/comment-setting": [
            200,
            { who: "followers", suspended_until: null },
          ],
          "GET /api/me/blocks": [
            200,
            {
              blocks: [
                {
                  account_id: "pp_invented_ada",
                  player_tag: "#0GVJ9V",
                  name: "Invented Ada",
                  blocked_at: AGO(60 * 24),
                },
              ],
            },
          ],
        }),
      );
      await page.goto("/settings/comments");
      await expect(
        page.getByRole("heading", { name: "Comments & blocks", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "People who follow you" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Unblock" })).toBeVisible();
      await noSideways(page);
      await accessible(page, "settings");
      await capture(page, "settings", width);
    });

    test("Admin › Comments: the queue, spend, pauses and refusals", async ({
      page,
    }) => {
      await mockApi(
        page,
        commentsOn({
          "GET /api/me": [200, { ...ON_ME, is_admin: true }],
          "GET /api/admin/comments": [
            200,
            {
              enabled: true,
              cap_usd: 10,
              month: {
                usd: 0.0412,
                checks: 52,
                allowed: 47,
                refused: 4,
                errors: 1,
                paused: false,
              },
              reported: [
                {
                  ...comment("9", "go play something else", 300),
                  status: "hidden",
                  subject_tag: "#00C298UC",
                  reports: [
                    { reason: "bullying", at: AGO(200) },
                    { reason: "other", at: AGO(100) },
                  ],
                },
              ],
              refused: [
                {
                  id: "r1",
                  at: AGO(30),
                  stage: "model",
                  category: "bullying",
                  text: "you are so bad at this",
                  author: AUTHOR,
                },
              ],
              suspended: [],
            },
          ],
        }),
      );
      await page.goto("/settings/admin/comments");
      await expect(
        page.getByRole("heading", { name: "Comments", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText("go play something else")).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
      await noSideways(page);
      await accessible(page, "admin");
      await capture(page, "admin", width);
    });

    test("a comment on your play reaches you in the bell", async ({ page }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, { ...BELL_ME, features: { comments: true } }],
          "GET /api/me/bell": [
            200,
            {
              ...EMPTY_BELL,
              new: 1,
              comments: {
                new: 1,
                items: [
                  {
                    comment_id: "4",
                    item_id: "tl_0123456789abcdef0123",
                    subject_tag: "#0YV8YGYJ",
                    at: AGO(5),
                    author: AUTHOR,
                    text: "That push was huge, well played!",
                    new: true,
                  },
                ],
              },
            },
          ],
          "PUT /api/me/bell/seen": [200, { seen_at: new Date().toISOString() }],
        }),
      );
      await page.goto("/home");
      await page
        .locator(".kit-top")
        .getByRole("button", { name: /^Notifications/ })
        .click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      const fresh = sheet.getByRole("region", { name: "New" });
      await expect(fresh).toContainText("Invented Ada commented");
      await expect(fresh.getByRole("link")).toHaveAttribute(
        "href",
        "/home/player/0YV8YGYJ",
      );
      // The list fades in: read its colours once it has arrived, never
      // part-way through (a contrast failure one run in many, 2026-11-23).
      await sheet.evaluate((el) =>
        Promise.all(el.getAnimations().map((a) => a.finished)).then(() => {}),
      );
      await accessible(page, "bell");
      if (shots)
        await page.screenshot({ path: `${shots}/comments-bell-${width}.png` });
    });
  });
}

test("comments off: no thread, no Block, no settings page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, homeApi({ "GET /api/me/timeline": [200, feed(false)] }));
  await page.goto("/home");
  await expect(page.getByText("Reached Path of Legends")).toBeVisible();
  await expect(page.getByRole("region", { name: "Comments" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Block" })).toHaveCount(0);
  await page.goto("/settings/comments");
  await expect(page.getByText("Comments aren't on yet")).toBeVisible();
  // Its own tab title and a line saying what the page is for (2026-11-17).
  await expect(page).toHaveTitle("Comments & blocks - Settings - Elixir");
  await expect(
    page.getByText("this is where you choose who can comment on your play"),
  ).toBeVisible();
});

/** The thread's composer on the first card, its box filled. */
async function filledComposer(page: Page, words: string) {
  await page.goto("/home");
  const card = page.locator("article", { hasText: "Reached Path of Legends" });
  await card.getByRole("button", { name: "See all 3 comments" }).click();
  const form = card.locator(".kit-comments__form");
  const box = form.getByRole("textbox", { name: "Your comment" });
  await box.fill(words);
  return { form, box };
}

/** Answer the comment's POST only when `release` is called. */
async function holdPost(page: Page, answer: [number, unknown]) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me/comments", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await held;
    await route.fulfill({
      status: answer[0],
      contentType: "application/json",
      body: JSON.stringify(answer[1]),
    });
  });
  return () => release();
}

test.describe("while a comment is checked", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("a status line says why it takes a moment, the box is read-only, and an unavailable check keeps the words", async ({
    page,
  }) => {
    await mockApi(page, commentsOn());
    const release = await holdPost(page, [
      503,
      {
        error: "unavailable",
        message: "We couldn't check it just now. Try again.",
      },
    ]);
    const { form, box } = await filledComposer(page, "rematch me");
    await form.getByRole("button", { name: "Post" }).click();
    await expect(form.getByRole("status")).toHaveText(
      "Elixir checks every comment before it posts, so this takes a few seconds.",
    );
    await expect(box).not.toBeEditable();
    await expect(form.getByRole("button", { name: "Checking" })).toBeDisabled();
    await accessible(page, "checking");
    await capture(page, "checking", 390);
    release();
    await expect(form.getByRole("alert")).toHaveText(
      "Your comment wasn't posted. We couldn't check it just now. Try again.",
    );
    await expect(form.getByRole("status")).toHaveText("");
    await expect(box).toBeEditable();
    await expect(box).toHaveValue("rematch me");
    await expect(box).toBeFocused();
  });

  test("a pause says so and keeps the words", async ({ page }) => {
    await mockApi(
      page,
      commentsOn({
        "POST /api/me/comments": [
          503,
          {
            error: "paused",
            message: "Comments are paused for now. Try again later.",
          },
        ],
      }),
    );
    const { form, box } = await filledComposer(page, "gg");
    await form.getByRole("button", { name: "Post" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Your comment wasn't posted. Comments are paused for now. Try again later.",
    );
    await expect(box).toHaveValue("gg");
  });

  test("when the app gives up waiting it says the comment wasn't posted and keeps the words", async ({
    page,
  }) => {
    // The app's 20 s wait, cut short: the answer never comes.
    await page.addInitScript(() => {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = (ms: number) => timeout(Math.min(ms, 500));
    });
    await mockApi(page, commentsOn());
    await holdPost(page, [201, {}]);
    const { form, box } = await filledComposer(page, "that was close");
    await form.getByRole("button", { name: "Post" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Your comment wasn't posted. That took too long. Try again.",
    );
    await expect(box).toHaveValue("that was close");
    await expect(box).toBeEditable();
  });
});
