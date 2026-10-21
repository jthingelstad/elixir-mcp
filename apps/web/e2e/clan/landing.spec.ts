import { test, expect, type Page } from "@playwright/test";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/**
 * Where arriving at a clan lands. Jamie, 2026-10-20, asked whether
 * leaders should land on Actions instead of Roster: "If there are
 * actions to take, yes. Otherwise no." The fixture's person leads
 * Example Clan with two Actions waiting and is a member of Second Clan.
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

/** Marks the page if a roster heading is drawn, however briefly: the
 *  landing must not show the roster before Actions. Only a heading added
 *  or changed into "Roster" counts, so one already on screen (another
 *  clan's roster, before the switch) does not. */
async function watchForRoster(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { rosterShown?: boolean };
    w.rosterShown = false;
    const roster = (h: Element | null | undefined) =>
      h?.textContent?.trim() === "Roster";
    new MutationObserver((records) => {
      for (const r of records) {
        const at =
          r.target instanceof Element ? r.target : r.target.parentElement;
        if (roster(at?.closest("h1"))) w.rosterShown = true;
        for (const node of r.addedNodes)
          if (node instanceof Element)
            for (const h of [
              ...(node.matches("h1") ? [node] : []),
              ...node.querySelectorAll("h1"),
            ])
              if (roster(h)) w.rosterShown = true;
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}
const rosterShown = (page: Page) =>
  page.evaluate(
    () => (window as Window & { rosterShown?: boolean }).rosterShown,
  );

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

test.describe("a leader with Actions waiting", () => {
  test.beforeEach(async ({ page }) => {
    await watchForRoster(page);
    await mockApi(
      page,
      signedIn({ ...ACTIONS, "GET /api/clan/me": [200, as("leader", 2)] }),
    );
  });

  test("the clan's own address lands on Actions, and Back never returns to bounce", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV/standing");
    await expect(page.getByRole("heading", { name: "Standing" })).toBeVisible();
    await page.goto("/clan/2PQRJ8LV");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
    await expect(
      page.getByRole("heading", { name: "Actions", exact: true }),
    ).toBeVisible();
    expect(await rosterShown(page)).toBe(false);
    // The redirect replaced the clan's address: Back is the page before.
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/standing$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
  });

  test("/clan lands on the remembered clan's Actions", async ({ page }) => {
    await page.goto("/clan/2PQRJ8LV/standing");
    await page.goto("/clan/");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
    await expect(
      page.getByRole("heading", { name: "Actions", exact: true }),
    ).toBeVisible();
    expect(await rosterShown(page)).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/standing$/);
  });

  test("an address that names a section opens it: the roster, a member, an action", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV/roster");
    await expect(page.getByText("Ben")).toBeVisible();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/roster$/);
    const rail = page.locator(".rail");
    await expect(rail.getByRole("link", { name: /^Roster/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(rail.getByRole("link", { name: /^Roster/ })).toHaveAttribute(
      "href",
      "/clan/2PQRJ8LV/roster",
    );
    // A search keeps the roster's address.
    await page.getByRole("searchbox", { name: "Find a member" }).fill("Ben");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/roster\?find=Ben$/);
    await page.getByRole("link", { name: "Ben", exact: true }).click();
    await expect(page).toHaveURL(/\/members\/uq8lp2r9c\?find=Ben$/);
    // Back to the roster from a member: the roster, not the landing.
    await page.getByRole("link", { name: "Back to Example Clan" }).click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/roster\?find=Ben$/);
    await expect(
      page.getByRole("searchbox", { name: "Find a member" }),
    ).toHaveValue("Ben");
    // The breadcrumb's clan name is the roster too.
    await rail.getByRole("link", { name: /^Standing/ }).click();
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Example Clan" })
      .click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/roster$/);
    await page.goto("/clan/2PQRJ8LV/members/uq8lp2r9c");
    await expect(page).toHaveURL(/\/members\/uq8lp2r9c$/);
  });

  test("picking a clan lands on its Actions; Back is the chooser", async ({
    page,
  }) => {
    await mockApi(page, signedIn(ACTIONS));
    await page.goto("/clan/");
    await expect(page).toHaveURL(/\/clan\/clans$/);
    await page.getByText("Example Clan").first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
    await expect(
      page.getByRole("heading", { name: "Actions", exact: true }),
    ).toBeVisible();
    expect(await rosterShown(page)).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/clans$/);
  });

  test("the switcher from another clan's roster lands on Actions, with no roster first", async ({
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
    await page.goto("/clan/GQ08RJPL");
    await expect(page.getByText("Ben")).toBeVisible();
    // Only the second clan's roster so far.
    await page.evaluate(() => {
      (window as Window & { rosterShown?: boolean }).rosterShown = false;
    });
    // The roster's clan switcher (the fixture's roster is named
    // Example Clan whichever clan asks, so find it by its menu).
    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: /Example Clan/ }).click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
    await expect(
      page.getByRole("heading", { name: "Actions", exact: true }),
    ).toBeVisible();
    expect(await rosterShown(page)).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/GQ08RJPL$/);
  });
});

test("a leader with Actions waiting comes back from sign-in to Actions", async ({
  page,
}) => {
  await watchForRoster(page);
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
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("elixir.after_sign_in")),
    )
    .toBe("/clan/2PQRJ8LV");
  await page.getByRole("link", { name: "Sign in with Elixir" }).click();
  await expect(page).toHaveURL(/\/console\/signin$/);
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
  await expect(
    page.getByRole("heading", { name: "Actions", exact: true }),
  ).toBeVisible();
  expect(await rosterShown(page)).toBe(false);
  // Clan's own sign-in door is never opened: it is a write.
  expect(calls.filter((path) => path.startsWith("/api/clan/auth/"))).toEqual(
    [],
  );
});

test.describe("everyone else lands on the roster", () => {
  const CASES: [string, string, number][] = [
    ["a leader with no Actions waiting", "leader", 0],
    ["a co-leader with no Actions waiting", "coLeader", 0],
    ["an elder with Actions waiting", "elder", 2],
    ["an elder with none", "elder", 0],
    ["a member with an Action waiting", "member", 1],
  ];
  for (const [who, role, open] of CASES)
    test(who, async ({ page }) => {
      await watchForRoster(page);
      await mockApi(
        page,
        signedIn({ ...ACTIONS, "GET /api/clan/me": [200, as(role, open)] }),
      );
      await page.goto("/clan/2PQRJ8LV");
      await expect(page.getByText("Ben")).toBeVisible();
      await expect(page).toHaveURL(/\/clan\/2PQRJ8LV$/);
      // The watch sees a roster when one is drawn: its "no roster"
      // above is not vacuous.
      expect(await rosterShown(page)).toBe(true);
      await page.goto("/clan/");
      await expect(page).toHaveURL(/\/clan\/2PQRJ8LV$/);
      await expect(page.getByText("Ben")).toBeVisible();
    });

  test("a co-leader with Actions waiting is a leader here", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ ...ACTIONS, "GET /api/clan/me": [200, as("coLeader", 1)] }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
  });
});
