import { test, expect, type Page } from "@playwright/test";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { ME as CLAN_ME, signedIn as clanSignedIn } from "./clan/fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";

const sendId = "5c1c5dbf-0000-4000-8000-000000000001";
const email = `/console/account/activity/e/${sendId}?report=1`;
const paths = [
  {
    name: "player",
    from: "/console/explore/player/20JJJ2CCRU",
    to: "/console/explore/player/20JJJ2CCRU",
  },
  {
    name: "clan",
    from: "/clan/2PQRJ8LV/actions",
    to: "/clan/2PQRJ8LV/actions",
  },
  {
    name: "battle",
    from: `/battle/${BATTLE.battle.short_id}`,
    to: `/battle/${BATTLE.battle.short_id}`,
  },
  {
    name: "email feedback",
    from: email,
    to: `/console/account/feedback?send_id=${sendId}`,
  },
];

function answers(state: { authed: boolean; ready?: boolean }) {
  return {
    ...clanSignedIn(),
    ...signedIn(),
    "GET /api/me": () =>
      [200, state.authed ? ME : SIGNED_OUT] as [number, unknown],
    "GET /api/clan/me": () =>
      [
        state.authed ? 200 : 401,
        state.authed
          ? { ...CLAN_ME, selected: CLAN_ME.clans[0] }
          : { error: "signed_out" },
      ] as [number, unknown],
    [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE] as [
      number,
      unknown,
    ],
    "POST /api/auth": [200, { ok: true, poll_id: "p".repeat(40) }] as [
      number,
      unknown,
    ],
    "POST /api/auth/code": () => {
      state.authed = true;
      return [200, { authenticated: true }] as [number, unknown];
    },
    "POST /api/auth/redeem": () => {
      state.authed = true;
      state.ready = true;
      return [200, { authenticated: true, handoff: { state: "done" } }] as [
        number,
        unknown,
      ];
    },
    "POST /api/auth/poll": () =>
      [200, { ready: !!state.ready, authenticated: !!state.ready }] as [
        number,
        unknown,
      ],
  };
}

async function enter(page: Page, path: (typeof paths)[number]) {
  await page.goto(path.from);
  if (path.name === "battle")
    await page.getByRole("link", { name: "Create your account" }).click();
  else if (path.name === "clan")
    await page.getByRole("link", { name: "Sign in with Elixir" }).click();
  else {
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    await page
      .locator(".panel")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
  }
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
}

async function arrived(page: Page, to: string) {
  await expect
    .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
    .toBe(to);
  await expect(page.locator("main")).not.toContainText("failed to render");
  if (to.includes("send_id="))
    await expect(page.getByText(/Reporting one email/)).toBeVisible();
}

for (const width of [390, 1280]) {
  for (const path of paths) {
    for (const proof of ["code", "link"]) {
      test(`${path.name} returns through ${proof}, Back and reload at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = { authed: false };
        await mockApi(page, answers(state));
        await enter(page, path);
        await page.reload();
        await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
        if (proof === "code") {
          await page
            .getByLabel("Email", { exact: true })
            .fill("fixture@example.com");
          await page
            .getByRole("button", { name: "Send sign-in email" })
            .click();
          await page.getByLabel("6-digit code").fill("123456");
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
        } else {
          // Model a fresh email-link document, avoiding a fragment-only
          // navigation or a reload racing a redeemed one-shot proof.
          await page.goto("about:blank");
          await page.goto("/console/signin#login_token=" + "t".repeat(40));
        }
        await arrived(page, path.to);
        expect(new URL(page.url()).hash).toBe("");
        await page.goto("/console/account/profile");
        await page.goBack();
        await arrived(page, path.to);
        await page.reload();
        await arrived(page, path.to);
      });
    }
  }

  test(`a login link tab leaves the original email-feedback destination intact at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = { authed: false, ready: false };
    const routes = answers(state);
    await mockApi(page, routes);
    const path = paths[3]!;
    await enter(page, path);
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    const link = await context.newPage();
    await mockApi(link, routes);
    await link.goto("/console/signin#login_token=" + "t".repeat(40));
    await arrived(link, path.to);
    await arrived(page, path.to);
    await page.reload();
    await arrived(page, path.to);
    await link.close();
  });

  test(`cross-device confirmation returns the requesting player screen at ${width}px`, async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const sender = { authed: false, ready: false };
    const receiver = { authed: false };
    await mockApi(page, {
      ...answers(sender),
      "POST /api/auth/poll": () => {
        if (sender.ready) sender.authed = true;
        return [200, { ready: sender.ready, authenticated: sender.ready }];
      },
    });
    await enter(page, paths[0]!);
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await expect(page.getByLabel("6-digit code")).toBeVisible();
    const other = await browser.newContext({
      baseURL: "http://127.0.0.1:4321",
    });
    try {
      const link = await other.newPage();
      await mockApi(link, {
        ...answers(receiver),
        "POST /api/auth/redeem": () => {
          receiver.authed = true;
          return [
            200,
            {
              authenticated: true,
              handoff: {
                state: "confirm",
                confirm: "c".repeat(40),
                started: {
                  from: "Fixture browser",
                  at: "2026-10-07T20:00:00Z",
                },
              },
            },
          ];
        },
        "POST /api/auth/handoff": () => {
          sender.ready = true;
          return [200, { ok: true }];
        },
      });
      await link.goto("/console/signin#login_token=" + "t".repeat(40));
      await link.getByRole("button", { name: "Yes, that was me" }).click();
      await arrived(page, paths[0]!.to);
      await page.reload();
      await arrived(page, paths[0]!.to);
    } finally {
      await other.close();
    }
  });
}
