import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";

const shots = process.env.POST_REACH_SHOTS;
for (const width of [320, 390, 1280])
  test(`${width}px: a new question waits behind N new, keyboard refresh shows it once`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    let arrived = false;
    const oldAt = new Date(Date.now() - 60_000).toISOString();
    const newAt = new Date(Date.now()).toISOString();
    const old = {
      ...TIMELINE.timeline[0],
      at: oldAt,
      sort_at: oldAt,
      observed_at: oldAt,
    };
    const question = {
      id: "tl_00000000000000000401",
      kind: "post",
      at: newAt,
      sort_at: newAt,
      observed_at: newAt,
      subject_tag: "#0PGQ2UYL",
      subjects: [{ kind: "player", tag: "#0PGQ2UYL", name: "Invented Ada" }],
      text: "Which card would you swap in this deck?",
      groups: ["friends"],
      post: {
        id: "401",
        text: "Which card would you swap in this deck?",
        question: true,
        deck: null,
        cards: [],
        mine: false,
        can_report: true,
        can_block: true,
        author: { player_tag: "#0PGQ2UYL", name: "Invented Ada" },
      },
    };
    await mockApi(
      page,
      homeApi({
        "GET /api/me/home/feed": [200, {}],
        "GET /api/me/home/feed/new": (route) => {
          const since =
            new URL(route.request().url()).searchParams.get("since") ?? "";
          return [
            200,
            {
              new: arrived && Date.parse(since) < Date.parse(newAt) ? 1 : 0,
              built_at: newAt,
            },
          ];
        },
      }),
    );
    // The fixture changes only its answer, just as a newly published post does.
    await page.route("**/api/me/home/feed", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          window: {
            from: new Date(Date.now() - 7 * 86400_000).toISOString(),
            to: newAt,
          },
          watermark: arrived ? newAt : oldAt,
          seen_to: oldAt,
          timeline: arrived ? [question, old] : [old],
          total: arrived ? 2 : 1,
          next: null,
          timeline_more: 0,
        }),
      }),
    );
    await page.goto("/timeline");
    await expect(page.locator(".kit-feed")).toBeVisible();
    arrived = true;
    await page.clock.fastForward(61_000);
    await page.clock.runFor(250);
    const pill = page.getByRole("button", {
      name: "Show 1 new item",
      exact: true,
    });
    await expect(pill).toBeVisible();
    await expect(page.getByText(question.text, { exact: true })).toHaveCount(0);
    const box = await pill.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    if (shots)
      await page.screenshot({
        path: `${shots}/timeline-post-new-${width}.png`,
        fullPage: true,
      });
    await pill.focus();
    await expect(pill).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(question.text, { exact: true })).toBeVisible();
    await expect(pill).toBeHidden();
    await page.clock.fastForward(61_000);
    await expect(pill).toBeHidden();
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    if (shots)
      await page.screenshot({
        path: `${shots}/timeline-post-read-${width}.png`,
        fullPage: true,
      });
  });
