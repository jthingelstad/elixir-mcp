/**
 * Clan as one view (slice 8, #766; Jamie, 2026-11-12: "Yes, the canvas
 * tabs"): Feed, Standings, War, Members and Policy for every member, and
 * Run for the leader and co-leaders alone. A member sees five tabs and is
 * refused Run; a leader the server refuses sees the refusal, never the
 * tools; every old address lands on its new tab; and the Feed and Policy
 * read at phone width with no serious accessibility finding. Synthetic
 * names and tags only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ME, clanTab, mockApi, signedIn } from "./fixtures.ts";

const EXAMPLE = ME.clans[0]!;

function as(role: string) {
  const selected = { ...EXAMPLE, role, role_label: role };
  return {
    ...ME,
    clans: ME.clans.map((c) =>
      c.clan_tag === EXAMPLE.clan_tag ? selected : c,
    ),
    selected,
    open_actions: 0,
  };
}

const POLICY = {
  can_edit: false,
  set: true,
  members: 12,
  min_members: 10,
  big_enough: true,
  current: {
    set: true,
    version: 2,
    saved_at: "2026-09-01T12:00:00Z",
    saved_by_name: "Ada",
    values: {},
  },
  how: [
    {
      key: "elder",
      title: "Elder",
      lines: [
        "Elder is earned by participation: Clan Wars 55%, Donations 30% and Ranked play 15%.",
      ],
    },
  ],
  weights: [
    { key: "war", label: "Clan Wars", share: 0.55 },
    { key: "donations", label: "Donations", share: 0.3 },
    { key: "ranked", label: "Ranked play", share: 0.15 },
  ],
  versions: [],
};

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    `${name}: accessibility`,
  ).toEqual([]);
}

const fitsTheScreen = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );

test("a member sees five tabs, and Run is refused", async ({ page }) => {
  let runAsked = false;
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": [200, as("member")],
      "GET /api/clan/clans/2PQRJ8LV/run": () => {
        runAsked = true;
        return [403, { error: "leaders_only" }];
      },
    }),
  );
  await page.goto("/clan/2PQRJ8LV/feed");
  for (const name of ["Standings", "War", "Members", "Policy"])
    await expect(clanTab(page, name)).toBeVisible();
  await expect(clanTab(page, /^Feed/)).toHaveAttribute("aria-selected", "true");
  await expect(clanTab(page, "Run")).toHaveCount(0);
  await expect(page.getByText("Zed posted a highlight")).toBeVisible();
  await expect(page.getByText(/Three crowns with seconds left/)).toBeVisible();
  // Typing Run's address shows the refusal, never Run's tools.
  await page.goto("/clan/2PQRJ8LV/run/about");
  await expect(
    page.getByText(/Run is for the clan.s leader and co-leaders/),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Run" })).toHaveCount(0);
  expect(runAsked).toBe(false);
});

test("a leader sees Run, opening on Waiting", async ({ page }) => {
  await mockApi(page, signedIn({ "GET /api/clan/me": [200, as("leader")] }));
  await page.goto("/clan/2PQRJ8LV/feed");
  await clanTab(page, "Run").click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/run$/);
  const list = page.getByRole("navigation", { name: "Run" });
  await expect(list.getByRole("link", { name: /^Waiting/ })).toBeVisible();
  await expect(list.getByRole("link", { name: /^Decided/ })).toBeVisible();
});

test("a leader the server refuses is shown the refusal, never Run's tools", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": [200, as("coLeader")],
      "GET /api/clan/clans/2PQRJ8LV/run": [403, { error: "leaders_only" }],
    }),
  );
  await page.goto("/clan/2PQRJ8LV/run/about");
  await expect(
    page.getByText(/Run is for the clan.s leader and co-leaders/),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Run" })).toHaveCount(0);
});

test.describe("every old address lands on its new tab", () => {
  const MOVES: [string, RegExp][] = [
    ["/clan/2PQRJ8LV", /\/clan\/2PQRJ8LV\/feed$/],
    ["/clan/2PQRJ8LV/today", /\/clan\/2PQRJ8LV\/feed$/],
    ["/clan/2PQRJ8LV/actions", /\/clan\/2PQRJ8LV\/feed$/],
    ["/clan/2PQRJ8LV/today/decided", /\/clan\/2PQRJ8LV\/run\/decided$/],
    ["/clan/2PQRJ8LV/season", /\/clan\/2PQRJ8LV\/war$/],
    ["/clan/2PQRJ8LV/season/136", /\/clan\/2PQRJ8LV\/war\/136$/],
    ["/clan/2PQRJ8LV/awards", /\/clan\/2PQRJ8LV\/standings$/],
    ["/clan/2PQRJ8LV/awards/136", /\/clan\/2PQRJ8LV\/standings\/136$/],
  ];
  for (const [from, to] of MOVES)
    test(from, async ({ page }) => {
      await mockApi(
        page,
        signedIn({ "GET /api/clan/me": [200, as("leader")] }),
      );
      await page.goto(from);
      await expect(page).toHaveURL(to);
    });
});

test("@narrow the Feed and Policy read on a phone", async ({ page }) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": [200, as("member")],
      "GET /api/clan/clans/2PQRJ8LV/policy": [200, POLICY],
    }),
  );
  await page.goto("/clan/2PQRJ8LV/feed");
  await expect(page.getByText("Zed posted a highlight")).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);
  await accessible(page, "narrow feed");
  await page.screenshot({
    path: "/tmp/elixir-clan-feed-narrow.png",
    fullPage: true,
  });
  await clanTab(page, "Policy").click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/policy$/);
  await expect(
    page.getByRole("heading", { name: "How Example Clan works" }),
  ).toBeVisible();
  await expect(page.getByText(/Clan Wars 55%, Donations 30%/)).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);
  await accessible(page, "narrow policy");
  await page.screenshot({
    path: "/tmp/elixir-clan-policy-narrow.png",
    fullPage: true,
  });
});
