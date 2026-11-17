import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";
import { explore } from "./stats-fixture.ts";

const tag = BATTLE.sides[0]!.players[0]!.player_tag;
const own = {
  ...ME,
  claims: [{ ...ME.claims[0], player_tag: tag, name: "PRIVATE nickname" }],
};
const path = `/battle/${BATTLE.battle.short_id}`;
const SHARE_URL = "https://elixir.poapkings.com/share/abcdefghijklmnopqrstuvwx";
const shareAnswer: [number, unknown] = [200, { url: SHARE_URL }];
const words = "My first close win after returning. I held on at the end.";

async function outbound(page: Page) {
  await page.addInitScript(() => {
    const state = {
      copies: [] as string[],
      shares: [] as ShareData[],
      copyFails: false,
      shareMode: "cancel",
      finish: null as null | (() => void),
    };
    Object.assign(window, { outbound: state });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (message: string) => {
          state.copies.push(message);
          if (state.copyFails) throw new Error("fixture permission denial");
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (message: ShareData) => {
        state.shares.push(message);
        if (state.shareMode === "cancel")
          throw new DOMException("Fixture cancellation", "AbortError");
        if (state.shareMode === "pending")
          await new Promise<void>((resolve) => {
            state.finish = resolve;
          });
      },
    });
  });
}

async function mint(page: Page) {
  const sharing = page.getByRole("region", { name: "Share this battle" });
  await sharing.getByRole("button", { name: "Share", exact: true }).click();
  await expect(
    sharing.getByRole("link", { name: "Share image" }),
  ).toHaveAttribute("href", SHARE_URL + ".png");
}

async function preview(page: Page) {
  await expect(page.getByLabel(/Why did this battle matter/)).toHaveCount(0);
  await mint(page);
  await page.getByRole("button", { name: "Share with your context" }).click();
  await page.getByLabel(/Why did this battle matter/).fill(words);
  await page.getByRole("button", { name: "Preview message" }).click();
}

test("choose a captured battle, inspect facts, preview and copy only deliberate words and its canonical link", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-29T21:00:00Z"));
  await outbound(page);
  // One captured battle in the season; the compact and public projections
  // refer to the same fixture record, with its played time in this season.
  const captured = {
    ...BATTLE,
    battle: { ...BATTLE.battle, battle_time: "2026-09-28T23:11:39.000Z" },
  };
  const source = explore();
  const issued: unknown[] = [];
  const posts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/me/posts"
    )
      posts.push(request.url());
  });
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, own],
      "POST /api/me/item-shares": (route) => {
        issued.push(route.request().postDataJSON());
        return shareAnswer;
      },
      [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, captured],
      "POST /api/me/tool": (route) => {
        const [status, payload] = source(route);
        const result = payload as {
          tool: string;
          body: {
            battles: Record<string, unknown>[];
            total_count: number;
            next_cursor: string | null;
          };
        };
        if (result.tool === "battles_query") {
          result.body.battles = [
            {
              ...result.body.battles[0],
              battle_id: captured.battle.id,
              url: captured.battle.url,
              battle_time: captured.battle.battle_time,
              mode_group: "ladder",
              me: {
                ...captured.sides[0]!.players[0],
                outcome: "win",
                crowns: 2,
                trophy_change: 30,
              },
              opponents: [{ ...captured.sides[1]!.players[0], crowns: 1 }],
            },
          ];
          result.body.total_count = 1;
          result.body.next_cursor = null;
        }
        return [status, result];
      },
    }),
  );
  await page.goto("/home/you/stats/battles");
  await page.locator(".stats-row a").first().click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("2 to 1");
  await expect(
    page.getByRole("region", { name: "How it ended" }),
  ).toBeVisible();
  await preview(page);
  expect(issued).toEqual([
    { source: "battle", battle_ref: captured.battle.id },
  ]);
  expect(posts).toEqual([]);
  expect(
    await page.evaluate(() => Reflect.get(window, "outbound").shares[0]),
  ).toEqual({ url: SHARE_URL });
  const message = await page.getByLabel("Message preview").inputValue();
  expect(message).toContain(words);
  expect(message.endsWith(SHARE_URL)).toBe(true);
  expect(message).not.toContain("PRIVATE");
  expect(message).not.toContain(ME.email);
  await page.getByRole("button", { name: "Back to edit" }).click();
  await expect(page.getByLabel(/Why did this battle matter/)).toHaveValue(
    words,
  );
  await page.getByRole("button", { name: "Preview message" }).click();
  await page.getByRole("button", { name: "Copy message" }).click();
  await expect(page.getByRole("status")).toHaveText("Message copied.");
  expect(
    await page.evaluate(() => Reflect.get(window, "outbound").copies),
  ).toEqual([message]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Share with your context" }).click();
  await expect(page.getByLabel(/Why did this battle matter/)).toHaveValue("");
});

test("native cancellation, failed clipboard and pending repeated sharing preserve the preview", async ({
  page,
}) => {
  await outbound(page);
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, own],
      "POST /api/me/item-shares": shareAnswer,
      [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    }),
  );
  await page.goto(`${path}?token=PRIVATE#note=PRIVATE`);
  await preview(page);
  const message = await page.getByLabel("Message preview").inputValue();
  expect(message).not.toContain("PRIVATE");
  await page
    .getByRole("button", { name: "Share message", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Share canceled");
  await expect(page.getByLabel("Message preview")).toHaveValue(message);
  await page.evaluate(() => {
    Reflect.get(window, "outbound").copyFails = true;
  });
  await page.getByRole("button", { name: "Copy message" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Select the message below",
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.get(window, "outbound").shareMode = "pending";
  });
  await page
    .getByRole("button", { name: "Share message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to edit" }),
  ).toBeDisabled();
  // A second physical click on the disabled control cannot send again.
  await page
    .getByRole("button", { name: "Share message", exact: true })
    .dispatchEvent("click");
  expect(
    await page.evaluate(() => Reflect.get(window, "outbound").shares.length),
  ).toBe(3);
  await page.evaluate(() => Reflect.get(window, "outbound").finish());
  await expect(page.getByRole("status")).toHaveText("Shared.");
  expect(
    await page.evaluate(() => Reflect.get(window, "outbound").shares[2].url),
  ).toBe(SHARE_URL);
});

test("only a primary or alt participant can compose; missing records do not invent a share", async ({
  page,
}) => {
  for (const me of [
    ME,
    {
      ...own,
      claims: [{ ...own.claims[0], is_primary: false, relationship: "friend" }],
    },
  ]) {
    await mockApi(page, {
      "GET /api/me": [200, me],
      "POST /api/me/item-shares": shareAnswer,
      [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "2 to 1",
    );
    await mint(page);
    await expect(
      page.getByRole("button", { name: "Share with your context" }),
    ).toHaveCount(0);
    await page.unroute("**/api/**");
  }
  await mockApi(page, {
    "POST /api/me/item-shares": shareAnswer,
    "GET /api/me": [
      200,
      {
        ...own,
        claims: [{ ...own.claims[0], is_primary: false, relationship: "alt" }],
      },
    ],
    [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    "GET /api/me/battles/ffffffffffff": [404, { error: "not_found" }],
  });
  await page.goto(path);
  await preview(page);
  await page.goto("/battle/ffffffffffff");
  await expect(page.getByText("No battle at this link")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share with your context" }),
  ).toHaveCount(0);
  await page.goto(path);
  await mint(page);
  await page.getByRole("button", { name: "Share with your context" }).click();
  await expect(page.getByLabel(/Why did this battle matter/)).toHaveValue("");
});

test("@narrow native-share preview fits small phones and desktop with accessible controls", async ({
  page,
}) => {
  await outbound(page);
  await mockApi(page, {
    "GET /api/me": [200, own],
    "POST /api/me/item-shares": shareAnswer,
    [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
  });
  await page.goto(path);
  await preview(page);
  for (const width of [320, 375, 390, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    const share = page.getByRole("region", { name: "Share this battle" });
    await share.scrollIntoViewIfNeeded();
    expect(
      await share.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await share
      .getByRole("button", { name: "Copy message", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { outbound: { copies: string[] } }
        ).outbound.copies.at(-1),
      ),
    ).toContain(words);
    await share
      .getByRole("button", { name: "Back to edit", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/Why did this battle matter/)).toHaveValue(
      words,
    );
    await share
      .getByRole("button", { name: "Preview message", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page.screenshot({
      path: `/tmp/player-battle-share-${width}.png`,
      fullPage: true,
    });
  }
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});

test("a signed-out bare battle cannot mint a public link", async ({ page }) => {
  const minted: unknown[] = [];
  await mockApi(page, {
    "GET /api/me": [200, SIGNED_OUT],
    [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [
      404,
      { error: "not_found" },
    ],
    "POST /api/me/item-shares": (route) => {
      minted.push(route.request().postDataJSON());
      return shareAnswer;
    },
  });
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Sign in first", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Share this battle" }),
  ).toHaveCount(0);
  expect(minted).toEqual([]);
});

const NEXT_SHARE_URL =
  "https://elixir.poapkings.com/share/zyxwvutsrqponmlkjihgfedc";
const NEXT_BATTLE = {
  ...BATTLE,
  battle: {
    ...BATTLE.battle,
    id: "b".repeat(64),
    short_id: "b".repeat(12),
    url: "https://elixir.poapkings.com/battle/" + "b".repeat(12),
    image: "https://elixir.poapkings.com/battle/" + "b".repeat(12) + ".png",
  },
};
const targetShots = process.env.SHARE_TARGET_SHOTS;

test("warm cached battles reset shares and optional context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await outbound(page);
  const rows = [BATTLE, NEXT_BATTLE].map((record) => ({
    ...BATTLE.sitting[0]!,
    url: record.battle.url,
    battle_time: record.battle.battle_time,
  }));
  const issued: unknown[] = [];
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, own],
      [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [
        200,
        { ...BATTLE, sitting: rows, meetings: [] },
      ],
      [`GET /api/me/battles/${NEXT_BATTLE.battle.short_id}`]: [
        200,
        { ...NEXT_BATTLE, sitting: rows, meetings: [] },
      ],
      "POST /api/me/item-shares": (route) => {
        const target = route.request().postDataJSON();
        issued.push(target);
        return [
          200,
          {
            url:
              target.battle_ref === BATTLE.battle.id
                ? SHARE_URL
                : NEXT_SHARE_URL,
          },
        ];
      },
    }),
  );
  const jump = async (short: string) => {
    await page
      .locator(`.battle-rows a[href="/battle/${short}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/battle/${short}$`));
  };
  await page.goto(path);
  await page.evaluate(() =>
    Reflect.set(window, "shareWarmMarker", "same document"),
  );
  // Fill both query-cache entries before minting. The final A→B switch
  // has no loading unmount to hide state leaking across target identity.
  await jump(NEXT_BATTLE.battle.short_id);
  await jump(BATTLE.battle.short_id);
  await preview(page);
  await jump(NEXT_BATTLE.battle.short_id);
  expect(
    await page.evaluate(() => Reflect.get(window, "shareWarmMarker")),
  ).toBe("same document");
  const sharing = page.getByRole("region", { name: "Share this battle" });
  await expect(sharing.getByRole("link", { name: "Share image" })).toHaveCount(
    0,
  );
  await expect(
    sharing.getByRole("button", { name: "Copy for a post" }),
  ).toHaveCount(0);
  await expect(
    sharing.getByRole("button", { name: "Share with your context" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Message preview")).toHaveCount(0);
  const share = sharing.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeEnabled();
  expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await sharing.scrollIntoViewIfNeeded();
    expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (targetShots)
      await page.screenshot({ path: `${targetShots}/reset-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }
  await share.click();
  await expect(sharing.getByLabel("Share link")).toHaveValue(NEXT_SHARE_URL);
  await expect(
    sharing.getByRole("link", { name: "Share image" }),
  ).toHaveAttribute("href", NEXT_SHARE_URL + ".png");
  expect(issued).toEqual([
    { source: "battle", battle_ref: BATTLE.battle.id },
    { source: "battle", battle_ref: NEXT_BATTLE.battle.id },
  ]);
  await sharing
    .getByRole("button", { name: "Share with your context" })
    .click();
  await expect(page.getByLabel(/Why did this battle matter/)).toHaveValue("");
  await page
    .getByLabel(/Why did this battle matter/)
    .fill("Words for the second battle only.");
  await page.getByRole("button", { name: "Preview message" }).click();
  await expect(page.getByLabel("Message preview")).toHaveValue(
    new RegExp(NEXT_SHARE_URL + "$"),
  );
  expect(await page.getByLabel("Message preview").inputValue()).not.toContain(
    words,
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await sharing.scrollIntoViewIfNeeded();
    if (targetShots)
      await page.screenshot({ path: `${targetShots}/next-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
});

test("a late first-battle share cannot replace the next warm battle's outbound link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await outbound(page);
  const rows = [BATTLE, NEXT_BATTLE].map((record) => ({
    ...BATTLE.sitting[0]!,
    url: record.battle.url,
    battle_time: record.battle.battle_time,
  }));
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, own],
      [`GET /api/me/battles/${BATTLE.battle.short_id}`]: [
        200,
        { ...BATTLE, sitting: rows, meetings: [] },
      ],
      [`GET /api/me/battles/${NEXT_BATTLE.battle.short_id}`]: [
        200,
        { ...NEXT_BATTLE, sitting: rows, meetings: [] },
      ],
    }),
  );
  // The shared fixture map is synchronous; this one route deliberately
  // holds A while navigation and B's response complete independently.
  await page.route("**/api/me/item-shares", async (route) => {
    const first =
      route.request().postDataJSON().battle_ref === BATTLE.battle.id;
    if (first) await pending;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: first ? SHARE_URL : NEXT_SHARE_URL }),
    });
  });
  const jump = async (short: string) => {
    await page
      .locator(`.battle-rows a[href="/battle/${short}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/battle/${short}$`));
  };
  try {
    await page.goto(path);
    await jump(NEXT_BATTLE.battle.short_id);
    await jump(BATTLE.battle.short_id);
    const sharing = page.getByRole("region", { name: "Share this battle" });
    await sharing.getByRole("button", { name: "Share", exact: true }).click();
    await expect(
      sharing.getByRole("button", { name: "Getting link…" }),
    ).toBeDisabled();
    await jump(NEXT_BATTLE.battle.short_id);
    await sharing.getByRole("button", { name: "Share", exact: true }).click();
    await expect(sharing.getByLabel("Share link")).toHaveValue(NEXT_SHARE_URL);
    const firstResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/me/item-shares") &&
        response.request().postDataJSON().battle_ref === BATTLE.battle.id,
    );
    release();
    await (await firstResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "outbound").shares.map(
          (entry: ShareData) => entry.url,
        ),
      ),
    ).toEqual([NEXT_SHARE_URL]);
    expect(
      await page.evaluate(() => Reflect.get(window, "outbound").copies),
    ).toEqual([]);
    await expect(sharing.getByLabel("Share link")).toHaveValue(NEXT_SHARE_URL);
    await sharing
      .getByRole("button", { name: "Share with your context" })
      .click();
    await page.getByRole("button", { name: "Preview message" }).click();
    await expect(page.getByLabel("Message preview")).toHaveValue(
      new RegExp(NEXT_SHARE_URL + "$"),
    );
  } finally {
    release();
  }
});
