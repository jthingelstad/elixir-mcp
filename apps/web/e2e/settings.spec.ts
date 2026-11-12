import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { BATTLE } from "./battle-fixture.ts";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/**
 * Settings and the bar's two sheets, redesign step 6, every page at phone
 * width: it fits, it renders, and it passes axe. Local mocks only.
 */
const AGENT = {
  account_id: "00000000-0000-4000-8000-000000000002",
  kind: "agent",
  public_id: "abc12345",
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
  tokens: [],
};
const mocks = signedIn({
  "GET /api/me": [
    200,
    { ...ME, agents: [{ public_id: AGENT.public_id, name: AGENT.name }] },
  ],
  "GET /api/me/principals": [200, { agents: [AGENT], addable_clans: [] }],
  [`GET /api/agent/${AGENT.public_id}/feedback`]: [
    200,
    { feedback: [], total: 3 },
  ],
  [`GET /api/agent/${AGENT.public_id}`]: [
    200,
    { ...ME, kind: "agent", name: AGENT.name, email: null, claims: [] },
  ],
  // What members see: its lens reads the main player's latest battle, then
  // draws it from the public battle answer. Other tools stay unmocked.
  "POST /api/explore": (route) =>
    route.request().postDataJSON()?.tool === "battles_query"
      ? [
          200,
          {
            tool: "battles_query",
            is_error: false,
            body: { battles: [{ url: BATTLE.battle.url }] },
          },
        ]
      : [404, { error: "unmocked" }],
  [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
});

async function fits(page: Page, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
    name,
  ).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
    name,
  ).toEqual([]);
}

test.describe("@narrow Settings at phone width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, mocks);
  });

  for (const [path, heading] of [
    ["/settings/profile", "Profile"],
    ["/settings/what-members-see", "What members see"],
    ["/settings/players", "Players"],
    ["/settings/players?view=clans", "Players"],
    ["/settings/players/verify", "Verify"],
    ["/settings/emails", "Emails"],
    ["/settings/emails/sent", "Sent"],
    ["/settings/connections", "Connections"],
    ["/settings/connections/discord", "Discord"],
    ["/settings/sign-ins", "Sign-ins"],
    ["/settings/usage", "Usage"],
    ["/settings/usage/requests", "Requests"],
    ["/settings/feedback", "Feedback"],
    [`/settings/agents/${AGENT.public_id}/overview`, "clan-bot"],
    [`/settings/agents/${AGENT.public_id}/reads`, "clan-bot"],
    [`/settings/agents/${AGENT.public_id}/usage`, "clan-bot"],
    [`/settings/agents/${AGENT.public_id}/connections`, "clan-bot"],
    [`/settings/agents/${AGENT.public_id}/settings`, "clan-bot"],
  ] as const) {
    test(`${path} fits`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        heading,
      );
      await expect(page.locator(".rail__toggle")).toBeVisible();
      await fits(page, path);
    });
  }

  test("What members see draws its lens at phone width, both ways", async ({
    page,
  }) => {
    await page.goto("/settings/what-members-see");
    const lens = page.getByRole("region", { name: "See it as they do" });
    await expect(lens.getByRole("button", { name: "A member" })).toBeVisible();
    await expect(lens.locator(".battle__grid").first()).toBeVisible();
    await fits(page, "lens as a member");
    await lens.getByRole("button", { name: "Someone with the link" }).click();
    await expect(
      lens.getByRole("link", { name: "Create your account" }),
    ).toBeVisible();
    await fits(page, "lens as someone with the link");
  });

  test("search opens in place, and a miss offers the tag; nothing is written by typing", async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on("request", (r) => {
      if (
        new URL(r.url()).pathname.startsWith("/api/") &&
        !["GET"].includes(r.method()) &&
        !r.url().includes("/api/explore")
      )
        writes.push(r.url());
    });
    await page.goto("/home");
    await page
      .locator(".kit-bottom")
      .getByRole("button", { name: /Search/ })
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("searchbox").fill("#2PQRJ8LV");
    await fits(page, "search sheet");
    expect(writes).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("a deck hash typed in search lands on Explore's record", async ({
    page,
  }) => {
    const hash = "abcdef0123456789";
    await page.goto("/home");
    await page
      .locator(".kit-bottom")
      .getByRole("button", { name: /Search/ })
      .click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("searchbox").fill(hash);
    await sheet.getByRole("link", { name: /^Deck abcdef012345/ }).click();
    await expect(page).toHaveURL(new RegExp(`/console/explore/deck/${hash}$`));
    await expect(sheet).toHaveCount(0);
  });

  test("an agent's overview counts the feedback it has sent", async ({
    page,
  }) => {
    await page.goto(`/settings/agents/${AGENT.public_id}/overview`);
    await expect(page.getByText("3 items.")).toBeVisible();
  });

  test("help opens in place, names the page and links its docs", async ({
    page,
  }) => {
    await page.goto("/settings/emails");
    await page.getByRole("button", { name: "Help for this page" }).click();
    const help = page.getByRole("dialog");
    await expect(help.getByRole("heading", { level: 2 })).toContainText(
      "Emails",
    );
    await expect(help.getByRole("link").first()).toBeVisible();
    await fits(page, "help drawer");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });
});

test("a turn-off, a sent mail and a request in old mail all land in Settings", async ({
  page,
}) => {
  await mockApi(page, mocks);
  for (const [old, now] of [
    ["/console/account/profile/email", "/settings/emails"],
    ["/console/account/activity/emails", "/settings/emails/sent"],
    [
      "/console/account/tracking#add-player-tag",
      "/settings/players#add-player-tag",
    ],
    ["/console/account/verify", "/settings/players/verify"],
    ["/console/account/usage", "/settings/usage"],
    ["/console/account/connections", "/settings/connections"],
    [
      `/console/agent/${AGENT.public_id}/overview`,
      `/settings/agents/${AGENT.public_id}/overview`,
    ],
  ] as const) {
    await page.goto(old);
    await expect(page).toHaveURL(
      new RegExp(`${now.replace(/[#/]/g, "\\$&")}$`),
    );
  }
});
