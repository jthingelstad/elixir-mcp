import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, ownerPassport } from "./home-fixture.ts";

const me = {
  ...ME,
  features: { comments: true, posts: true },
  claims: ME.claims.map((p) => ({ ...p, status: "verified" })),
};

for (const width of [320, 390, 1280]) {
  test(`Timeline writing at ${width}px keeps the story in reach and returns focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [200, me],
        "GET /api/me/passport": [200, ownerPassport([], { complete: true })],
        "POST /api/me/passport/reconcile": [200, {}],
        "GET /api/public/cards": [200, { cards: [] }],
        "POST /api/me/posts": [200, { ok: true }],
      }),
    );
    await page.goto("/timeline");
    const mode = page.getByRole("combobox", { name: "Mode", exact: true });
    await expect(mode).toBeVisible();
    await expect(mode).toHaveCount(1);
    const trigger =
      width < 900
        ? page.getByRole("button", { name: "Post", exact: true })
        : page.getByRole("button", {
            name: "Write a post or ask a question",
          });
    await expect(trigger).toBeVisible();
    if (width < 900) {
      const mb = (await mode.boundingBox())!;
      const pb = (await trigger.boundingBox())!;
      expect(Math.abs(mb.y - pb.y)).toBeLessThanOrEqual(1);
      expect(pb.x).toBeGreaterThanOrEqual(mb.x + mb.width);
      for (const box of [mb, pb]) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // The keyboard enters the writing field, then gets back to the same
    // visible entry point on Cancel, including the re-created wide one.
    await trigger.focus();
    await page.keyboard.press("Enter");
    const field = page.getByRole("textbox", { name: "Your post" });
    await expect(field).toBeFocused();
    await field.fill("A close battle today.");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(field).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toBeFocused();
    await page
      .getByRole("button", { name: "Ask a question", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Your question" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Your question" })
      .fill("What did you play today?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.locator("textarea")).toHaveCount(0);
    if (width < 900) {
      // A pointer activation need not focus a button (touch Safari).
      // Start elsewhere and suppress that default, while keeping the click.
      await mode.focus();
      await trigger.evaluate((button) =>
        button.addEventListener(
          "mousedown",
          (event) => event.preventDefault(),
          {
            once: true,
          },
        ),
      );
      await trigger.click();
      await expect(field).toBeFocused();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(trigger).toBeFocused();
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}

for (const state of ["loading", "failed", "quiet"] as const) {
  test(`the phone keeps Mode and Post while its feed is ${state}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const empty = { timeline: [], timeline_more: 0, week_total: 0 };
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [200, me],
        "GET /api/me/home/feed":
          state === "failed" ? [503, { error: "unavailable" }] : [200, empty],
      }),
    );
    let release = () => {};
    if (state === "loading") {
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/me/home/feed", async (route) => {
        await pending;
        await route.fulfill({ json: empty });
      });
    }
    try {
      await page.goto("/timeline");
      if (state === "loading")
        await expect(
          page.getByText("Reading the last seven days…"),
        ).toBeVisible();
      else if (state === "failed")
        await expect(
          page.getByText("Your feed could not be read just now"),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("link", { name: "Find your people" }),
        ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Mode", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Mode", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Post", exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
  });
}
