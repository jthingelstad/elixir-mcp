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
