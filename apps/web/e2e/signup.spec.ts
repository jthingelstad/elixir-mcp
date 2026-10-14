import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ME,
  SIGNED_OUT,
  TURNSTILE_TOKEN,
  mockApi,
  signedIn,
} from "./fixtures.ts";

test("public signup verifies email and returns to the requested Console step", async ({
  page,
}) => {
  let authed = false,
    sends = 0,
    sentTag: unknown,
    sentToken: unknown;
  await mockApi(
    page,
    signedIn({
      "GET /api/me": () => [
        200,
        authed
          ? { ...ME, role: "member", claims: [], recordings: [] }
          : SIGNED_OUT,
      ],
      "POST /api/auth": (route) => {
        sends++;
        sentTag = route.request().postDataJSON().player_tag;
        sentToken = route.request().postDataJSON().turnstile_token;
        return [200, { ok: true }];
      },
      "POST /api/auth/code": () => {
        authed = true;
        return [
          200,
          { authenticated: true, new_account: { player_tag: "#2PYQ8GJ0" } },
        ];
      },
    }),
  );
  await page.goto("/console/signin?signup&return_to=/console/account/tracking");
  await expect(
    page.getByRole("heading", { name: "Create your Elixir account" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByLabel("Your player tag (optional)").fill("#2pyq8gj0");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  // The server normalizes and freezes it; the browser only carries it.
  expect(sentTag).toBe("#2pyq8gj0");
  // The page's Turnstile token rides the send (the stand-in's, here).
  expect(sentToken).toBe(TURNSTILE_TOKEN);
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // A remembered return_to still wins over the new account's landing.
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

test("a new account with no tag lands on Tracking with the tag field focused", async ({
  page,
}) => {
  let authed = false,
    sentTag: unknown = "unset";
  await mockApi(
    page,
    signedIn({
      "GET /api/me": () => [
        200,
        authed
          ? { ...ME, role: "member", claims: [], recordings: [] }
          : SIGNED_OUT,
      ],
      "POST /api/auth": (route) => {
        sentTag = route.request().postDataJSON().player_tag;
        return [200, { ok: true }];
      },
      "POST /api/auth/code": () => {
        authed = true;
        return [
          200,
          { authenticated: true, new_account: { player_tag: null } },
        ];
      },
    }),
  );
  await page.goto("/console/signin");
  await expect(page.getByLabel("Your player tag (optional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(sentTag).toBeUndefined();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/console\/account\/tracking#add-player-tag$/);
  await expect(page.getByLabel("Player tag")).toBeFocused();
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
      page.getByText(/We’ll email you a sign-in link/),
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
    await expect(
      page.getByText(/open your profile: the tag starting with #/),
    ).toBeVisible();
    await expect(page.getByLabel("Player tag")).toHaveAttribute(
      "aria-describedby",
      "add-player-tag-hint",
    );
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
