import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";

test("public signup verifies email and returns to the requested Console step", async ({
  page,
}) => {
  let authed = false,
    sends = 0;
  await mockApi(
    page,
    signedIn({
      "GET /api/me": () => [
        200,
        authed
          ? { ...ME, role: "member", claims: [], recordings: [] }
          : SIGNED_OUT,
      ],
      "POST /api/auth": () => {
        sends++;
        return [200, { ok: true }];
      },
      "POST /api/auth/code": () => {
        authed = true;
        return [200, { authenticated: true }];
      },
    }),
  );
  await page.goto("/console/signin?signup&return_to=/console/account/tracking");
  await expect(
    page.getByRole("heading", { name: "Create your Elixir account" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/console\/account\/tracking$/);
  await expect(
    page.getByRole("heading", { name: "Tracking", exact: true }),
  ).toBeVisible();
  expect(sends).toBe(1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});

test("@narrow invitation entry and signup fit phone and desktop without changing the layout", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const name of ["Console", "Ladder", "Clan"])
      await expect(
        page
          .locator(".home-tile__product")
          .filter({ hasText: new RegExp(`^${name}$`) }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `/tmp/public-signup-home-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Create your account", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Create your Elixir account" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Collectors need separate approval/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `/tmp/public-signup-form-${width}.png`,
      fullPage: true,
    });
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      a11y.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  }
});

test("a failed email request stays editable and a failed code request remains recoverable", async ({
  page,
}) => {
  let sendFailed = true,
    codeFailed = true;
  await mockApi(page, {
    "GET /api/me": [200, SIGNED_OUT],
    "POST /api/auth": () =>
      sendFailed ? [503, { error: "unavailable" }] : [200, { ok: true }],
    "POST /api/auth/code": () =>
      codeFailed
        ? [503, { error: "unavailable" }]
        : [400, { error: "invalid_or_expired" }],
  });
  await page.goto("/console/signin?signup");
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "new@example.com",
  );
  sendFailed = false;
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  codeFailed = false;
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Wrong or expired code.")).toBeVisible();
  await page.getByRole("button", { name: "Use a different address" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`new account next steps and zero comprehensive slots at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const empty = {
      ...ME,
      role: "member",
      claims: [],
      recordings: [],
      entitlements: {
        player_slots: { used: 0, limit: 50 },
        activity_clans: { used: 0, limit: 1 },
        comprehensive_clans: { used: 0, limit: 0 },
      },
    };
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, empty],
        "GET /api/me/first-answer": [
          200,
          {
            player: null,
            clan: null,
            connection: { active_connections: 0, last_data_read_at: null },
          },
        ],
        "GET /api/clan/me": [
          200,
          {
            signed_in: true,
            ok: false,
            reason: "no_primary_player",
            identities: [],
            clans: [],
            primary: null,
          },
        ],
      }),
    );
    await page.goto("/console/account/overview");
    await expect(page.getByText("AI clients (optional)")).toBeVisible();
    await expect(page.getByText("Clan war history (optional)")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Connect your client ›" }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Add your player", exact: true })
      .click();
    await expect(page.getByText(/open your player profile/)).toBeVisible();
    await expect(
      page.getByText(/Your first player becomes your primary/),
    ).toBeVisible();
    await expect(page.getByText(/no comprehensive clan slots/)).toBeVisible();
    await expect(page.getByLabel("Scope")).toHaveValue("activity");
    await expect(
      page.getByLabel("Scope").locator('option[value="comprehensive"]'),
    ).toBeDisabled();
    await expect(
      page.getByRole("main").getByRole("link", { name: "Verify", exact: true }),
    ).toHaveAttribute("href", "/console/account/verify");
    await page.goto("/ladder");
    await page.getByRole("link", { name: "Go to Tracking" }).click();
    await expect(page).toHaveURL(/\/console\/account\/tracking$/);
    await page.goto("/clan");
    await expect(
      page.getByRole("heading", { name: "Add your player in Elixir" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Elixir → Tracking ›" }),
    ).toHaveAttribute(
      "href",
      "https://elixir.poapkings.com/console/account/tracking",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      a11y.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });
}
