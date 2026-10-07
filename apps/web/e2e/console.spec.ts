import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";

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
  test("a console path meets the sign-in wall, and the way in is on the bar", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/console/account/overview");
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    await expect(page.locator(".chrome__product[aria-current]")).toHaveText(
      /Console/,
    );
    // Signed out, the account slot is Sign in, the same 196px.
    const signIn = page.locator(".chrome__account").getByRole("link", {
      name: "Sign in",
    });
    await expect(signIn).toHaveAttribute("href", "/console/signin");
    expect((await page.locator(".chrome__account").boundingBox())?.width).toBe(
      196,
    );
    await expect(page.locator(".rail")).toHaveCount(0);
    await accessible(page, "sign-in wall");
  });

  test("a partial path is redirected and the ADDRESS BAR follows", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/console/status");
    await expect(page).toHaveURL(/\/console\/status\/service$/);
    await page.goto("/console/account");
    await expect(page).toHaveURL(/\/console\/account\/overview$/);
    // The bare Console is Overview (signed out, its sign-in wall).
    await page.goto("/console");
    await expect(page).toHaveURL(/\/console\/account\/overview$/);
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
  });

  test("a console path the app does not own leaves for the static home", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/console/not-a-place");
    await expect(page).toHaveURL(/127\.0\.0\.1:4321\/$/);
    await expect(page).toHaveTitle(/Elixir/);
    // The static home is a real document: the app shell is not in it.
    await expect(page.locator("#root")).toHaveCount(0);
  });

  test("the Console's old root addresses are not aliased: a miss is a miss", async ({
    page,
  }) => {
    // Jamie, 2026-09-28: one origin, the Console under /console, and no
    // redirects from where it was. Outside the prefix every path is a
    // site document, so a page the site does not build is an honest 404,
    // never the app shell.
    for (const old of ["/account/overview", "/signin", "/not-a-place"]) {
      const res = await page.goto(old);
      expect(res?.status(), old).toBe(404);
      await expect(page.locator("#root")).toHaveCount(0);
    }
  });

  test("sign in: email, then the six-digit code, then the console", async ({
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
    await page.goto("/console/signin");
    await page.getByLabel("Email").fill("jamie@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/console\/account\/overview$/);
    await expect(page.locator(".rail")).toBeVisible();
    await rendered(page);
  });
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, signedIn());
  });

  test("the bar's account slot is the person; its menu holds the players, the account's pages and the way out", async ({
    page,
  }) => {
    await page.goto("/console/account/overview");
    const slot = page.locator(".chrome__account");
    const before = await slot.boundingBox();
    const me = page.getByRole("button", { name: "Account: King Thing" });
    await expect(me).toBeVisible();
    // One width, whatever fills it: 196px wide.
    expect(before?.width).toBe(196);
    await me.click();
    const menu = page.locator("#account-menu");
    await expect(menu).toContainText("jamie@example.com");
    await expect(menu).toContainText("leader · America/Chicago");
    await expect(
      menu.getByRole("link", { name: /King Thing/ }),
    ).toHaveAttribute("href", "/console/explore/player/20JJJ2CCRU");
    await accessible(page, "account menu");
    await menu.getByRole("link", { name: /Account settings/ }).click();
    await expect(page).toHaveURL(/\/console\/account\/profile$/);
    await expect(menu).toHaveCount(0);
  });

  test("the rail: counts, the unread dot, and every section renders its chunk", async ({
    page,
  }) => {
    await page.goto("/console/account/overview");
    const rail = page.locator(".rail");
    await expect(rail).toBeVisible();
    // Counts are the reader's own things; the dot is the unread timeline.
    await expect(rail.getByRole("link", { name: /Tracking/ })).toContainText(
      "1",
    );
    await expect(
      rail.getByRole("img", { name: "Unread notifications" }),
    ).toBeVisible();
    await accessible(page, "overview");

    // Every section is its own lazy chunk: each must arrive and render.
    const sections: [string, RegExp, string][] = [
      ["Timeline", /\/console\/account\/timeline$/, "Timeline"],
      ["Tracking", /\/console\/account\/tracking$/, "Tracking"],
      ["Verify", /\/console\/account\/verify$/, "Verify"],
      ["Usage", /\/console\/account\/usage$/, "Usage"],
      ["Connections", /\/console\/account\/connections$/, "Connections"],
      ["Status", /\/console\/status\/service$/, "Status"],
      ["Explore", /\/console\/explore$/, "Explore"],
      ["Send feedback", /\/console\/account\/feedback$/, "Feedback"],
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
      if (label === "Timeline") {
        const session = page.getByRole("row").filter({
          hasText: "Played a battle session.",
        });
        await expect(session).toContainText("King Thing");
        await expect(session).toContainText("unread");
      }
    }
    // Subs render only under the current item: Status's two, and the
    // current one marked.
    await expect(rail.getByRole("link", { name: "Collectors" })).toHaveCount(0);
    await rail.getByRole("link", { name: /^Status/ }).click();
    await rail.getByRole("link", { name: "Efficiency" }).click();
    await expect(page).toHaveURL(/\/console\/status\/efficiency$/);
    await expect(
      rail.getByRole("link", { name: "Efficiency" }),
    ).toHaveAttribute("aria-current", "page");

    // The MCP request log left the rail for Usage (canvas 2026-09-29):
    // one link from the page, and Usage stays lit while you read it.
    await rail.getByRole("link", { name: /^Usage/ }).click();
    await page.getByRole("link", { name: /MCP requests/ }).click();
    await expect(page).toHaveURL(/\/console\/account\/activity\/requests$/);
    await expect(rail.getByRole("link", { name: /^Usage/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await rendered(page);
    await accessible(page, "requests log");
  });

  test("the switcher: your console, your agents and the admin console, grouped; the account's own rail has a way back", async ({
    page,
  }) => {
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
      "GET /api/agent/abc12345": [
        200,
        { ...ME, kind: "agent", name: "poap-bot", email: null, claims: [] },
      ],
    });
    await page.goto("/console/account/overview");
    const rail = page.locator(".rail");
    const head = rail.locator("button.rail__switch-head");
    await expect(head).toContainText("Your console");
    await head.click();
    const list = page.locator("#rail-accounts");
    await expect(list.locator(".rail__switch-group")).toHaveText([
      "You",
      "Your agents",
      "Operate",
    ]);
    await expect(
      list.locator('.rail__switch-item[aria-current="true"]'),
    ).toContainText("Your console");
    await accessible(page, "console switcher");
    await list.getByRole("link", { name: /poap-bot/ }).click();
    await expect(page).toHaveURL(/\/console\/agent\/abc12345\//);
    await expect(
      page.getByRole("navigation", { name: "Agent console sections" }),
    ).toBeVisible();

    // The account's own pages have their own rail, with the way back.
    await page.goto("/console/account/profile");
    const account = page.getByRole("navigation", { name: "Account sections" });
    await expect(account).toBeVisible();
    await expect(
      account.getByRole("link", { name: /Profile/ }),
    ).toHaveAttribute("aria-current", "page");
    // The foot and the way back sit in the rail, around its list.
    await expect(
      rail.getByRole("button", { name: /Sign out of Elixir/ }),
    ).toBeVisible();
    await accessible(page, "account rail");
    await rail.locator(".rail__back").click();
    await expect(page).toHaveURL(/\/console\/account\/overview$/);
  });

  test("a read timeline has no unread dot and its rows say read; an empty week says so", async ({
    page,
  }) => {
    // Every item is at or before the read pointer and nothing is pending:
    // the timeline contract's read case (me.signals.timeline_pending and
    // GET /api/me/timeline's read_to).
    let items: Record<string, unknown>[] = [
      {
        at: "2026-09-12T15:00:00Z",
        subject_tag: "#20JJJ2CCRU",
        subject_name: "King Thing",
        kind: "battle_session",
        section: "battles",
        text: "Played a battle session.",
        facts: { battles: 3 },
      },
    ];
    await mockApi(page, {
      ...signedIn(),
      "GET /api/me": [
        200,
        { ...ME, signals: { ...ME.signals, timeline_pending: 0 } },
      ],
      "GET /api/me/timeline": () => [
        200,
        { timeline: items, read_to: "2026-09-12T15:00:00Z" },
      ],
    });
    await page.goto("/console/account/timeline");
    const rail = page.locator(".rail");
    await expect(rail).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Timeline",
    );
    const session = page.getByRole("row").filter({
      hasText: "Played a battle session.",
    });
    await expect(session).toContainText("read");
    await expect(session).not.toContainText("unread");
    await expect(
      rail.getByRole("img", { name: "Unread notifications" }),
    ).toHaveCount(0);
    await rendered(page);
    await accessible(page, "timeline, read");

    // A quiet week: no rows, the empty line, and still no dot.
    items = [];
    await page.reload();
    await expect(
      page.getByText(/^Nothing in the last seven days/),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "unread" }),
    ).toHaveCount(0);
    await expect(
      rail.getByRole("img", { name: "Unread notifications" }),
    ).toHaveCount(0);
    await rendered(page);
  });

  test("a form unlock reads as its sentence, the item's time lead dropped (9.14.0, #110)", async ({
    page,
  }) => {
    // The server writes the text (itemText); the console shows it after
    // its own WHEN column, so the "Sun 05:05" lead is stripped.
    await mockApi(page, {
      ...signedIn(),
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
              text: "Sun 05:05 King Thing unlocked Hero Valkyrie.",
              facts: {
                card: "Valkyrie",
                card_id: 26000011,
                rarity: "rare",
                form: "hero",
              },
            },
          ],
          read_to: null,
        },
      ],
    });
    await page.goto("/console/account/timeline");
    const row = page.getByRole("row").filter({
      hasText: "King Thing unlocked Hero Valkyrie.",
    });
    await expect(row).toHaveCount(1);
    await expect(
      row.getByRole("cell", {
        name: "King Thing unlocked Hero Valkyrie.",
        exact: true,
      }),
    ).toBeVisible();
    await rendered(page);
    await accessible(page, "timeline, form unlock");
  });

  test("Status: the service page draws the capture charts and auto-refresh is off and visible", async ({
    page,
  }) => {
    await page.goto("/console/status/service");
    await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
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
            name: "thingles",
            is_primary: false,
            relationship: "alt",
            claim_status: "unverified",
          },
        ];
        return [200, { ok: true }];
      },
    });
    await page.goto("/console/account/tracking");
    await expect(
      page.locator(".rail").getByRole("link", { name: /Tracking/ }),
    ).toContainText("1");
    await page.getByPlaceholder("#20JJJ2CCRU").fill("#VJQV8G8RL");
    await page.getByRole("button", { name: "Track" }).first().click();
    // The claim invalidates ["me"]: the rail's count follows without a reload.
    await expect(
      page.locator(".rail").getByRole("link", { name: /Tracking/ }),
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
    await page.goto(`/console/agent/${PUBLIC_ID}/overview`);
    await expect(page.getByText("No live key.")).toBeVisible();

    await page.goto(`/console/agent/${PUBLIC_ID}/settings`);
    const issue = page.getByRole("button", { name: "Issue a new key" });
    await expect(issue).toBeEnabled();

    // Refused: the name moved to another agent since the revoke.
    await issue.click();
    await expect(page.getByRole("alert")).toContainText(
      "Another of your agents is now called clan-bot",
    );
    await expect(page.getByText("Copy this key now.")).toHaveCount(0);
    await rendered(page);
    await accessible(page, "agent settings, issue refused");

    // Issued: the key is handed over once.
    answer = [200, { ok: true, token: "svt_fixture_not_a_real_key" }];
    await issue.click();
    await expect(page.getByText("Copy this key now.")).toBeVisible();
    await expect(page.getByText("svt_fixture_not_a_real_key")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("@narrow the rail is a disclosure above the content, naming where you are", async ({
    page,
  }) => {
    await page.goto("/console/account/usage");
    const toggle = page.locator(".rail__toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("Usage");
    await expect(
      page.getByRole("navigation", { name: "Console sections" }),
    ).toHaveCount(0);
    await toggle.click();
    await expect(
      page.getByRole("navigation", { name: "Console sections" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Console sections" })
      .getByRole("link", { name: /^Tracking/ })
      .click();
    await expect(page).toHaveURL(/\/console\/account\/tracking$/);
    // Following a link closes it.
    await expect(
      page.getByRole("navigation", { name: "Console sections" }),
    ).toHaveCount(0);
    await accessible(page, "narrow tracking");
  });

  test("@narrow Overview: the Ladder and the clan, no Drop tile (the bar has the game), and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.goto("/console/account/overview");
    await expect(page.locator(".rail__toggle")).toContainText("Overview");
    const across = page.getByRole("region", { name: "Across Elixir" });
    await expect(across.getByRole("link", { name: /Ladder/ })).toBeVisible();
    await expect(across.getByRole("link", { name: /Clan/ })).toBeVisible();
    await expect(across.locator(".drop-card")).toBeHidden();
    await rendered(page);
    await accessible(page, "narrow overview");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("@narrow the top bar names the Console, opens a sheet with every place, and Escape closes it", async ({
    page,
  }) => {
    await page.goto("/console/account/overview");
    // Narrow, the places fold into one button naming where you are; the
    // account stays on the bar as its avatar.
    await expect(
      page.getByRole("navigation", { name: "Products" }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Account: King Thing" }),
    ).toBeVisible();
    const menu = page.getByRole("button", { name: "Product: Console" });
    await expect(menu).toBeVisible();
    await menu.click();
    const sheet = page.locator("#chrome-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");
    await expect(sheet.getByRole("link", { name: "Docs" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Play Drop/ })).toBeVisible();
    await accessible(page, "narrow bar sheet");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveAttribute("data-open", "false");
    // No page scrolls sideways at phone width.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("@narrow the account menu opens from the avatar and fits the phone", async ({
    page,
  }) => {
    await page.goto("/console/account/overview");
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
  test("the front page draws the same bar, signed out, with the site's own row under it", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Products" }),
    ).toBeVisible();
    const slot = page.locator(".chrome__account");
    await expect(slot.getByRole("link", { name: "Sign in" })).toBeVisible();
    expect((await slot.boundingBox())?.width).toBe(196);
    await expect(
      page
        .getByRole("navigation", { name: "Site" })
        .getByRole("link", { name: "Home" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".chrome__logo")).toHaveJSProperty(
      "naturalWidth",
      96,
    );
    await accessible(page, "front page");
  });

  test("a doc lights Docs on the bar", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.locator(".chrome__docs")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
  });

  test("@narrow the front page's bar folds into Menu, and nothing scrolls sideways", async ({
    page,
  }) => {
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(
      page.locator(".chrome__account").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
    await menu.click();
    const sheet = page.locator("#chrome-sheet");
    await expect(sheet.getByRole("link", { name: "Console" })).toBeVisible();
    await accessible(page, "front page sheet");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveAttribute("data-open", "false");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});

test("@narrow Overview puts the recorded profile before optional AI and tracks its first successful read", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let read = false;
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
          connection: {
            active_connections: 1,
            last_data_read_at: read ? new Date().toISOString() : null,
          },
        },
      ],
    }),
  );
  await page.goto("/console/account/overview");
  const readiness = page.getByRole("region", {
    name: "Your recording",
  });
  await expect(
    readiness.getByRole("link", { name: /View recorded profile/ }),
  ).toHaveAttribute("href", "/console/explore/profile/20JJJ2CCRU");
  await expect(
    readiness.getByRole("link", { name: /Connection help/ }),
  ).not.toBeVisible();
  await readiness.getByText("AI clients (optional)").click();
  await expect(
    readiness.getByRole("link", { name: /Clan recording/ }),
  ).toHaveAttribute("href", "/console/account/tracking");
  await expect(
    readiness.getByRole("link", { name: /Connection help/ }),
  ).toHaveAttribute("href", "/docs/quickstart");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await readiness
    .getByRole("button", {
      name: "Copy question: Start with your player snapshot",
    })
    .click();
  await expect(
    readiness.getByRole("status").filter({ hasText: "Copied" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Do not infer progress from a single snapshot",
  );
  await accessible(page, "first-use overview");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  read = true;
  await page.reload();
  await expect(
    readiness.getByRole("link", { name: /View recorded profile/ }),
  ).toBeVisible();
  await readiness.getByText("AI clients (optional)").click();
  await expect(readiness).toContainText(/successful data read /);
  await expect(
    readiness.getByRole("link", { name: /Connection help/ }),
  ).toHaveCount(0);
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
