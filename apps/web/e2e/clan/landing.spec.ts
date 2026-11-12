import { test, expect } from "@playwright/test";
import { ME, clanTab, mockApi, signedIn } from "./fixtures.ts";

/**
 * Where arriving at a clan lands: Today, for everyone (the redesign's
 * structure answers, A12). The fixture's person leads Example Clan with two
 * Actions waiting and is a member of Second Clan.
 */
const EXAMPLE = ME.clans[0]!;
const SECOND = ME.clans[1]!;
const ACTIONS = {
  "GET /api/clan/clans/2PQRJ8LV/actions": [
    200,
    {
      clan_tag: "#2PQRJ8LV",
      as_of: "2026-09-13T09:00:00Z",
      open: [],
      recent: [],
      decline_reasons: ["not_now", "other"],
      discord: { set: false },
    },
  ] as [number, unknown],
  "GET /api/clan/clans/2PQRJ8LV/members/UQ8LP2R9C/activity": [
    200,
    {
      name: "Ben",
      as_of: "2026-10-04T12:00:00Z",
      window: { from: "2026-09-21T00:00:00Z", to: "2026-10-04T12:00:00Z" },
      last_recorded_battle_in_clan: null,
      last_seen_in_game: null,
      weeks: [],
      war_weeks: [],
      coverage: { available: false, intervals: [] },
      battles: [],
    },
  ] as [number, unknown],
};

/** The person with `clan` selected, as `role` there, with `open`
 *  Actions waiting for them. */
function as(role: string, open: number, clan = EXAMPLE) {
  const selected = { ...clan, role, role_label: role };
  return {
    ...ME,
    clans: ME.clans.map((c) => (c.clan_tag === clan.clan_tag ? selected : c)),
    selected,
    open_actions: open,
  };
}

test.describe("arriving at a clan", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(
      page,
      signedIn({ ...ACTIONS, "GET /api/clan/me": [200, as("leader", 2)] }),
    );
  });

  test("the clan's own address lands on the Feed, and Back never returns to bounce", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV/members/standing");
    await expect(page.getByRole("heading", { name: "Standing" })).toBeVisible();
    await page.goto("/clan/2PQRJ8LV");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
    await expect(
      page.getByRole("heading", { name: "Feed", exact: true }),
    ).toBeAttached();
    await expect(clanTab(page, /^Feed/)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The redirect replaced the clan's address: Back is the page before.
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members\/standing$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
  });

  test("/clan lands on the remembered clan's Today", async ({ page }) => {
    await page.goto("/clan/2PQRJ8LV/members/standing");
    await page.goto("/clan/");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members\/standing$/);
  });

  test("an address that names a page opens it: the roster, a member, an action", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV/members");
    await expect(page.getByText("Ben")).toBeVisible();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members$/);
    await expect(clanTab(page, "Members")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(clanTab(page, "Members")).toHaveAttribute(
      "href",
      "/clan/2PQRJ8LV/members",
    );
    const rows = page.getByRole("navigation", { name: "Members" });
    await expect(rows.getByRole("link", { name: "Roster" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // A search is the roster's address.
    const find = page.getByRole("searchbox", { name: "Find a member" });
    await find.fill("Ben");
    await find.press("Enter");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members\?find=Ben$/);
    // A name opens the player page (slice 8, #766); the member's page in
    // this clan keeps its address, and the roster's search.
    await expect(
      page.getByRole("link", { name: "Ben", exact: true }),
    ).toHaveAttribute("href", "/home/player/UQ8LP2R9C");
    await page.goto("/clan/2PQRJ8LV/members/uq8lp2r9c?find=Ben");
    await expect(page).toHaveURL(/\/members\/uq8lp2r9c\?find=Ben$/);
    // Back to the roster from a member: the roster, not the landing.
    await page.getByRole("link", { name: /Back to Members/ }).click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members\?find=Ben$/);
    await expect(find).toHaveValue("Ben");
    await rows.getByRole("link", { name: "Standing" }).click();
    await expect(page).toHaveURL(/\/members\/standing$/);
    await page.goto("/clan/2PQRJ8LV/members/uq8lp2r9c");
    await expect(page).toHaveURL(/\/members\/uq8lp2r9c$/);
  });

  test("picking a clan lands on its Feed; Back is the chooser", async ({
    page,
  }) => {
    await mockApi(page, signedIn(ACTIONS));
    await page.goto("/clan/clans");
    await page.getByText("Example Clan").first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/clans$/);
  });

  test("the Clan picker from another clan's roster lands on the Feed", async ({
    page,
  }) => {
    // Selected: Second Clan, where the person is a member.
    let me = as("member", 0, SECOND);
    await mockApi(
      page,
      signedIn({
        ...ACTIONS,
        "GET /api/clan/me": () => [200, me],
        "POST /api/clan/select": (route) => {
          const tag = route.request().postDataJSON().clan_tag;
          me =
            tag === EXAMPLE.clan_tag
              ? as("leader", 2)
              : as("member", 0, SECOND);
          return [200, me];
        },
      }),
    );
    await page.goto("/clan/GQ08RJPL/members");
    await expect(page.getByText("Ben")).toBeVisible();
    await page
      .getByRole("combobox", { name: "Clan" })
      .selectOption("#2PQRJ8LV");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Example Clan",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/GQ08RJPL\/members$/);
  });
});

test("coming back from sign-in lands on the Feed", async ({ page }) => {
  let authed = false;
  const answers = signedIn(ACTIONS);
  const calls: string[] = [];
  page.on("request", (r) => calls.push(new URL(r.url()).pathname));
  await mockApi(page, {
    ...answers,
    "GET /api/me": () =>
      authed
        ? (answers["GET /api/me"] as [number, unknown])
        : [200, { authenticated: false }],
    "GET /api/clan/me": () => [
      authed ? 200 : 401,
      authed ? as("leader", 2) : { error: "signed_out" },
    ],
    "POST /api/auth": [200, { ok: true }],
    "POST /api/auth/code": () => {
      authed = true;
      return [200, { ok: true }];
    },
  });
  await page.goto("/clan/2PQRJ8LV");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
  // Clan's own sign-in door is never opened: it is a write.
  expect(calls.filter((path) => path.startsWith("/api/clan/auth/"))).toEqual(
    [],
  );
});

test.describe("everyone lands on the Feed", () => {
  const CASES: [string, string, number][] = [
    ["a leader with no Actions waiting", "leader", 0],
    ["a co-leader with Actions waiting", "coLeader", 1],
    ["an elder with Actions waiting", "elder", 2],
    ["an elder with none", "elder", 0],
    ["a member with an Action waiting", "member", 1],
  ];
  for (const [who, role, open] of CASES)
    test(who, async ({ page }) => {
      await mockApi(
        page,
        signedIn({ ...ACTIONS, "GET /api/clan/me": [200, as(role, open)] }),
      );
      await page.goto("/clan/2PQRJ8LV");
      await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
      await expect(clanTab(page, /^Feed/)).toBeVisible();
      await expect(clanTab(page, "Run")).toHaveCount(
        ["leader", "coLeader"].includes(role) ? 1 : 0,
      );
      await page.goto("/clan/");
      await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
    });
});
