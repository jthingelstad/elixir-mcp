import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";
import { signedIn as clanSignedIn } from "./clan/fixtures.ts";

const shots = process.env.QUESTIONS_SHOTS;
const at = new Date(Date.now() - 60000).toISOString();
const question = {
  id: "tl_00000000000000000042",
  kind: "post",
  at,
  sort_at: at,
  observed_at: at,
  subject_tag: "#0PGQ2UYL",
  subjects: [{ kind: "player", tag: "#0PGQ2UYL", name: "Invented Ada" }],
  groups: ["you"],
  text: "How did the battle end?",
  cheers: {},
  my_cheer: null,
  post: {
    id: "42",
    text: "How did the battle end?",
    question: true,
    answered: false,
    mine: true,
    can_edit: true,
    can_delete: true,
    cards: [],
    deck: null,
    author: { player_tag: "#0PGQ2UYL", name: "Invented Ada" },
  },
  comments: { count: 0, latest: [], open: true },
};
const on = { ...ME, features: { posts: true, comments: true } };
const empty = { new: 0, items: [] };
const bell = {
  seen_at: null,
  players: 1,
  new: 1,
  reactions: empty,
  followers: empty,
  answers: empty,
  account: empty,
  comments: {
    new: 1,
    items: [
      {
        comment_id: "8",
        item_id: question.id,
        post_id: "42",
        question: true,
        count: 3,
        unread_count: 2,
        new: true,
        at,
        text: "Three crowns <script>unsafe</script>",
        unread_since: new Date(Date.now() - 120000).toISOString(),
        author: { player_tag: "#0LYQ8GRP", name: "Invented Reader" },
      },
    ],
  },
};
async function capture(page: Page, name: string, width: number) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
  if (shots)
    await page.screenshot({
      path: `${shots}/${name}-${width}.png`,
      fullPage: true,
    });
}
async function target(page: Page, name: RegExp | string) {
  const b = page.getByRole("button", { name, exact: typeof name === "string" });
  const box = await b.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  return b;
}
for (const width of [320, 390, 1280]) {
  test(`Questions, answer state and direct reply notice at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let answered = false;
    let revision = 1;
    const item = () => ({
      ...question,
      post: { ...question.post, answered, edited: revision > 1 },
    });
    const requests: string[] = [];
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [200, on],
        "GET /api/me/home/needs": [200, { needs: { ok: true, state: "none" } }],
        "GET /api/me/home/feed": (route) => {
          requests.push(route.request().url());
          const only = new URL(route.request().url()).searchParams.has(
            "questions",
          );
          return [
            200,
            {
              ...TIMELINE,
              timeline: only ? [item()] : [item(), ...TIMELINE.timeline],
              total: 1,
              timeline_more: 0,
              next: null,
            },
          ];
        },
        "PUT /api/me/posts/42": (route) => {
          const next = route.request().postDataJSON().answered;
          if (answered !== next) revision += 1;
          answered = next;
          return [200, { post: item(), changed: true }];
        },
        "GET /api/me/post/42": () => [200, { item: item() }],
        "GET /api/me/bell": [200, bell],
        "GET /api/me/comments": [
          200,
          {
            comments: [
              {
                id: "7",
                text: "An earlier answer",
                at: new Date(Date.now() - 240000).toISOString(),
                mine: false,
                author: { name: "Invented Reader" },
              },
              {
                id: "8",
                text: "Three crowns",
                at,
                mine: false,
                author: { name: "Invented Reader" },
              },
              {
                id: "9",
                text: "My own reply",
                at,
                mine: true,
                author: { name: "Invented Ada" },
              },
            ],
            open: true,
            anchored: true,
          },
        ],
      }),
    );
    await page.goto("/timeline");
    const chip = await target(page, /^Questions/);
    await chip.click();
    await expect(
      page.getByRole("button", { name: "0 answers", exact: true }),
    ).toBeVisible();
    expect(
      requests.some(
        (url) => new URL(url).searchParams.get("questions") === "1",
      ),
    ).toBe(true);
    await capture(page, "questions-before", width);
    const mark = await target(page, "Mark answered");
    await mark.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Mark unanswered", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".kit-written__label")).toHaveText(
      "Question · Answered",
    );
    await expect(page.getByText("Edited", { exact: true })).toBeVisible();
    await capture(page, "questions-answered", width);
    await (await target(page, "Mark unanswered")).click();
    await expect(
      page.getByRole("button", { name: "Mark answered", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog).toContainText("answered your question");
    await expect(dialog).toContainText("3 answers · 2 new");
    await expect(dialog).toContainText("<script>unsafe</script>");
    const link = dialog.getByRole("link", {
      name: /Invented Reader answered your question/,
    });
    await expect(link).toHaveAttribute(
      "href",
      /\/home\/post\/42\?answers=1&reply=8&after=/,
    );
    await capture(page, "question-notification", width);
    await link.click();
    await expect(page).toHaveURL(/\/home\/post\/42\?answers=1/);
    await expect(
      page.getByRole("button", { name: "Hide answers", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("New answer", { exact: true })).toHaveCount(1);
    await expect(page.locator('[id$="-reply-8"]')).toBeFocused();
    await capture(page, "question-detail", width);
  });
  test(`Clan Questions uses its own source view at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let requested = "";
    let resolved = false;
    await mockApi(
      page,
      clanSignedIn({
        "GET /api/me": [200, on],
        "PUT /api/me/posts/42": () => {
          resolved = true;
          return [200, { changed: true }];
        },
        "GET /api/clan/clans/0QC8RCGY/feed": (route) => {
          requested =
            new URL(route.request().url()).searchParams.get("view") ?? "all";
          return [
            200,
            {
              clan_tag: "#0QC8RCGY",
              view: requested,
              question_counts: { questions: 2, unanswered: resolved ? 0 : 1 },
              window_days: 7,
              items:
                requested === "unanswered"
                  ? resolved
                    ? []
                    : [question]
                  : [
                      question,
                      {
                        ...question,
                        id: "tl_00000000000000000043",
                        post: {
                          ...question.post,
                          id: "43",
                          text: "An already resolved question",
                          answered: true,
                          mine: false,
                          can_edit: false,
                        },
                        comments: { count: 3, latest: [], open: true },
                      },
                    ],
              more: 0,
            },
          ];
        },
      }),
    );
    await page.goto("/clan");
    await page.getByRole("button", { name: /Example Clan/ }).click();
    await (await target(page, /^Questions/)).click();
    await expect(
      page.getByRole("button", { name: "0 answers", exact: true }),
    ).toBeVisible();
    expect(requested).toBe("questions");
    await expect(page.getByText("An already resolved question")).toBeVisible();
    await (await target(page, /^Unanswered/)).click();
    await expect(page.getByText("An already resolved question")).toHaveCount(0);
    expect(requested).toBe("unanswered");
    await capture(page, "clan-questions", width);
    await (await target(page, "Mark answered")).click();
    await expect(
      page.getByText("No unanswered questions in the last seven days", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Unanswered\s*0$/, exact: true }),
    ).toBeVisible();
    await capture(page, "clan-no-unanswered", width);
  });
}
