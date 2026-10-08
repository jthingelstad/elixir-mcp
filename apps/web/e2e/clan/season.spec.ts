import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seasonReport } from "@elixir-mcp/clan-engine";
import { seasonRecordFixture } from "@elixir-mcp/clan-engine/fixtures";
import { ME, mockApi, signedIn } from "./fixtures.ts";

const base = "/clan/2PQRJ8LV";
const apiPath = "/api/clan/clans/2PQRJ8LV/season";
const fixture = () => {
  const f = seasonRecordFixture();
  return {
    clan_tag: f.part.clan_tag,
    clan_name: f.part.name,
    as_of: new Date().toISOString(),
    freshness_seconds: 300,
    ...seasonReport(f.part, f),
  };
};

for (const width of [390, 1280]) {
  for (const role of ["leader", "member", "unverified"]) {
    test(`season record for ${role} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const first = {
        ...ME.clans[0]!,
        role: role === "leader" ? "leader" : "member",
        role_label: role === "leader" ? "Leader" : "Member",
        verified: role !== "unverified",
      };
      const me = {
        ...ME,
        clans: [first],
        selected: first,
        open_actions: 0,
        policy: { set: false, active: false, members: 3 },
        identities: ME.identities.map((p) => ({
          ...p,
          role: first.role,
          claim_status: first.verified ? "verified" : "unverified",
        })),
      };
      let reads = 0;
      const writes: string[] = [],
        errors: string[] = [];
      page.on("request", (r) => {
        if (
          new URL(r.url()).pathname.startsWith("/api/") &&
          r.method() !== "GET"
        )
          writes.push(r.method() + " " + r.url());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await mockApi(
        page,
        signedIn({
          "GET /api/clan/me": [200, me],
          [`GET ${apiPath}`]: () => {
            reads++;
            return [200, fixture()];
          },
        }),
      );
      await page.goto(`${base}/season/136`);
      await expect(
        page.getByRole("heading", { name: "Season 136", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("group", { name: "Recorded season totals" }),
      ).toContainText("18,100");
      await expect(page.getByRole("table")).toContainText("Partial readings");
      await expect(page.locator("main")).toContainText(
        "2 current and 1 former",
      );
      await expect(page.locator("main")).toContainText(
        "Closed · partial record",
      );
      await expect(page.locator("main")).not.toContainText(
        /inactive|win rate|donations/i,
      );
      const a11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        a11y.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const tableRegion = page.getByRole("region", { name: "Race by race" });
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      if (
        width === 390 &&
        (await tableRegion.evaluate((el) => el.scrollWidth > el.clientWidth))
      ) {
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => tableRegion.evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(0);
      }
      await tableRegion.evaluate((el) => {
        el.scrollLeft = 0;
      });
      await page.screenshot({
        path: `/tmp/clan-season-${role}-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("combobox", { name: "Season", exact: true })
        .selectOption("137");
      await expect(page).toHaveURL(`${base}/season/137`);
      await expect(
        page.getByRole("heading", { name: "Season 137", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("table")).toContainText("Upcoming");
      await expect(page.getByRole("table")).toContainText("So far");
      expect(reads).toBe(1);
      await page.goBack();
      await expect(
        page.getByRole("heading", { name: "Season 136", exact: true }),
      ).toBeVisible();
      expect(reads).toBe(1);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Season 136", exact: true }),
      ).toBeVisible();
      expect(reads).toBe(2);
      await expect(
        page.getByRole("link", { name: "The week ›", exact: true }),
      ).toHaveAttribute("href", `${base}/week`);
      if (width === 390)
        await page
          .getByRole("button", { name: /Season.*Example Clan/ })
          .click();
      await expect(
        page
          .locator(".rail")
          .getByRole("link", { name: "Season", exact: true }),
      ).toHaveAttribute("href", `${base}/season`);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("season distinguishes no capture, missing races and unavailable reads", async ({
  page,
}) => {
  const first = ME.clans[0]!;
  const f = seasonRecordFixture();
  f.part.war_weeks.pop();
  f.part.war_weeks[1]!.section_index = 99;
  let failed = false;
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": [200, { ...ME, selected: first }],
      [`GET ${apiPath}`]: () =>
        failed
          ? [503, { error: "elixir_unavailable" }]
          : [200, { ...fixture(), ...seasonReport(f.part, f) }],
    }),
  );
  await page.goto(`${base}/season`);
  await expect(page.getByRole("table")).toContainText("Not recorded");
  await expect(
    page.getByRole("group", { name: "Recorded season totals" }),
  ).toContainText("—");
  await page
    .getByRole("combobox", { name: "Season", exact: true })
    .selectOption("136");
  await expect(page.getByRole("table")).toContainText("Not recorded");
  await expect(page.locator("main")).toContainText("partial record");
  await page.goto(`${base}/season/100`);
  await expect(page.getByRole("alert")).toContainText("outside this read");
  failed = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("did not answer", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("group", { name: "Recorded season totals" }),
  ).toHaveCount(0);
});

test("season API refusal shows no totals for a revoked clan entitlement", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
      [`GET ${apiPath}`]: [403, { error: "not_your_clan" }],
    }),
  );
  await page.goto(`${base}/season/136`);
  await expect(page.getByRole("alert")).toContainText("does not allow");
  await expect(
    page.getByRole("group", { name: "Recorded season totals" }),
  ).toHaveCount(0);
});
