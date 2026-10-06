import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";
import { explore } from "./ladder-fixture.ts";
import { ME as CLAN_ME, signedIn as clanSignedIn } from "./clan/fixtures.ts";

async function soundPage(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
}

const interval = (expected = 0, captured = 0) => ({
  observed_from: "2026-09-13T04:59:00Z",
  observed_to: "2026-09-15T05:00:00Z",
  expected_battles: expected,
  captured_battles: captured,
  is_complete: expected === captured,
});
const cases = [
  { name: "never", intervals: [], quiet: false },
  { name: "failed", intervals: [], quiet: false },
  {
    name: "stale",
    intervals: [
      {
        ...interval(),
        observed_from: "2026-09-09T04:59:00Z",
        observed_to: "2026-09-10T05:00:00Z",
      },
    ],
    quiet: false,
  },
  { name: "partial", intervals: [interval(1, 0)], quiet: false },
  { name: "current complete", intervals: [interval()], quiet: true },
];

for (const suffix of ["", " @narrow"]) {
  for (const capture of cases) {
    test(`days keep positive battles and evidence-based zeros with ${capture.name} capture${suffix}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-09-29T21:00:00Z"));
      const base = explore();
      await mockApi(
        page,
        signedIn({
          "POST /api/explore": (route) => {
            const { tool } = route.request().postDataJSON();
            if (tool !== "elixir_coverage") return base(route);
            if (capture.name === "failed")
              return [503, { error: "unavailable" }];
            return [
              200,
              {
                tool,
                is_error: false,
                body: {
                  observation_intervals: capture.intervals,
                  // Even a fresh successful poll and perfect average cannot fill a gap.
                  polls: [
                    {
                      endpoint: "player",
                      last_admitted_at: "2026-09-29T20:59:00Z",
                    },
                  ],
                  completeness_last_7_days: { average_ratio: 1 },
                },
              },
            ];
          },
        }),
      );
      await page.goto("/ladder/days");
      await expect(
        page.getByRole("heading", { name: "17 days with recorded battles" }),
      ).toBeVisible();
      const days = page.locator(".ladder-cal > li:not(.ladder-day--blank)");
      await expect(days.nth(3).locator(".ladder-day__n")).toHaveText("4");
      const empty = days.nth(6); // Sep 13, a closed whole day without a captured battle.
      if (capture.quiet) {
        await expect(empty).toContainText("no recorded battles · covered day");
        await expect(empty.locator(".ladder-day__n")).toHaveText("0");
        await expect(page.locator(".ladder-tile").last()).toContainText(
          "2 days",
        );
      } else {
        await expect(empty).toContainText(/capture unknown|capture incomplete/);
        await expect(empty.locator(".ladder-day__n")).toHaveCount(0);
        await expect(page.locator(".ladder-tile").last()).toContainText(
          "Unknown",
        );
      }
      await expect(days.nth(22)).toContainText("today · capture incomplete");
      await page.reload();
      await expect(empty).toContainText(
        capture.quiet ? "covered day" : /capture unknown|capture incomplete/,
      );
      await soundPage(page);
      expect(errors).toEqual([]);
    });
  }

  for (const knownAbsence of [false, true]) {
    test(`Clan ${knownAbsence ? "dates observed absence" : "waits for unknown membership"}${suffix}`, async ({
      page,
    }) => {
      const me = {
        ...CLAN_ME,
        ok: false,
        reason: knownAbsence ? "no_clan" : "membership_unknown",
        clans: [],
        selected: null,
        identities: [
          {
            ...CLAN_ME.identities[0],
            clan_tag: null,
            role: null,
            membership_capture: knownAbsence
              ? { state: "none", observed_at: "2026-09-01T12:00:00Z" }
              : { state: "unknown", observed_at: null },
          },
        ],
      };
      await mockApi(page, clanSignedIn({ "GET /api/clan/me": [200, me] }));
      await page.goto("/clan");
      await expect(
        page.getByRole("heading", {
          name: knownAbsence
            ? "No clan in your recorded profiles"
            : "Waiting for your clan record",
        }),
      ).toBeVisible();
      await expect(
        page
          .locator(".clan-main")
          .getByRole("link", { name: /Manage|Actions|Policy/ }),
      ).toHaveCount(0);
      if (knownAbsence) {
        await expect(page.getByText(/no clan observed/)).toContainText("09-01");
        await expect(page.getByText(/If that is still accurate/)).toBeVisible();
      } else {
        await expect(page.getByText(/join a clan in the game/i)).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: "Elixir → Tracking" }),
        ).toBeVisible();
      }
      await page.getByRole("button", { name: /check again/i }).click();
      await expect(
        page.getByRole("heading", {
          name: knownAbsence
            ? "No clan in your recorded profiles"
            : "Waiting for your clan record",
        }),
      ).toBeVisible();
      await soundPage(page);
    });
  }
}
