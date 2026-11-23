import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi } from "./fixtures.ts";
import { ADA as PLAYER } from "./player-fixture.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";

/**
 * Posts (2026-11-17): the quiet composer at the top of the feed, a
 * question with a pasted deck link, the card picker, a refusal, posted
 * items (a question with its deck, a post with loose cards) and Admin ›
 * Comments' reported posts, at 320, 390 and 1280 with axe and nothing
 * scrolling sideways; and no composer while posts are off. While a post
 * or an edit is checked (2026-11-23) the box is read-only under a status
 * line, and an unavailable check, a pause and the app giving up each say
 * so and keep the words. Invented players only.
 *
 * POSTS_SHOTS=<dir> also saves a capture of each state.
 */
const shots = process.env.POSTS_SHOTS;

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
    path: `${shots}/posts-${name}-${width}.png`,
    fullPage: true,
  });
}

const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const CATALOG = [
  [26000000, "Knight", 3],
  [26000001, "Archers", 3],
  [26000010, "Skeletons", 1],
  [26000014, "Musketeer", 4],
  [26000021, "Hog Rider", 4],
  [27000000, "Cannon", 3],
  [28000000, "Fireball", 4],
  [28000008, "Zap", 2],
  [26000004, "P.E.K.K.A", 7],
  [26000003, "Giant", 5],
].map(([id, name, elixir_cost]) => ({ id, name, elixir_cost }));
const DECK_IDS = [
  26000000, 26000001, 26000010, 26000014, 26000021, 27000000, 28000000,
  28000008,
];
const LINK = `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${DECK_IDS.join(";")}&tt=159000000&l=Royals`;
const DECK_CARDS = DECK_IDS.map((id) => CATALOG.find((c) => c.id === id)!);

const ADA = {
  account_id: "pp_invented_ada",
  player_tag: "#0PGQ2UYL",
  name: "Invented Ada",
};
const post = (
  id: string,
  text: string,
  min: number,
  extra: Record<string, unknown> = {},
) => ({
  id: `tl_0000000000000000000${id}`,
  kind: "post",
  at: AGO(min),
  sort_at: AGO(min),
  observed_at: AGO(min),
  subject_tag: ADA.player_tag,
  subjects: [{ kind: "player", tag: ADA.player_tag, name: ADA.name }],
  text,
  cheers: { well_played: 2 },
  my_cheer: null,
  comments: { count: 0, latest: [], open: true },
  post: {
    id,
    text,
    question: false,
    deck: null,
    cards: [],
    author: ADA,
    mine: false,
    can_delete: false,
    can_report: true,
    can_block: true,
    ...extra,
  },
});
const QUESTION = post(
  "1",
  "Is this good for 7k? <b>bold</b> https://example.com/deck",
  20,
  {
    question: true,
    deck: {
      cards: DECK_CARDS,
      tower_troop: { id: 159000000, name: "Tower Princess" },
      label: "Hog Rider cycle",
      average_elixir: 3,
      copy_link: LINK,
    },
  },
);
const CARDS_POST = post("2", "Who else levels these first?", 60, {
  cards: CATALOG.slice(8).map(({ id, name }) => ({ id, name })),
});

const ON_ME = {
  ...ME,
  features: { comments: true, posts: true },
  claims: [{ ...ME.claims[0], status: "verified" }],
};

const FEED = {
  ...TIMELINE,
  timeline: [QUESTION, CARDS_POST, ...TIMELINE.timeline],
};

const postsOn = (extra = {}) =>
  homeApi({
    "GET /api/me": [200, ON_ME],
    "GET /api/me/timeline": [200, FEED],
    "GET /api/public/cards": [200, { cards: CATALOG }],
    "POST /api/me/posts": [
      422,
      {
        error: "refused",
        category: "personal_info",
        message: "Keep personal details out of posts.",
      },
    ],
    ...extra,
  });

async function openComposer(page: Page, width: number) {
  if (width < 900) {
    await page.getByRole("button", { name: "Post", exact: true }).click();
  } else {
    await page
      .getByRole("button", { name: "Write a post or ask a question" })
      .click();
  }
  return page.locator(".kit-post-compose");
}

for (const width of [320, 390, 1280]) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("posted items: a question with its deck, a post with cards", async ({
      page,
    }) => {
      await mockApi(page, postsOn());
      await page.goto("/home");
      const q = page.locator("article", { hasText: "Is this good for 7k?" });
      await expect(q.getByText("Question", { exact: true })).toBeVisible();
      await expect(q).toContainText("Hog Rider cycle");
      await expect(q).toContainText("3.0 average elixir");
      await expect(q.getByRole("button", { name: /Copy deck/ })).toBeVisible();
      // The words are plain text: no link, no markup.
      await expect(q).toContainText("<b>bold</b> https://example.com/deck");
      await expect(q.locator('a[href*="example.com"]')).toHaveCount(0);
      await expect(
        q.getByRole("button", { name: "0 answers", exact: true }),
      ).toBeVisible();
      const c = page.locator("article", {
        hasText: "Who else levels these first?",
      });
      await expect(c).toContainText("P.E.K.K.A");
      await noSideways(page);
      await accessible(page, "posted");
      await capture(page, "posted", width);
    });

    test("the composer: empty, a question with a deck link, a refusal", async ({
      page,
    }) => {
      await mockApi(page, postsOn());
      await page.goto("/home");
      const box = await openComposer(page, width);
      await expect(
        box.getByRole("textbox", { name: "Your post" }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "composer");
      await capture(page, "composer-empty", width);

      await box.getByRole("button", { name: "Ask a question" }).click();
      const words = box.getByRole("textbox", { name: "Your question" });
      await words.fill(`Good for 7k? ${LINK}`);
      await expect(
        box.getByRole("list", { name: "The deck from your link" }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "question");
      await capture(page, "composer-question-deck", width);

      await words.fill("where is everyone from");
      await box.getByRole("button", { name: "Ask", exact: true }).click();
      await expect(box.getByRole("alert")).toHaveText(
        "Your question didn't go up. Keep personal details out of posts.",
      );
      await expect(words).toBeFocused();
      await expect(words).toHaveValue("where is everyone from");
      await noSideways(page);
      await accessible(page, "refusal");
      await capture(page, "refusal", width);
    });

    test("the card picker: search by name, pick up to eight", async ({
      page,
    }) => {
      await mockApi(page, postsOn());
      await page.goto("/home");
      const box = await openComposer(page, width);
      await box.getByRole("button", { name: "Add cards" }).click();
      const search = box.getByRole("searchbox");
      await search.fill("hog");
      const hog = box.getByRole("button", { name: "Hog Rider", exact: true });
      await expect(hog).toBeVisible();
      await hog.click();
      await expect(hog).toHaveAttribute("aria-pressed", "true");
      await noSideways(page);
      await accessible(page, "picker");
      await capture(page, "picker", width);
    });

    test("Admin › Comments: reported posts", async ({ page }) => {
      await mockApi(
        page,
        postsOn({
          "GET /api/me": [200, { ...ON_ME, is_admin: true }],
          "GET /api/admin/comments": [
            200,
            {
              enabled: true,
              posts_enabled: true,
              cap_usd: 10,
              month: {
                usd: 0.0412,
                checks: 52,
                allowed: 47,
                refused: 4,
                errors: 1,
                paused: false,
              },
              reported: [],
              posts: [
                {
                  id: "1",
                  item_id: QUESTION.id,
                  at: AGO(300),
                  text: "add me on snap, trading my account",
                  question: true,
                  deck: QUESTION.post.deck,
                  cards: [],
                  author: ADA,
                  status: "hidden",
                  reports: [
                    { reason: "personal_info", at: AGO(200) },
                    { reason: "other", at: AGO(100) },
                  ],
                },
              ],
              refused: [
                {
                  id: "r1",
                  kind: "post",
                  at: AGO(30),
                  stage: "model",
                  category: "personal_info",
                  text: "where is everyone from",
                  author: ADA,
                },
              ],
              suspended: [],
            },
          ],
        }),
      );
      await page.goto("/settings/admin/comments");
      const panel = page.getByRole("region", { name: "Reported posts" });
      await expect(panel).toContainText("add me on snap");
      await expect(panel.getByRole("button", { name: "Remove" })).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Dismiss" }),
      ).toBeVisible();
      await noSideways(page);
      await accessible(page, "admin");
      await capture(page, "admin", width);
    });
  });
}

test("no composer while posts are off", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(
    page,
    postsOn({
      "GET /api/me": [200, { ...ON_ME, features: { comments: true } }],
      "GET /api/me/timeline": [200, TIMELINE],
    }),
  );
  await page.goto("/home");
  await expect(
    page.locator("article", { hasText: "Reached Path of Legends" }),
  ).toBeVisible();
  await expect(page.locator(".kit-post-compose")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Post", exact: true }),
  ).toHaveCount(0);
});

test("retrying a player's posts restores the list, then blocking a post author refreshes the player header", async ({
  page,
}) => {
  let available = false;
  let blocked = false;
  await mockApi(
    page,
    postsOn({
      "GET /api/player": () => [
        200,
        {
          ...PLAYER,
          player: { ...PLAYER.player, tag: ADA.player_tag, name: ADA.name },
          you: { ...PLAYER.you, following: !blocked, blocked },
        },
      ],
      "GET /api/me/posts": () =>
        available
          ? [200, { posts: blocked ? [] : [CARDS_POST] }]
          : [503, { error: "unavailable" }],
      "POST /api/me/blocks": () => {
        blocked = true;
        return [200, { ok: true }];
      },
    }),
  );
  await page.goto(`/home/player/${ADA.player_tag.slice(1)}`);
  const header = page.getByRole("navigation", {
    name: "More about this player",
  });
  await expect(header.getByRole("button", { name: "Following" })).toBeVisible();
  const retry = page
    .getByRole("alert")
    .filter({ hasText: "Posts could not be loaded" });
  await expect(retry).toBeVisible();
  available = true;
  await retry.getByRole("button", { name: "Try again" }).click();
  const posts = page.getByRole("region", { name: "Posts", exact: true });
  await expect(posts.getByText(CARDS_POST.text)).toBeVisible();
  await posts.getByRole("button", { name: "Block", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Block", exact: true })
    .click();
  await expect(header.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Following" })).toHaveCount(
    0,
  );
  await expect(posts).toHaveCount(0);
});

/** Answer `pattern`'s `method` only when the returned function is called. */
async function hold(
  page: Page,
  pattern: string,
  method: string,
  answer: [number, unknown],
) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    await held;
    await route.fulfill({
      status: answer[0],
      contentType: "application/json",
      body: JSON.stringify(answer[1]),
    });
  });
  return () => release();
}

test.describe("while a post is checked", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("a status line says why it takes a moment, the box is read-only, and an unavailable check keeps the words", async ({
    page,
  }) => {
    await mockApi(page, postsOn());
    const release = await hold(page, "**/api/me/posts", "POST", [
      503,
      {
        error: "unavailable",
        message: "We couldn't check it just now. Try again.",
      },
    ]);
    await page.goto("/home");
    const form = await openComposer(page, 390);
    const words = form.getByRole("textbox", { name: "Your post" });
    await words.fill("ladder is so sweaty today");
    await form.getByRole("button", { name: "Post", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText(
      "Elixir checks every post before it goes up, so this takes a few seconds.",
    );
    await expect(words).not.toBeEditable();
    await expect(form.getByRole("button", { name: "Checking" })).toBeDisabled();
    await accessible(page, "checking");
    await capture(page, "checking", 390);
    release();
    await expect(form.getByRole("alert")).toHaveText(
      "Your post didn't go up. We couldn't check it just now. Try again.",
    );
    await expect(form.getByRole("status")).toHaveText("");
    await expect(words).toBeEditable();
    await expect(words).toHaveValue("ladder is so sweaty today");
  });

  test("a pause says so and keeps the words", async ({ page }) => {
    await mockApi(
      page,
      postsOn({
        "POST /api/me/posts": [
          503,
          {
            error: "paused",
            message: "Posts are paused for now. Try again later.",
          },
        ],
      }),
    );
    await page.goto("/home");
    const form = await openComposer(page, 390);
    const words = form.getByRole("textbox", { name: "Your post" });
    await words.fill("who wants a friendly");
    await form.getByRole("button", { name: "Post", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Your post didn't go up. Posts are paused for now. Try again later.",
    );
    await expect(words).toHaveValue("who wants a friendly");
  });

  test("when the app gives up waiting it says the post didn't go up and keeps the words", async ({
    page,
  }) => {
    // The app's 20 s wait, cut short: the answer never comes.
    await page.addInitScript(() => {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = (ms: number) => timeout(Math.min(ms, 500));
    });
    await mockApi(page, postsOn());
    await hold(page, "**/api/me/posts", "POST", [201, {}]);
    await page.goto("/home");
    const form = await openComposer(page, 390);
    const words = form.getByRole("textbox", { name: "Your post" });
    await words.fill("our clan needs two more for war");
    await form.getByRole("button", { name: "Post", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Your post didn't go up. That took too long. Try again.",
    );
    await expect(words).toHaveValue("our clan needs two more for war");
  });

  test("an edit is checked the same way, and a refusal keeps the new words", async ({
    page,
  }) => {
    const base = post("9", "Who else levels these first?", 5);
    const MINE = {
      ...base,
      post: { ...base.post, mine: true, can_edit: true, can_delete: true },
    };
    await mockApi(
      page,
      postsOn({
        "GET /api/me/timeline": [
          200,
          { ...TIMELINE, timeline: [MINE, ...TIMELINE.timeline] },
        ],
      }),
    );
    const release = await hold(page, "**/api/me/posts/*", "PUT", [
      422,
      {
        error: "refused",
        category: "link",
        message:
          "Links can't go in posts. A deck link copied from the game becomes the deck; take any other web address out.",
      },
    ]);
    await page.goto("/home");
    const card = page.locator("article", {
      hasText: "Who else levels these first?",
    });
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const form = card.locator(".kit-post-edit");
    const words = form.getByRole("textbox", { name: "Your words" });
    await words.fill("see my site dot com");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText(
      "Elixir checks your new words before they show, so this takes a few seconds.",
    );
    await expect(words).not.toBeEditable();
    release();
    await expect(form.getByRole("alert")).toHaveText(
      "Your changes weren't saved. Links can't go in posts. A deck link copied from the game becomes the deck; take any other web address out.",
    );
    await expect(words).toHaveValue("see my site dot com");
    await expect(words).toBeFocused();
  });
});
