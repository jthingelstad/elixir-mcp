import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi } from "./fixtures.ts";
import { BATTLE, DUEL } from "./battle-fixture.ts";

/** Members read a battle and its surrounding history. An opaque public
 * link shows only the selected battle and a way to sign in. */

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

const SHARE_ID = "abcdefghijklmnopqrstuvwx";
const SHARE_PATH = `/share/${SHARE_ID}`;
const sharedBattle = {
  battle: Object.fromEntries(
    Object.entries(BATTLE.battle).filter(
      ([key]) => !["url", "image"].includes(key),
    ),
  ),
  sides: BATTLE.sides,
};

const battles: Parameters<typeof mockApi>[1] = {
  [`GET /api/public/shared-items/${SHARE_ID}`]: [
    200,
    {
      item: {
        ...sharedBattle,
        kind: "battle",
        id: "tl_0123456789abcdef0123",
        at: BATTLE.battle.battle_time,
      },
    },
  ],
  [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
  [`GET /api/me/battles/${DUEL.battle.short_id}`]: [200, DUEL],
  "GET /api/me/battles/ffffffffffff": [404, { error: "not_found" }],
};

test("an opaque public battle has two decks and a way in, without anonymous history", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT], ...battles });
  await page.goto(SHARE_PATH);
  const left = BATTLE.sides[0]!.players[0]!.name as string;
  const right = BATTLE.sides[1]!.players[0]!.name as string;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Shared on Elixir",
  );
  await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(
    `${left} beat ${right} 2 to 1 on Trophy Road`,
  );
  const decks = page.getByRole("region", { name: /’s deck$/ });
  await expect(decks).toHaveCount(2);
  await expect(
    decks.first().getByRole("link", { name: /level 16$/ }),
  ).toHaveCount(8);
  await expect(
    page.getByRole("region", { name: "How it ended" }),
  ).toContainText("Three towers fell before time ran out.");
  await expect(
    page.getByRole("region", { name: "Side by side" }),
  ).toContainText("13,591 → 13,621");
  await expect(page.locator("a.battle__name, .kit-player-name")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /’s session$/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Share this battle" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Follow from here" }),
  ).toHaveCount(0);
  const invite = page.getByRole("region", { name: "See more on Elixir" });
  await expect(
    invite.getByRole("link", { name: "Create an account" }),
  ).toHaveAttribute(
    "href",
    `/signin?signup&return_to=${encodeURIComponent(SHARE_PATH)}`,
  );
  await accessible(page, "shared battle");
});

test("a bare battle address stays behind sign-in", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/me/battles/")) reads.push(request.url());
  });
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT], ...battles });
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".battle")).toHaveCount(0);
  expect(reads).toEqual([]);
});

test("signed in: your side says so, names open the record, another battle stays in the page", async ({
  page,
}) => {
  const tag = BATTLE.sides[0]!.players[0]!.player_tag as string;
  const me = { ...ME, claims: [{ ...ME.claims[0], player_tag: tag }] };
  const next = BATTLE.sitting.find((x) => x.url !== BATTLE.battle.url)!;
  const nextShort = next.url!.split("/").pop()!;
  await mockApi(page, {
    "GET /api/me": [200, me],
    ...battles,
    [`GET /api/me/battles/${nextShort}`]: [200, DUEL],
  });
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  await expect(page.locator(".battle__score .chip--ok")).toHaveText("you");
  await expect(page.locator("a.battle__name").first()).toHaveAttribute(
    "href",
    `/home/player/${tag.slice(1)}`,
  );
  await expect(page.getByRole("link", { name: "Join Elixir" })).toHaveCount(0);
  // The session: this battle marked, the other one a link that loads
  // in-app.
  const session = page.getByRole("region", { name: /’s session$/ });
  await expect(session.locator("[aria-current=page]")).toContainText(
    "this battle",
  );
  await session.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/battle/${nextShort}$`));
  await expect(page.getByRole("tablist", { name: "Games" })).toBeVisible();
});

test("joining from a shared battle keeps the capability, then member battle has Follow from here", async ({
  page,
}) => {
  // Social slice 5 (#763): the way in carries only the page; after the
  // proof the reader is back on it, and the players come from the page.
  const left = BATTLE.sides[0]!.players[0]!.player_tag as string;
  const right = BATTLE.sides[1]!.players[0]!.player_tag as string;
  let authed = false,
    age: unknown,
    followed: unknown;
  await mockApi(page, {
    "GET /api/me": () => [
      200,
      authed
        ? {
            ...ME,
            role: "member",
            // The tag given on the signup form, now this account's own.
            claims: [
              {
                player_tag: "#0PJCLJYP",
                name: null,
                is_primary: true,
                relationship: "primary",
                claim_status: "unverified",
              },
            ],
            recordings: [],
          }
        : SIGNED_OUT,
    ],
    ...battles,
    "POST /api/auth": (route) => {
      age = route.request().postDataJSON().age_13;
      return [200, { ok: true }];
    },
    "POST /api/auth/code": () => {
      authed = true;
      return [
        200,
        { authenticated: true, new_account: { player_tag: "#0PJCLJYP" } },
      ];
    },
    "GET /api/me/follow-cost": (route) => {
      const tag = new URL(route.request().url()).searchParams.get("player_tag");
      return [
        200,
        {
          player_tag: tag,
          following: false,
          free: tag === left,
          used: 0,
          limit: 50,
        },
      ];
    },
    "POST /api/claims": (route) => {
      followed = route.request().postDataJSON();
      return [200, { player_tag: right, relationship: "friend", added: true }];
    },
  });
  const here = SHARE_PATH;
  await page.goto(here);
  await page
    .getByRole("region", { name: "See more on Elixir" })
    .getByRole("link", { name: "Create an account" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create your Elixir account" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByLabel("Your player tag (optional)").fill("#0PJCLJYP");
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(age).toBe(true);
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${here}$`));
  await expect(
    page.getByRole("region", { name: "Follow from here" }),
  ).toHaveCount(0);
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  const from = page.getByRole("region", { name: "Follow from here" });
  await expect(from).toContainText("Free · already recorded");
  await expect(from).toContainText("Uses 1 of your 50 follows");
  await expect(page.getByRole("link", { name: "Join Elixir" })).toHaveCount(0);
  await from
    .getByRole("button", { name: /^Follow / })
    .nth(1)
    .click();
  await expect(from).toContainText("Following");
  expect(followed).toEqual({ player_tag: right, relationship: "friend" });
  await accessible(page, "battle, follow from here");
});

test("a duel: games won on top, then each game's decks and towers", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, ME], ...battles });
  await page.goto(`/battle/${DUEL.battle.short_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "2 to 1 games on War",
  );
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "How game 1 ended" }),
  ).toBeVisible();
  await tabs.nth(2).click();
  await expect(
    page.getByRole("region", { name: "How game 3 ended" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Side by side" })).toHaveCount(
    0,
  );
  await accessible(page, "duel");
});

test("a battle Elixir does not hold says so", async ({ page }) => {
  await mockApi(page, { "GET /api/me": [200, ME], ...battles });
  await page.goto("/battle/ffffffffffff");
  await expect(page.getByText("No battle at this link")).toBeVisible();
});

test("@narrow on a phone with room both decks still sit side by side", async ({
  page,
}) => {
  await page.setViewportSize({ width: 440, height: 860 });
  await mockApi(page, { "GET /api/me": [200, ME], ...battles });
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  const decks = page.getByRole("region", { name: /’s deck$/ });
  await expect(decks).toHaveCount(2);
  const [a, b] = [
    await decks.nth(0).boundingBox(),
    await decks.nth(1).boundingBox(),
  ];
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeLessThan(2);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(440);
  // A battle's page is in no place: nothing on the bar is lit (2026-10-02).
  await expect(page.locator(".kit-top [aria-current]")).toHaveCount(0);
  await accessible(page, "battle, narrow");
});
