import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ME,
  SIGNED_OUT,
  TURNSTILE_TOKEN,
  mockApi,
  signedIn,
} from "./fixtures.ts";

test("public signup verifies email and returns to the requested app step", async ({
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
          { authenticated: true, new_account: { player_tag: "#0PJCLJYP" } },
        ];
      },
    }),
  );
  await page.goto("/signin?signup&return_to=/settings/players");
  await expect(
    page.getByRole("heading", { name: "Create your Elixir account" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByLabel("Your player tag (optional)").fill("#0pjcljyp");
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  // The server normalizes and freezes it; the browser only carries it.
  expect(sentTag).toBe("#0pjcljyp");
  // The page's Turnstile token rides the send (the stand-in's, here).
  expect(sentToken).toBe(TURNSTILE_TOKEN);
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // A remembered return_to still wins over the new account's landing.
  await expect(page).toHaveURL(/\/settings\/players$/);
  await expect(
    page.getByRole("heading", { name: "Players & following", exact: true }),
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

test("a new account with no tag lands on Home with the first step open", async ({
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
  await page.goto("/signin");
  await expect(page.getByLabel("Your player tag (optional)")).toHaveCount(0);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(sentTag).toBeUndefined();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByLabel("Your player tag")).toBeVisible();
});

test("@narrow invitation entry and signup fit phone and desktop without changing the layout", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const name of ["Follow your friends", "Show off your best battles"])
      await expect(
        page
          .locator(".home-row__title")
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
  await page.goto("/signin?signup");
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByRole("radio", { name: "Yes" }).check();
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
    // Home's first steps: the optional ones say so.
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { name: /^Connect an AI/ }),
    ).toContainText("Optional");
    await expect(page.getByLabel("Your player tag")).toBeVisible();
    // Tracking keeps its own address for the field, ready to type in
    // (2026-10-20).
    await page.goto("/settings/players#add-player-tag");
    await expect(
      page.getByRole("textbox", { name: "Player tag", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText(/open your profile: the tag starting with #/),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Player tag", exact: true }),
    ).toHaveAttribute("aria-describedby", "add-player-tag-hint");
    await expect(
      page.getByText(/Your first player becomes your main player/),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Clans", exact: true }).click();
    await expect(
      page.getByText(/one clan like this, and none with every member/),
    ).toBeVisible();
    await expect(page.getByLabel("What to record")).toHaveValue("activity");
    await expect(
      page
        .getByLabel("What to record")
        .locator('option[value="comprehensive"]'),
      // An element inside a label is judged as the label's control, here the
      // select, by toBeDisabled; the option's own property is what counts.
    ).toHaveJSProperty("disabled", true);
    // Stats and Clan say one thing and go to one place: Home's first step.
    await page.goto("/home/you/stats");
    await expect(
      page.getByRole("heading", { name: "Stats start with your player" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Add your player" }).click();
    await expect(page).toHaveURL(/\/home#add-player$/);
    await expect(page.getByLabel("Your player tag")).toBeFocused();
    await page.goto("/clan");
    await expect(
      page.getByRole("heading", { name: "Clan starts with your player" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add your player" }),
    ).toHaveAttribute("href", "/home#add-player");
    await expect(
      page.getByRole("button", { name: /check again/i }),
    ).toHaveCount(0);
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
    await page.getByRole("link", { name: "Add your player" }).click();
    await expect(page).toHaveURL(/\/home#add-player$/);
  });
}

// 2026-11-09, a production walk: Cloudflare's box went interactive and the
// form read "Sending…" for two minutes with nothing else to say. A box on
// screen is named, beside it, and the email goes once it is answered.
for (const width of [390, 1180]) {
  test(`a Cloudflare box on screen is named while the send waits on it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    let sentToken: unknown;
    await mockApi(page, {
      "GET /api/me": [200, SIGNED_OUT],
      "POST /api/auth": (route) => {
        sentToken = route.request().postDataJSON().turnstile_token;
        return [200, { ok: true }];
      },
    });
    // Registered last, so it answers first: a widget that wants a click.
    await page.route(
      "https://challenges.cloudflare.com/turnstile/v0/api.js*",
      async (route) => {
        const onload = new URL(route.request().url()).searchParams.get(
          "onload",
        );
        await route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: `window.turnstile = {
  render(el, o) {
    const box = document.createElement("button");
    box.type = "button";
    box.textContent = "Verify you are human";
    box.onclick = () => { o["after-interactive-callback"](); o.callback("clicked-token"); };
    el.appendChild(box);
    setTimeout(() => o["before-interactive-callback"](), 0);
    return "e2e";
  },
  reset() {}, remove() {},
};
window[${JSON.stringify(onload)}]();`,
        });
      },
    );
    await page.goto("/signin?signup");
    await page.getByLabel("Email", { exact: true }).fill("new@example.com");
    await page.getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await expect(
      page.getByRole("button", { name: "Waiting for the check…" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "Cloudflare is asking for one click",
    );
    const box = page.getByRole("button", { name: "Verify you are human" });
    await expect(box).toBeInViewport();
    await box.click();
    await expect(
      page.getByRole("heading", { name: "Check your email" }),
    ).toBeVisible();
    expect(sentToken).toBe("clicked-token");
  });
}
