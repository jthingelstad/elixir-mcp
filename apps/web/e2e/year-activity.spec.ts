import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";
import { shapeDays } from "../../../services/web-api/src/routes/battle-activity.mjs";

const asOf = "2025-01-01T12:00:00Z";
const interval = (expected: number, captured: number) => ({
  observed_from: "2024-12-29T23:59:59Z",
  observed_to: "2025-01-01T00:00:00Z",
  expected_battles: expected,
  captured_battles: captured,
  is_complete: expected >= 0 && expected === captured,
});
const cases = [
  { name: "no observations", intervals: [], positive: true, quiet: false },
  {
    name: "no activity or nightly row",
    intervals: [],
    positive: false,
    quiet: false,
  },
  {
    name: "stale observations",
    intervals: [
      {
        ...interval(0, 0),
        observed_from: "2024-09-01T00:00:00Z",
        observed_to: "2024-09-03T00:00:00Z",
      },
    ],
    positive: true,
    quiet: false,
  },
  {
    name: "partial capture",
    intervals: [interval(5, 2)],
    positive: true,
    quiet: false,
  },
  {
    name: "counter reset",
    intervals: [interval(-1, 2)],
    positive: true,
    quiet: false,
  },
  {
    name: "complete closed days",
    intervals: [interval(2, 2)],
    positive: true,
    quiet: true,
  },
];
function evidence(capture = cases[0]!) {
  return {
    player_tag: "#20JJJ2CCRU",
    as_of: asOf,
    // A stale nightly row must not control the current year or its counts.
    computed_at: capture.name.includes("nightly")
      ? null
      : "2024-09-01T05:30:00Z",
    battles_28d: 999,
    recorded_from: "2024-09-01T00:00:00Z",
    days: shapeDays(
      {
        as_of: asOf,
        days: capture.positive ? { "2024-12-31": [2, 1, 1] } : {},
        window_days: 365,
      },
      capture.intervals,
    ),
  };
}
async function sound(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  // A panel can clip an oversized table without overflowing the document.
  // Check the list's own bounds so every count, capture label and result fits.
  const list = await page.locator(".activity__table").evaluate((el) => {
    const table = el.querySelector("table");
    return table
      ? {
          width: table.scrollWidth,
          available: el.clientWidth,
          beyond:
            table.getBoundingClientRect().right -
            el.getBoundingClientRect().right,
        }
      : { width: 0, available: 0, beyond: 0 };
  });
  expect(list.width).toBeLessThanOrEqual(list.available + 1);
  expect(list.beyond).toBeLessThanOrEqual(1);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
  ).toEqual([]);
}
for (const suffix of ["", " @narrow"]) {
  for (const path of [
    "/console/account",
    "/console/account/tracking/20JJJ2CCRU",
  ]) {
    for (const capture of cases) {
      test(`year ${path} ${capture.name} stays truthful across UTC year boundary${suffix}`, async ({
        page,
      }) => {
        if (suffix) await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.setFixedTime(new Date(asOf));
        const errors: string[] = [];
        const writes: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (
            new URL(r.url()).pathname.startsWith("/api/") &&
            r.method() !== "GET"
          )
            writes.push(r.method());
        });
        await mockApi(
          page,
          signedIn({
            "GET /api/me/battle-activity/20JJJ2CCRU": [200, evidence(capture)],
          }),
        );
        await page.goto(path);
        const graph = page.getByRole("group", {
          name: "Battles per UTC day over the last year",
        });
        await expect(graph.getByRole("button")).toHaveCount(365);
        await expect(
          graph.getByRole("button", { name: /29 Feb 2024/ }),
        ).toHaveCount(1);
        const quiet = graph.getByRole("button", { name: /30 Dec 2024/ });
        await expect(quiet).toHaveAttribute(
          "aria-label",
          capture.quiet
            ? /0 battles · covered quiet day/
            : /capture (unknown|incomplete).*no battles recorded/,
        );
        const positive = graph.getByRole("button", { name: /31 Dec 2024/ });
        if (capture.positive) {
          await expect(positive).toHaveAttribute(
            "aria-label",
            /2 battles recorded · 1 win, 1 loss/,
          );
          await expect(positive).toHaveClass(
            /activity__cell--l4.*activity__cell--w5/,
          );
          await positive.click();
          await expect(page.locator(".activity__caption")).toContainText(
            "2 battles recorded",
          );
        }
        await expect(
          graph.getByRole("button", { name: /1 Jan 2025/ }),
        ).toHaveAttribute(
          "aria-label",
          /capture (unknown|incomplete).*no battles recorded/,
        );
        await page
          .getByText("The last two weeks as a list", { exact: true })
          .click();
        const recent = page.locator(".activity__table tbody tr");
        await expect(recent).toHaveCount(14);
        await expect(recent.first()).toContainText("2025-01-01");
        await expect(recent.first()).toContainText("unknown");
        await sound(page);
        await page.reload();
        await expect(quiet).toHaveAttribute(
          "aria-label",
          capture.quiet ? /covered quiet day/ : /capture (unknown|incomplete)/,
        );
        expect(errors).toEqual([]);
        expect(writes).toEqual([]);
      });
    }
    test(`year ${path} failed initial read offers a read-only retry${suffix}`, async ({
      page,
    }) => {
      if (suffix) await page.setViewportSize({ width: 390, height: 844 });
      let failed = true;
      await mockApi(
        page,
        signedIn({
          "GET /api/me/battle-activity/20JJJ2CCRU": () =>
            failed ? [503, { error: "unavailable" }] : [200, evidence()],
        }),
      );
      await page.goto(path);
      await expect(page.getByText(/Capture is unknown/)).toBeVisible();
      await expect(page.locator(".activity__year")).toHaveCount(0);
      failed = false;
      await page.getByRole("button", { name: "Retry activity read" }).click();
      await expect(
        page.getByRole("button", { name: /31 Dec 2024: 2 battles recorded/ }),
      ).toBeVisible();
      await sound(page);
    });
    test(`year ${path} failed refresh retains positive evidence and retries${suffix}`, async ({
      page,
    }) => {
      if (suffix) await page.setViewportSize({ width: 390, height: 844 });
      let failed = false;
      await mockApi(
        page,
        signedIn({
          "GET /api/me/battle-activity/20JJJ2CCRU": () =>
            failed ? [503, { error: "unavailable" }] : [200, evidence()],
        }),
      );
      await page.clock.install({ time: new Date(asOf) });
      await page.goto(path);
      const positive = page.getByRole("button", {
        name: /31 Dec 2024: 2 battles recorded/,
      });
      await expect(positive).toBeVisible();
      failed = true;
      await page.clock.fastForward(61_000);
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      // Let the shared read retry finish; a failed refetch keeps the prior data.
      await page.clock.fastForward(5_000);
      await expect(
        page.getByText(/Showing the last successful read/),
      ).toBeVisible();
      await expect(positive).toBeVisible();
      failed = false;
      await page.getByRole("button", { name: "Retry activity read" }).click();
      await expect(
        page.getByText(/Showing the last successful read/),
      ).toHaveCount(0);
      await expect(positive).toBeVisible();
      await sound(page);
    });
  }
}
