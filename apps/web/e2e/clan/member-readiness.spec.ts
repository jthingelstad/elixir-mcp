import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FIELDS, GROUPS, TABS, defaults } from "@elixir-mcp/clan-engine";
import { ME, mockApi, signedIn } from "./fixtures.ts";

for (const width of [390, 1280]) {
  test(`member evidence and small-clan policy preparation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const business: string[] = [];
    page.on("request", (r) => {
      if (
        /\/(?:decide|grants|draft|holds)$/.test(new URL(r.url()).pathname) &&
        r.method() !== "GET"
      )
        business.push(r.url());
    });
    const body = {
      name: "Ben",
      as_of: "2026-10-04T04:00:00Z",
      window: { from: "2026-09-21T00:00:00Z", to: "2026-10-04T04:00:00Z" },
      last_recorded_battle_in_clan: "2026-09-25T12:00:00Z",
      last_seen_in_game: null,
      weeks: [
        {
          iso_week: "2026-W40",
          from: "2026-09-28T00:00:00Z",
          to: "2026-10-04T04:00:00Z",
          partial: true,
          battles: 0,
          ranked_battles: null,
          donations: 14,
        },
      ],
      war_weeks: [{ season_id: 136, section_index: 3, decks: 0, points: 0 }],
      coverage: {
        available: true,
        intervals: [
          {
            from: "2026-10-01T00:00:00Z",
            to: "2026-10-02T00:00:00Z",
            expected_battles: 5,
            captured_battles: 0,
            complete: false,
          },
        ],
      },
      battles: [
        {
          battle_id: "012345abcdef",
          battle_time: "2026-09-25T12:00:00Z",
          game_mode: { name: "Trophy Road" },
          outcome: "win",
          crowns: 1,
          opponent_crowns: 0,
          url: "https://elixir.poapkings.com/battle/012345abcdef",
        },
      ],
      next_cursor: "next",
    };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/members/UQ8LP2R9C/activity": () => [
          200,
          body,
        ],
        "GET /api/clan/clans/2PQRJ8LV/policy": [
          200,
          {
            can_edit: true,
            set: false,
            members: 3,
            min_members: 10,
            big_enough: false,
            current: { values: defaults(), version: 0 },
            fields: FIELDS,
            groups: GROUPS,
            tabs: TABS,
            versions: [],
          },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await page.getByRole("link", { name: "Ben", exact: true }).click();
    await expect(page).toHaveURL(/\/members\/uq8lp2r9c$/);
    await expect(
      page.getByRole("heading", { name: "Ben · Activity" }),
    ).toBeVisible();
    await expect(
      page.getByText("Missing battles", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/No recorded activity is not proof/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Older records" }).click();
    await expect(
      page.getByRole("heading", { name: "Recorded sessions · page 2" }),
    ).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-member-activity-${width}.png`,
      fullPage: true,
    });
    await page.goto("/clan/2PQRJ8LV/manage/policy");
    await expect(
      page.getByText(/Leaders can prepare and save its policy now/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save this clan's policy" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Preview the last reviews" }),
    ).toBeDisabled();
    await page.screenshot({
      path: `/tmp/elixir-policy-prepare-${width}.png`,
      fullPage: true,
    });
    expect(business).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("switching back from two small clans restores the active clan's navigation without reloading", async ({
  page,
}) => {
  const first = ME.clans[0]!;
  const second = ME.clans[1]!;
  const third = { ...first, clan_tag: "#9PYL", name: "Third Clan" };
  let me = {
    ...ME,
    clans: [first, second, third],
    selected: first,
  };
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": () => [200, me],
      "POST /api/clan/select": (route) => {
        const tag = route.request().postDataJSON().clan_tag;
        me = {
          ...me,
          selected: me.clans.find((c) => c.clan_tag === tag)!,
          policy: { ...ME.policy, active: tag === first.clan_tag },
        };
        return [200, me];
      },
    }),
  );
  await page.goto("/clan/2PQRJ8LV");
  for (const clan of [second, third, first]) {
    await page
      .locator(".rail")
      .getByRole("link", { name: "Clans", exact: true })
      .click();
    await page.getByRole("button", { name: new RegExp(clan.name) }).click();
    const active = clan.clan_tag === first.clan_tag;
    await expect(
      page.locator(".rail").getByRole("link", { name: /^Actions/ }),
    ).toHaveCount(active ? 1 : 0);
    await expect(
      page.locator(".rail").getByRole("link", { name: /^Award history/ }),
    ).toHaveCount(active ? 1 : 0);
  }
});
