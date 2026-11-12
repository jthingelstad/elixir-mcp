import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ME,
  SIGNED_OUT,
  mockApi,
  signedIn,
  railStaysInView,
} from "./fixtures.ts";
import { HOME_READS } from "./home-fixture.ts";

/** Nothing serious or critical, on every page a journey lands on. */
async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${name}: accessibility`,
  ).toEqual([]);
}

/** The page rendered its route, not the error boundary. */
async function rendered(page: Page) {
  await expect(page.locator("main")).not.toContainText("failed to render");
}

test.describe("signed out", () => {
  test("a page that needs a session meets the sign-in wall, and the way in is on the bar", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/settings/profile");
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    await expect(page.locator(".kit-top [aria-current]")).toHaveCount(0);
    await expect(
      page.locator(".kit-top").getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/signin");
    await expect(
      page.locator(".kit-top").getByRole("link", { name: "Create account" }),
    ).toHaveAttribute("href", "/signin?signup");
    // Signed out there are no phone tabs to reach for.
    await expect(page.locator(".kit-bottom")).toHaveCount(0);
    await expect(page.locator(".rail")).toHaveCount(0);
    await accessible(page, "sign-in wall");
  });

  test("every old address lands somewhere, and the ADDRESS BAR follows", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    for (const [old, now] of [
      // The Console folded (2026-11-12): the service page's public half
      // is the site's /data, its staff half is under Settings > Admin.
      ["/console/status", /\/data$/],
      ["/console/status/service", /\/data$/],
      ["/data/service", /\/data$/],
      ["/console/admin", /\/settings\/admin\/requests$/],
      ["/console/admin/accounts", /\/settings\/admin\/accounts$/],
      ["/console/account", /\/home$/],
      ["/console/account/overview", /\/home$/],
      ["/console/account/timeline", /\/home$/],
      ["/console/account/activity", /\/home$/],
      ["/home/timeline", /\/home$/],
      ["/home/friends", /\/home\/find$/],
      ["/console/signin", /\/signin$/],
      ["/console/signin?signup", /\/signin\?signup/],
      // Explore folded (2026-11-12) into Find, the player page, the
      // battle page and Clan.
      ["/console/explore", /\/home\/find$/],
      ["/console/explore/player", /\/home\/find$/],
      ["/console/explore/player/%2320JJJ2CCRU", /\/home\/player\/20JJJ2CCRU$/],
      ["/console/explore/clan/J2RGCRVG", /\/clan\/directory$/],
      ["/console/explore/deck/abc123", /\/home\/you\/stats\/decks$/],
    ] as const) {
      await page.goto(old);
      await expect(page, old).toHaveURL(now);
    }
    // The bare old address is Home (signed out, its sign-in wall).
    await page.goto("/console");
    await expect(page).toHaveURL(/\/home$/);
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
  });

  test("an address under the app that is nothing says so, with the bar and the disclaimer", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/home/not-a-place");
    await expect(page).toHaveURL(/\/home\/not-a-place$/);
    await expect(
      page.getByRole("heading", { name: "Nothing at this address" }),
    ).toBeVisible();
    // One bar and one footer: the page draws its own shell, alone.
    await expect(page.locator(".kit-top")).toHaveCount(1);
    await expect(page.locator(".kit-foot .disclaimer__text")).toHaveCount(1);
  });

  test("the Console's old root addresses are not aliased: a miss is a miss", async ({
    page,
  }) => {
    // Jamie, 2026-09-28: one origin, the Console under /console, and no
    // redirects from where it was. Outside the prefix every path is a
    // site document, so a page the site does not build is an honest 404,
    // never the app shell.
    for (const old of ["/account/overview", "/not-a-place"]) {
      const res = await page.goto(old);
      expect(res?.status(), old).toBe(404);
      await expect(page.locator("#root")).toHaveCount(0);
    }
  });

  test("sign in: email, then the six-digit code, then Home", async ({
    page,
  }) => {
    let authed = false;
    await mockApi(page, {
      "GET /api/me": () => [200, authed ? ME : SIGNED_OUT],
      "POST /api/auth": [200, { ok: true }],
      "POST /api/auth/code": () => {
        authed = true;
        return [200, { ok: true }];
      },
      ...Object.fromEntries(
        Object.entries(signedIn()).filter(([k]) => k !== "GET /api/me"),
      ),
    });
    await page.goto("/signin");
    await page.getByLabel("Email").fill("jamie@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(
      page
        .locator(".kit-bottom a[aria-current], .kit-top__nav a[aria-current]")
        .first(),
    ).toHaveText(/Home/);
    await rendered(page);
  });

  test("a deep link survives sign-in", async ({ page }) => {
    let authed = false;
    await mockApi(page, {
      "GET /api/me": () => [200, authed ? ME : SIGNED_OUT],
      "POST /api/auth": [200, { ok: true }],
      "POST /api/auth/code": () => {
        authed = true;
        return [200, { ok: true }];
      },
      ...Object.fromEntries(
        Object.entries(signedIn()).filter(([k]) => k !== "GET /api/me"),
      ),
    });
    await page.goto("/settings/usage");
    await page.getByRole("link", { name: "Sign in" }).first().click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.getByLabel("Email").fill("jamie@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/settings\/usage$/);
  });
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, signedIn());
  });

  test("the bar's account button is the person; its menu holds the players, Settings and the way out", async ({
    page,
  }) => {
    await page.goto("/home");
    const me = page.getByRole("button", { name: "Account: King Thing" });
    await expect(me).toBeVisible();
    await me.click();
    const menu = page.locator("#account-menu");
    await expect(menu).toContainText("jamie@example.com");
    await expect(
      menu.getByRole("link", { name: /King Thing/ }),
    ).toHaveAttribute("href", /\/home\/you\/stats/);
    await accessible(page, "account menu");
    await menu.getByRole("link", { name: /Settings/ }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(menu).toHaveCount(0);
  });

  test("the rail: counts, and every section renders its chunk", async ({
    page,
  }) => {
    await page.goto("/settings/profile");
    const rail = page.locator(".rail");
    await expect(rail).toBeVisible();
    // Counts are the reader's own things.
    await expect(rail.getByRole("link", { name: /Players/ })).toContainText(
      "1",
    );
    await accessible(page, "settings");

    // Every section is its own lazy chunk: each must arrive and render.
    const sections: [string, RegExp, string][] = [
      ["Players", /\/settings\/players$/, "Players"],
      ["Emails", /\/settings\/emails$/, "Emails"],
      ["Usage", /\/settings\/usage$/, "Usage"],
      ["Connections", /\/settings\/connections$/, "Connections"],
    ];
    for (const [label, url, heading] of sections) {
      await rail
        .getByRole("link", { name: new RegExp(`^${label}`) })
        .first()
        .click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        heading,
      );
      await rendered(page);
    }
    // Admin is drawn for staff only: a member's rail has no Admin, and
    // an Admin address says it is for staff, never what is on it.
    await expect(rail.getByRole("link", { name: /^Admin/ })).toHaveCount(0);
    await page.goto("/settings/admin/service");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "This page is for Elixir",
    );
    await expect(page.getByRole("link", { name: /^Fleet/ })).toHaveCount(0);
    // Home's feed (#765), for an account whose player is on record.
    await mockApi(page, signedIn(HOME_READS));
    await page.goto("/home");
    const session = page
      .locator(".kit-feed__item")
      .filter({ hasText: "Played a battle session." });
    await expect(session).toBeVisible();
    // Rows say nothing of what connections have read (2026-10-20); a first
    // visit, with no place yet, marks nothing new.
    await expect(session).not.toContainText("Unread by connections");
    await expect(page.locator(".kit-newmark")).toHaveCount(0);
    // Help opens over the page you are on, and links what you have filed.
    await page.goto("/home/find");
    await page.getByRole("button", { name: "Help for this page" }).click();
    const help = page.getByRole("dialog");
    await expect(help).toBeVisible();
    await expect(help.getByLabel("Something wrong, or missing?")).toBeVisible();
    await expect(page).toHaveURL(/\/home\/find$/);
    await accessible(page, "help drawer");
    await help.getByRole("link", { name: /feedback/i }).click();
    await expect(page).toHaveURL(/\/settings\/feedback$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Feedback",
    );
    await rendered(page);

    // The MCP request log left the rail for Usage (canvas 2026-09-29):
    // one link from the page, and Usage stays lit while you read it.
    await rail.getByRole("link", { name: /^Usage/ }).click();
    await page
      .getByRole("main")
      .getByRole("link", { name: "Requests", exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings\/usage\/requests$/);
    await expect(rail.getByRole("link", { name: /^Usage/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await rendered(page);
    await accessible(page, "requests log");
  });

  test("Settings has one rail and no switcher; an agent is a page with five tabs", async ({
    page,
  }) => {
    const agent = {
      account_id: "00000000-0000-4000-8000-000000000002",
      kind: "agent",
      public_id: "abc12345",
      role: "member",
      status: "approved",
      name: "poap-bot",
      created_at: "2026-09-01T00:00:00Z",
      calls_7d: 0,
      last_call_at: null,
      timeline_pending: 0,
      clans: [],
      last_seen: null,
      refusals_7d: [],
      tokens: [],
    };
    await mockApi(page, {
      ...signedIn(),
      "GET /api/me": [
        200,
        {
          ...ME,
          is_admin: true,
          agents: [{ public_id: "abc12345", name: "poap-bot", role: "member" }],
        },
      ],
      "GET /api/me/principals": [200, { agents: [agent], addable_clans: [] }],
      "GET /api/agent/abc12345": [
        200,
        { ...ME, kind: "agent", name: "poap-bot", email: null, claims: [] },
      ],
    });
    await page.goto("/settings/profile");
    const rail = page.getByRole("navigation", { name: "Settings sections" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("link", { name: /Profile/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".rail button.rail__switch-head")).toHaveCount(0);
    await accessible(page, "settings rail");

    await rail.getByRole("link", { name: /Connections/ }).click();
    await page
      .getByRole("link", { name: /poap-bot/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/settings\/agents\/abc12345/);
    const tabs = page.getByRole("tablist");
    for (const name of [
      "Overview",
      "What it reads",
      "Usage",
      "Connections",
      "Settings",
    ])
      await expect(tabs.getByRole("tab", { name })).toBeVisible();
    await expect(
      rail.getByRole("link", { name: /Connections/ }),
    ).toHaveAttribute("aria-current", "page");
    await accessible(page, "agent page");
  });

  test("opening Home's feed clears its count and rules off what is new since the last visit; an empty week says so", async ({
    page,
  }) => {
    // Jamie, 2026-10-20: "timeline should be independent of what agents
    // have seen via MCP." The Console keeps its own place: the page moves
    // it to the window it showed, and the rail's dot counts against it.
    const TO = "2026-09-12T16:00:00.000Z";
    const item = (text: string, at: string) => ({
      at,
      observed_at: at,
      subject_tag: "#20JJJ2CCRU",
      subject_name: "King Thing",
      kind: "battle_session",
      section: "battles",
      text,
      facts: { battles: 3 },
    });
    let items: Record<string, unknown>[] = [
      item("The latest sitting.", "2026-09-12T15:30:00Z"),
      item("A sitting since.", "2026-09-12T15:00:00Z"),
      item("A sitting you saw.", "2026-09-12T12:00:00Z"),
      item("An older sitting.", "2026-09-11T12:00:00Z"),
    ];
    let seenTo = "2026-09-12T13:00:00.000Z";
    const marks: unknown[] = [];
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/"))
        writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await mockApi(page, {
      ...signedIn(HOME_READS),
      // The server's count: news since the Console's own place.
      "GET /api/me": () => [
        200,
        {
          ...ME,
          signals: { ...ME.signals, timeline_pending: seenTo < TO ? 1 : 0 },
        },
      ],
      "GET /api/me/timeline": () => [
        200,
        {
          window: { from: "2026-09-05T16:00:00.000Z", to: TO },
          seen_to: seenTo,
          timeline: items,
        },
      ],
      "POST /api/me/timeline/seen": (route) => {
        const body = route.request().postDataJSON();
        marks.push(body);
        seenTo = body.to;
        return [200, { seen_to: seenTo }];
      },
    });
    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Home");
    // The page marks the window it showed, once, and the dot follows.
    await expect.poll(() => marks).toEqual([{ to: TO }]);
    // The rule sits under the last new row, drawn from the place as the
    // page opened, so it holds after the write moved it.
    const list = page.locator(".kit-feed__text, .kit-newmark");
    await expect(list).toHaveText([
      /The latest sitting\./,
      /A sitting since\./,
      /New since your last visit/,
      /A sitting you saw\./,
      /An older sitting\./,
    ]);
    await expect(page.locator("main")).not.toContainText(
      "Unread by connections",
    );
    await rendered(page);
    await accessible(page, "Home's feed, new since your last visit");
    // The page's one write is the Console's own place: nothing an
    // agent reads moves.
    expect(writes).toEqual(["POST /api/me/timeline/seen"]);

    // A return visit opens from the place the last one left: nothing is
    // new, there is no rule and no dot, and the same window is not
    // marked twice.
    await page.reload();
    await expect(list.filter({ hasText: "An older sitting." })).toBeVisible();
    await expect(page.locator(".kit-newmark")).toHaveCount(0);
    expect(marks).toHaveLength(1);

    // A quiet week: no rows, the empty line, and still no dot.
    items = [];
    await page.reload();
    await expect(
      page.getByText(/^Nothing in the last seven days/),
    ).toBeVisible();
    await rendered(page);
  });

  test("a form unlock reads as its sentence beside its own WHEN column (9.14.0, #110)", async ({
    page,
  }) => {
    // The server writes the text (itemText), time-free since 11.8.0
    // (#373); the console shows it after its own WHEN column.
    await mockApi(page, {
      ...signedIn(HOME_READS),
      "GET /api/me/timeline": [
        200,
        {
          timeline: [
            {
              at: "2026-09-20T10:05:00Z",
              observed_at: "2026-09-20T10:05:00Z",
              subject_tag: "#20JJJ2CCRU",
              subject_name: "King Thing",
              kind: "card_form_unlocked",
              section: "collection",
              text: "King Thing unlocked Hero Valkyrie.",
              facts: {
                card: "Valkyrie",
                card_id: 26000011,
                rarity: "rare",
                form: "hero",
              },
            },
          ],
          seen_to: null,
        },
      ],
    });
    await page.goto("/console/account/timeline");
    await expect(page).toHaveURL(/\/home$/);
    const row = page.locator(".kit-feed__item").filter({
      hasText: "King Thing unlocked Hero Valkyrie.",
    });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".kit-feed__text")).toBeVisible();
    await rendered(page);
    await accessible(page, "timeline, form unlock");
  });

  test("Service: Admin's service page draws the capture charts and auto-refresh is off and visible", async ({
    page,
  }) => {
    await mockApi(page, {
      ...signedIn(),
      "GET /api/me": [200, { ...ME, is_admin: true }],
    });
    await page.goto("/settings/admin/service");
    await expect(
      page.getByRole("heading", { name: "Service", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: /fetches per 5 minutes/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /auto-refresh off/ }),
    ).toBeVisible();
    await rendered(page);
    await accessible(page, "status");
  });

  test("Back to a record you just left is served, and a data mutation moves the rail's count", async ({
    page,
  }) => {
    let claims: Record<string, unknown>[] = ME.claims;
    await mockApi(page, {
      ...signedIn(),
      "GET /api/me": () => [
        200,
        { ...ME, claims, signals: { ...ME.signals, tracking: claims.length } },
      ],
      "POST /api/claims": () => {
        claims = [
          ...claims,
          {
            player_tag: "#VJQV8G8RL",
            name: "Spry Kestrel",
            is_primary: false,
            relationship: "alt",
            claim_status: "unverified",
          },
        ];
        return [200, { ok: true }];
      },
    });
    await page.goto("/settings/players");
    await expect(
      page.locator(".rail").getByRole("link", { name: /Players/ }),
    ).toContainText("1");
    await page.getByPlaceholder("#2PYQ8GJ0").fill("#VJQV8G8RL");
    await page.getByRole("button", { name: "Track" }).first().click();
    // The claim invalidates ["me"]: the rail's count follows without a reload.
    await expect(
      page.locator(".rail").getByRole("link", { name: /Players/ }),
    ).toContainText("2");
  });

  test("an agent whose key was revoked is issued a new one, and a refusal says why (#130)", async ({
    page,
  }) => {
    const PUBLIC_ID = "a1b2c3d4e5f6";
    const agent = {
      account_id: "00000000-0000-4000-8000-000000000001",
      kind: "agent",
      public_id: PUBLIC_ID,
      role: "member",
      status: "approved",
      name: "clan-bot",
      created_at: "2026-09-01T00:00:00Z",
      calls_7d: 0,
      last_call_at: null,
      timeline_pending: 0,
      clans: [],
      last_seen: null,
      refusals_7d: [],
      tokens: [
        {
          token_id: "t1",
          name: "clan-bot",
          scope: "cr:read",
          created_at: "2026-09-01T00:00:00Z",
          last_used_at: "2026-09-20T00:00:00Z",
          revoked_at: "2026-09-27T00:00:00Z",
        },
      ],
    };
    let answer: [number, unknown] = [
      409,
      {
        ok: false,
        error: "name_taken",
        message:
          "Another of your agents is now called clan-bot. Rename that one first, then issue this agent its new key.",
      },
    ];
    await mockApi(page, {
      ...signedIn(),
      "GET /api/me": [
        200,
        {
          ...ME,
          agents: [{ account_id: agent.account_id, public_id: PUBLIC_ID }],
        },
      ],
      "GET /api/me/principals": [200, { agents: [agent], addable_clans: [] }],
      [`GET /api/agent/${PUBLIC_ID}`]: [
        200,
        { ...ME, email: null, claims: [], recordings: [] },
      ],
      "POST /api/me/principals/rotate": () => answer,
    });
    await page.goto(`/settings/agents/${PUBLIC_ID}/overview`);
    await expect(page.getByText("No live key.")).toBeVisible();

    await page.goto(`/settings/agents/${PUBLIC_ID}/settings`);
    const issue = page.getByRole("button", { name: "Issue a new key" });
    await expect(issue).toBeEnabled();

    // Refused: the name moved to another agent since the revoke.
    const confirmIssue = () =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Issue a new key" })
        .click();
    await issue.click();
    await confirmIssue();
    await expect(page.getByRole("alert")).toContainText(
      "Another of your agents is now called clan-bot",
    );
    await expect(page.getByText("Copy this key now.")).toHaveCount(0);
    await rendered(page);
    await accessible(page, "agent settings, issue refused");

    // Issued: the key is handed over once.
    answer = [200, { ok: true, token: "svt_fixture_not_a_real_key" }];
    await confirmIssue();
    await expect(page.getByText("Copy this key now.")).toBeVisible();
    await expect(page.getByText("svt_fixture_not_a_real_key")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("the rail stays in view down a long page, its foot in reach", async ({
    page,
  }) => {
    await page.goto("/settings/connections");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Connections",
    );
    await railStaysInView(
      page,
      page.locator(".rail").getByRole("link", { name: "Feedback" }),
    );
  });

  test("@narrow the folded rail names where you are; a count is not a mark", async ({
    page,
  }) => {
    await page.goto("/settings/usage");
    const toggle = page.locator(".rail__toggle");
    await expect(toggle).toContainText("Usage");
    // Tracking's count is what you track, not something waiting.
    await expect(toggle.locator(".rail__dot")).toHaveCount(0);
    await toggle.click();
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }),
    ).toBeVisible();
    await accessible(page, "narrow rail open");
  });

  test("@narrow the rail is a disclosure above the content, naming where you are", async ({
    page,
  }) => {
    await page.goto("/settings/usage");
    const toggle = page.locator(".rail__toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("Usage");
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }),
    ).toHaveCount(0);
    await toggle.click();
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: /^Players/ })
      .click();
    await expect(page).toHaveURL(/\/settings\/players$/);
    // Following a link closes it.
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }),
    ).toHaveCount(0);
    await accessible(page, "narrow tracking");
  });

  test("@narrow Home: the phone's tabs name the place, nothing is under them, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.goto("/home");
    const tabs = page.locator(".kit-bottom");
    await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Find", "Clan", "You"])
      await expect(tabs.getByRole("link", { name })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /Bell/ })).toBeVisible();
    // The bar's own places are the tabs here; the account stays on the bar.
    await expect(page.locator(".kit-top__nav")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Account: King Thing" }),
    ).toBeVisible();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const disclaimer = await page
      .locator(".kit-foot .disclaimer__text")
      .boundingBox();
    const bar = await tabs.boundingBox();
    expect(disclaimer!.y + disclaimer!.height).toBeLessThanOrEqual(bar!.y + 1);
    await rendered(page);
    await accessible(page, "narrow home");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("@narrow the account menu opens from the avatar and fits the phone", async ({
    page,
  }) => {
    await page.goto("/home");
    await page.getByRole("button", { name: "Account: King Thing" }).click();
    const menu = page.locator("#account-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
    const box = await menu.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 420).toBe(true);
    await accessible(page, "narrow account menu");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });
});

test.describe("the static site's bar", () => {
  test("the front page draws the same bar, signed out, the site's own places on it", async ({
    page,
  }) => {
    await page.goto("/");
    const bar = page.locator(".kit-top");
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Docs" })).toBeVisible();
    // Signed out the bar is Docs, Sign in and Create account (2026-11-12);
    // the front page is the way in, so nothing on the bar is lit.
    await expect(
      bar.getByRole("link", { name: "Create account" }),
    ).toBeVisible();
    await expect(bar.locator('[aria-current="page"]:visible')).toHaveCount(0);
    await accessible(page, "front page");
  });

  test("a doc lights Docs on the bar", async ({ page }) => {
    await page.goto("/docs");
    await expect(
      page.locator(".kit-top").getByRole("link", { name: "Docs" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
  });

  test("@narrow the front page's bar keeps every way in, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.goto("/");
    const bar = page.locator(".kit-top");
    await expect(bar.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Docs" })).toBeVisible();
    await accessible(page, "front page, narrow");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});

test("@narrow a player's record page leads with the recorded profile, and Connections offers the first question", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(
    page,
    signedIn({
      "GET /api/me/first-answer": () => [
        200,
        {
          player: {
            player_tag: "#20JJJ2CCRU",
            name: "King Thing",
            profile_available: true,
            profile_observed_at: new Date().toISOString(),
            battles_7d: 0,
            battles_30d: 0,
          },
          clan: null,
          connection: { active_connections: 1, last_data_read_at: null },
        },
      ],
    }),
  );
  await page.goto("/settings/players/20JJJ2CCRU");
  const readiness = page.getByRole("region", {
    name: "Your recording",
  });
  await expect(
    readiness.getByRole("link", { name: /View recorded profile/ }),
  ).toHaveAttribute("href", "/home/player/20JJJ2CCRU?tab=record");
  await accessible(page, "first-use record page");
  await page.goto("/settings/connections");
  const questions = page.getByRole("region", { name: "Try asking…" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await questions
    .getByRole("button", {
      name: "Copy question: Start with your latest profile",
    })
    .click();
  await expect(
    questions.getByRole("status").filter({ hasText: "Copied" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Do not infer progress from a single reading",
  );
  await accessible(page, "first-use connections");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("@narrow quickstart keeps long inline credentials and URLs within a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/quickstart");
  await expect(
    page.getByRole("heading", { name: "Get started with Elixir", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await accessible(page, "phone quickstart");
});
