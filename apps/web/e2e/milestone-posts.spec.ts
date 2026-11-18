import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";
const tag = "#0PGQ2UYL";
const at = "2026-11-18T12:00:00.000Z";
const milestone = {
  id: "tl_0123456789abcdef0123",
  kind: "badge_earned",
  section: "badges",
  at,
  sort_at: at,
  observed_at: at,
  visibility: "public",
  subject_tag: tag,
  subjects: [{ kind: "player", tag, name: "Invented <Ada>" }],
  text: "Invented <Ada> reached Knight Mastery level 5.",
  facts: {
    player_tag: tag,
    badge: "MasteryKnight",
    badge_label: "Knight Mastery",
    level: 5,
  },
  moment_card: { id: 26000000, name: "Knight" },
  cheers: { royal: 2 },
  my_cheer: null,
  comments: { count: 0, latest: [], open: true },
};
const ref = {
  item_id: milestone.id,
  kind: milestone.kind,
  source: "game",
  at,
  subject: { kind: "player", tag },
};
const snapshot = {
  id: milestone.id,
  kind: milestone.kind,
  at,
  player_tag: tag,
  text: milestone.text,
  item_ref: ref,
};
const posted = {
  ...milestone,
  id: "tl_0123456789abcdef0456",
  kind: "post",
  section: "posts",
  text: "Finally reached this step",
  post: {
    id: "42",
    text: "Finally reached this step",
    question: false,
    moment: snapshot,
    deck: null,
    cards: [],
    author: { player_tag: tag, name: "Invented <Ada>" },
    mine: true,
    can_edit: true,
    can_delete: true,
  },
};
const me = {
  ...ME,
  email: "invented@example.test",
  features: { comments: true, posts: true },
  claims: [
    {
      player_tag: tag,
      name: "Invented <Ada>",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
};
test.use({ reducedMotion: "reduce" });
for (const width of [320, 390, 1280])
  test(`an own recorded milestone becomes a post with words at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let sent: any = null;
    let created = false;
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [200, me],
        "GET /api/me/timeline": () => [
          200,
          {
            ...TIMELINE,
            timeline: created ? [posted, milestone] : [milestone],
          },
        ],
        "POST /api/me/posts": (route) => {
          sent = route.request().postDataJSON();
          created = true;
          return [201, { post: posted }];
        },
      }),
    );
    await page.goto("/home");
    const source = page
      .locator("article", { hasText: /Knight Mastery/ })
      .first();
    await expect(source).toBeVisible();
    const post = source.getByRole("button", { name: "Post", exact: true });
    const box = await post.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await post.focus();
    await page.keyboard.press("Enter");
    const field = source.getByRole("textbox", { name: "Your post" });
    await expect(field).toBeFocused();
    await expect(source.getByRole("button", { name: "Add cards" })).toHaveCount(
      0,
    );
    await field.fill("Finally reached this step");
    await expect(source.locator("form")).toContainText(milestone.text);
    await expect(page.locator("ada")).toHaveCount(0);
    if (process.env.MILESTONE_SHOTS) {
      mkdirSync(process.env.MILESTONE_SHOTS, { recursive: true });
      await page.screenshot({
        path: `${process.env.MILESTONE_SHOTS}/milestone-compose-${width}.png`,
        fullPage: true,
      });
    }
    await source
      .locator("form")
      .getByRole("button", { name: "Post", exact: true })
      .click();
    await expect
      .poll(() => sent)
      .toEqual({
        text: "Finally reached this step",
        question: false,
        moment: ref,
      });
    const result = page.locator("article", {
      hasText: "Finally reached this step",
    });
    await expect(result).toBeVisible();
    await expect(result).toContainText(milestone.text);
    await expect(
      result.getByRole("link", { name: "Open milestone" }),
    ).toHaveAttribute("href", /\/home\/item\/tl_0123456789abcdef0123\?/);
    await expect(
      result.locator(`.kit-written__moment time[datetime="${at}"]`),
    ).not.toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      scan.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    if (process.env.MILESTONE_SHOTS)
      await page.screenshot({
        path: `${process.env.MILESTONE_SHOTS}/milestone-posted-${width}.png`,
        fullPage: true,
      });
  });
