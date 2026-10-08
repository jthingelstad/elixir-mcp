import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";
import { BATTLE } from "./battle-fixture.ts";
import { explore } from "./ladder-fixture.ts";

const tag = BATTLE.sides[0]!.players[0]!.player_tag;
const own = {
  ...ME,
  claims: [{ ...ME.claims[0], player_tag: tag, name: "PRIVATE nickname" }],
};
const path = `/battle/${BATTLE.battle.short_id}`;
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

async function preview(page: Page) {
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
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, own],
      [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, captured],
      "POST /api/explore": (route) => {
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
  await page.goto("/ladder/days");
  await page.locator(".ladder-night").first().getByRole("button").click();
  await page.locator("a.battle-row").first().click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("2 to 1");
  await expect(
    page.getByRole("region", { name: "How it ended" }),
  ).toBeVisible();
  await preview(page);
  const message = await page.getByLabel("Message preview").inputValue();
  expect(message).toContain(words);
  expect(message.endsWith(BATTLE.battle.url)).toBe(true);
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
      [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
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
  ).toBe(2);
  await page.evaluate(() => Reflect.get(window, "outbound").finish());
  await expect(page.getByRole("status")).toHaveText("Shared.");
  expect(
    await page.evaluate(() => Reflect.get(window, "outbound").shares[1].url),
  ).toBe(BATTLE.battle.url);
});

test("only a primary or alt participant can compose; missing records do not invent a share", async ({
  page,
}) => {
  for (const me of [
    SIGNED_OUT,
    ME,
    {
      ...own,
      claims: [{ ...own.claims[0], is_primary: false, relationship: "friend" }],
    },
  ]) {
    await mockApi(page, {
      "GET /api/me": [200, me],
      [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "2 to 1",
    );
    await expect(
      page.getByRole("button", { name: "Share with your context" }),
    ).toHaveCount(0);
    await page.unroute("**/api/**");
  }
  await mockApi(page, {
    "GET /api/me": [
      200,
      {
        ...own,
        claims: [{ ...own.claims[0], is_primary: false, relationship: "alt" }],
      },
    ],
    [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    "GET /api/public/battles/ffffffffffff": [404, { error: "not_found" }],
  });
  await page.goto(path);
  await expect(
    page.getByRole("button", { name: "Share with your context" }),
  ).toBeVisible();
  await preview(page);
  await page.goto("/battle/ffffffffffff");
  await expect(page.getByText("No battle at this link")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Share with your context" }),
  ).toHaveCount(0);
  await page.goto(path);
  await page.getByRole("button", { name: "Share with your context" }).click();
  await expect(page.getByLabel(/Why did this battle matter/)).toHaveValue("");
});

test("@narrow native-share preview fits small phones and desktop with accessible controls", async ({
  page,
}) => {
  await outbound(page);
  await mockApi(page, {
    "GET /api/me": [200, own],
    [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
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
