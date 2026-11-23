import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./clan/fixtures.ts";
import { asksForBattles } from "./fixtures.ts";
import { HOME_READS } from "./home-fixture.ts";

// A configured UI is exercised entirely against the existing route fixtures.
// Merely opening editors must not change the clan's settings or send messages.
for (const width of [390, 820, 1280]) {
  test(`Run settings keep the key masked and the member map switch at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (
        req.method() !== "GET" &&
        !req.url().endsWith("/api/clan/select") &&
        !asksForBattles(req.url())
      )
        writes.push(req.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/0QC8RCGY/social": [200, { enabled: true }],
        "GET /api/clan/clans/0QC8RCGY/discord": [200, { set: false }],
        "GET /api/clan/clans/0QC8RCGY/model": [
          200,
          {
            set: false,
            uses: { today: 0, recent: [] },
            per_day: 20,
            keep_days: 90,
          },
        ],
        "GET /api/clan/clans/0QC8RCGY/sharing": [200, { types: {} }],
      }),
    );
    await page.goto("/clan/0QC8RCGY/run/model-voice");
    await expect(page.getByLabel("Add the clan's key").first()).toHaveAttribute(
      "type",
      "password",
    );
    await page.goto("/clan/0QC8RCGY/run/settings");
    await expect(
      page.getByRole("checkbox", { name: /^Member map/ }),
    ).toBeEnabled();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `/tmp/elixir-settings-cleanup-${width}.png`,
      fullPage: false,
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("@narrow a timeline event keeps its reading width when evidence and the New mark are present", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(
    page,
    signedIn({
      ...HOME_READS,
      "GET /api/me/timeline/discord": [
        200,
        { enabled: false, webhook: null, delivery: null },
      ],
      "GET /api/me/timeline": [
        200,
        {
          window: {
            from: "2026-10-06T12:30:00.000Z",
            to: "2026-10-13T12:30:00.000Z",
          },
          // Learned since the last visit: the row carries the New mark.
          seen_to: "2026-10-13T10:00:00.000Z",
          timeline: [
            {
              id: "tl_fixture_session",
              at: "2026-10-13T12:00:00Z",
              subject_name: "Example Player",
              text: "Example Player played a session of twelve recorded games across Trophy Road and ranked play.",
              evidence: {
                kind: "session",
                count: 12,
                status: "proved",
                version: "fixture",
              },
            },
          ],
        },
      ],
      "POST /api/me/timeline/seen": [
        200,
        { seen_to: "2026-10-13T12:30:00.000Z" },
      ],
    }),
  );
  await page.goto("/home");
  const sentence = page.locator(".kit-feed__text");
  const controls = page.locator(".kit-feed__links .btn");
  await expect(controls).toHaveText("Open session");
  await expect(page.locator(".kit-newmark")).toContainText("New since");
  const textBox = await sentence.boundingBox();
  const controlsBox = await controls.boundingBox();
  expect(textBox!.width).toBeGreaterThan(320);
  expect(controlsBox!.y).toBeGreaterThanOrEqual(textBox!.y + textBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "/tmp/elixir-timeline-reading-390.png",
    fullPage: false,
  });
});
