import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./clan/fixtures.ts";

// A configured UI is exercised entirely against the existing route fixtures.
// Merely opening editors must not change the clan's settings or send messages.
for (const width of [390, 820, 1280]) {
  test(`settings drawers preserve keyboard focus and model shortcuts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (req.method() !== "GET" && !req.url().endsWith("/api/clan/select"))
        writes.push(req.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/2PQRJ8LV/social": [200, { enabled: true }],
        "GET /api/clan/clans/2PQRJ8LV/discord": [200, { set: false }],
        "GET /api/clan/clans/2PQRJ8LV/model": [
          200,
          {
            set: false,
            uses: { today: 0, recent: [] },
            per_day: 20,
            keep_days: 90,
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/sharing": [200, { types: {} }],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/manage/settings#settings-model");
    const model = page.getByRole("dialog", { name: "Clan model", exact: true });
    await expect(model).toBeVisible();
    await expect(model.getByLabel("Add the clan's key")).toHaveAttribute(
      "type",
      "password",
    );
    await page.keyboard.press("Escape");
    await expect(model).toHaveCount(0);
    const trigger = page.getByRole("button", {
      name: "Manage Member map",
      exact: true,
    });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Member map", exact: true });
    await expect(
      sheet.getByRole("button", { name: "Turn social features off" }),
    ).toBeEnabled();
    await expect(
      sheet.getByRole("button", { name: "Close", exact: true }),
    ).toBeFocused();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(trigger).toBeFocused();
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

for (const width of [390, 1280]) {
  test(`Timeline sharing discards an unsaved webhook on Escape at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET") writes.push(req.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/me/timeline/discord": [
          200,
          {
            enabled: true,
            webhook: "discord.com/api/webhooks/1234…/fixture…",
            delivery: null,
          },
        ],
      }),
    );
    await page.goto("/console/account/timeline");
    await page
      .getByRole("button", { name: "Manage sharing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Change webhook", exact: true })
      .click();
    await page
      .getByLabel("Discord webhook URL")
      .fill("https://discord.com/api/webhooks/1234/fixture-unsaved");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Manage sharing", exact: true })
      .click();
    await expect(page.getByLabel("Discord webhook URL")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Change webhook", exact: true })
      .click();
    await expect(page.getByLabel("Discord webhook URL")).toHaveValue("");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(writes).toEqual([]);
  });
}

test("@narrow a timeline event keeps its reading width when evidence and the New mark are present", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(
    page,
    signedIn({
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
  await page.goto("/console/account/timeline");
  const sentence = page.locator(".timeline-list__text");
  const controls = page.locator(".timeline-list__actions");
  await expect(
    controls.getByRole("button", { name: "View games" }),
  ).toBeVisible();
  await expect(controls.getByText("New", { exact: true })).toBeVisible();
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
