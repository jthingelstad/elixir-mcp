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
    await page.goto("/account/overview");
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    await expect(page.locator(".chrome__product[aria-current]")).toHaveText(
      /Console/,
    );
    await expect(page.locator(".rail")).toHaveCount(0);
    await accessible(page, "sign-in wall");
  });

  test("a legacy path is redirected and the ADDRESS BAR follows", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/data/status");
    await expect(page).toHaveURL(/\/status\/service$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/overview$/);
  });

  test("a path the app does not own leaves for the static home", async ({
    page,
  }) => {
    await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
    await page.goto("/not-a-place");
    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle(/Elixir/);
    // The static home is a real document: the app shell is not in it.
    await expect(page.locator("#root")).toHaveCount(0);
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
    await page.goto("/signin");
    await page.getByLabel("Email").fill("jamie@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account\/overview$/);
    await expect(page.locator(".rail")).toBeVisible();
    await rendered(page);
  });
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, signedIn());
  });

  test("the rail: counts, the unread dot, the identity block, and every section renders its chunk", async ({
    page,
  }) => {
    await page.goto("/account/overview");
    const rail = page.locator(".rail");
    await expect(rail).toBeVisible();
    // Counts are the reader's own things; the dot is the unread timeline.
    await expect(rail.getByRole("link", { name: /Tracking/ })).toContainText(
      "1",
    );
    await expect(
      rail.getByRole("img", { name: "Unread notifications" }),
    ).toBeVisible();
    await expect(
      rail.getByRole("link", { name: /jamie@example.com/ }),
    ).toBeVisible();
    await accessible(page, "overview");

    // Every section is its own lazy chunk: each must arrive and render.
    const sections: [string, RegExp, string][] = [
      ["Timeline", /\/account\/timeline$/, "Timeline"],
      ["Usage", /\/account\/usage$/, "Usage"],
      ["Activity", /\/account\/activity\/requests$/, "MCP requests"],
      ["Connections", /\/account\/connections$/, "Connections"],
      ["Profile", /\/account\/profile$/, "Profile"],
      ["Status", /\/status\/service$/, "Status"],
      ["Explore", /\/explore$/, "Explore"],
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
    // Subs render only under the current item: Activity's three, and the
    // current one marked. Activity lands on MCP requests since the
    // timeline became its own item.
    await rail.getByRole("link", { name: /^Activity/ }).click();
    await expect(
      rail.getByRole("link", { name: "MCP requests" }),
    ).toBeVisible();
    await rail.getByRole("link", { name: "MCP requests" }).click();
    await expect(page).toHaveURL(/\/account\/activity\/requests$/);
    await expect(
      rail.getByRole("link", { name: "MCP requests" }),
    ).toHaveAttribute("aria-current", "page");
    await accessible(page, "requests log");
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
    await page.goto("/account/timeline");
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
    await page.goto("/account/timeline");
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
    await page.goto("/status/service");
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
    await page.goto("/account/tracking");
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
    await page.goto(`/agent/${PUBLIC_ID}/overview`);
    await expect(page.getByText("No live key.")).toBeVisible();

    await page.goto(`/agent/${PUBLIC_ID}/settings`);
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
    await page.goto("/account/usage");
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
      .getByRole("link", { name: /^Profile/ })
      .click();
    await expect(page).toHaveURL(/\/account\/profile$/);
    // Following a link closes it.
    await expect(
      page.getByRole("navigation", { name: "Console sections" }),
    ).toHaveCount(0);
    await accessible(page, "narrow profile");
  });

  test("@narrow the top bar's menu opens a sheet with every tab, and Escape closes it", async ({
    page,
  }) => {
    await page.goto("/account/overview");
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toBeVisible();
    await menu.click();
    const sheet = page.locator("#chrome-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");
    await expect(sheet.getByRole("link", { name: "Docs" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveAttribute("data-open", "false");
  });
});
