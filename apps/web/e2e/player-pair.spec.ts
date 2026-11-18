import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";
import { ADA } from "./player-fixture.ts";

const FRIEND = "#0PGQ2UYL",
  OWN = "#0RJ29CVY",
  ALT = "#0PLUG2V9";
const at = "2026-11-18T10:00:00Z";
const PAGE = {
  ...ADA,
  player: {
    ...ADA.player,
    tag: FRIEND,
    name: "Birch Lantern",
    clan_tag: null,
    clan_name: null,
  },
  you: { ...ADA.you, following: true, relationship: "friend", pair: true },
  timeline: [],
  moments: [],
};
const META = {
  state: "ready",
  selected_player: OWN,
  own_players: [
    { tag: OWN, name: "Reader" },
    { tag: ALT, name: "Other own player" },
  ],
  modes: [
    { key: "casual", teamed: 2, against: 0 },
    { key: "ladder", teamed: 0, against: 1 },
  ],
};
const game = (n: number, outcome = "win") => ({
  battle_id: String(n).padStart(64, "a"),
  at,
  outcome,
  url: `/battle/${String(n).padStart(12, "a")}`,
});
async function fixture(page: Page, extra: Parameters<typeof mockApi>[1] = {}) {
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [
        200,
        {
          ...ME,
          claims: [
            {
              player_tag: OWN,
              name: "Reader",
              is_primary: true,
              relationship: "primary",
              claim_status: "verified",
            },
          ],
        },
      ],
      "GET /api/player": [200, PAGE],
      "GET /api/me/posts": [200, { posts: [] }],
      "GET /api/me/player-pair": (route) => {
        const q = new URL(route.request().url()).searchParams;
        if (!q.has("side"))
          return [
            200,
            q.get("as") === ALT
              ? { ...META, selected_player: ALT, modes: [] }
              : META,
          ];
        return [
          200,
          {
            battles:
              q.get("mode") === "casual"
                ? [game(1), game(2, "loss")]
                : [game(3, "loss")],
            next_before: null,
          },
        ];
      },
      ...extra,
    }),
  );
}

for (const width of [320, 390, 1280]) {
  test(`Together keeps your player, mode and actual battle links distinct at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const reads: URL[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/me/player-pair")) reads.push(new URL(r.url()));
    });
    await fixture(page);
    await page.goto(`/home/player/${FRIEND.slice(1)}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Birch Lantern" }),
    ).toBeVisible();
    expect(reads).toEqual([]);
    const tab = page.getByRole("tab", { name: "Together", exact: true });
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const tabBox = await tab.boundingBox();
    expect(tabBox!.x).toBeGreaterThanOrEqual(0);
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(width);
    const together = page.getByRole("region", { name: "Your games together" });
    const teamed = together.getByRole("region", {
      name: "Teamed up",
      exact: true,
    });
    await expect(teamed.getByRole("link", { name: /Won/ })).toBeVisible();
    await expect(teamed.getByRole("link", { name: /Won/ })).toHaveAttribute(
      "href",
      game(1).url,
    );
    await expect(
      together
        .getByRole("region", { name: "Played against" })
        .getByText("None recorded in this mode."),
    ).toBeVisible();
    expect(
      reads.filter((u) => u.searchParams.get("side") === "against"),
    ).toHaveLength(0);
    for (const control of [
      tab,
      page.getByLabel("Your player"),
      page.getByLabel("Mode"),
      teamed.getByRole("link", { name: /Won/ }),
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    if (process.env.PAIR_SHOTS)
      await page.screenshot({
        path: `${process.env.PAIR_SHOTS}/pair-${width}.png`,
        fullPage: true,
      });
    await page.getByLabel("Mode").selectOption("ladder");
    const against = together.getByRole("region", { name: "Played against" });
    await expect(against.getByRole("link", { name: /Lost/ })).toHaveAttribute(
      "href",
      game(3).url,
    );
    await expect(teamed.getByRole("link")).toHaveCount(0);
    expect(reads.at(-1)!.searchParams.get("mode")).toBe("ladder");
    await page.getByLabel("Your player").selectOption(ALT);
    await expect(
      together.getByText("No shared battles recorded"),
    ).toBeVisible();
    await expect(together.getByRole("link")).toHaveCount(0);
    expect(reads.at(-1)!.searchParams.get("as")).toBe(ALT);
    expect(errors).toEqual([]);
  });
}

test("Together pages older games without duplicates and hides the tab for an ineligible association", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let available = true;
  await fixture(page, {
    "GET /api/player": () => [
      200,
      { ...PAGE, you: { ...PAGE.you, pair: available } },
    ],
    "GET /api/me/player-pair": (route) => {
      const q = new URL(route.request().url()).searchParams;
      if (!q.has("side"))
        return [
          200,
          { ...META, modes: [{ key: "casual", teamed: 21, against: 0 }] },
        ];
      return [
        200,
        {
          battles: q.has("before")
            ? [game(21)]
            : Array.from({ length: 20 }, (_, i) => game(i + 1)),
          next_before: q.has("before") ? null : "fixture-pair-page",
        },
      ];
    },
  });
  await page.goto(`/home/player/${FRIEND.slice(1)}?tab=together`);
  const teamed = page.getByRole("region", { name: "Teamed up", exact: true });
  await expect(teamed.getByRole("link")).toHaveCount(20);
  await teamed.getByRole("button", { name: "Older team battles" }).click();
  await expect(teamed.getByRole("link")).toHaveCount(21);
  const hrefs = await teamed
    .getByRole("link")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(21);
  available = false;
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Together", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("Together separates a failed read from unknown and unverified states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let state = "error";
  await fixture(page, {
    "GET /api/me/player-pair": () =>
      state === "error"
        ? [503, { error: "down" }]
        : state === "verify"
          ? [200, { state: "verify", own_players: [], modes: [] }]
          : [200, { ...META, modes: [] }],
  });
  await page.goto(`/home/player/${FRIEND.slice(1)}?tab=together`);
  await expect(
    page.getByText("Your games together could not be read just now"),
  ).toBeVisible();
  await expect(page.getByText("No shared battles recorded")).toHaveCount(0);
  if (process.env.PAIR_SHOTS)
    await page.screenshot({
      path: `${process.env.PAIR_SHOTS}/pair-error-390.png`,
      fullPage: true,
    });
  state = "empty";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("No shared battles recorded")).toBeVisible();
  if (process.env.PAIR_SHOTS)
    await page.screenshot({
      path: `${process.env.PAIR_SHOTS}/pair-empty-390.png`,
      fullPage: true,
    });
  state = "verify";
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Verify your player", exact: true }),
  ).toBeVisible();
});

test("losing verification while paging keeps the page usable and can recover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let verified = true;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page, {
    "GET /api/me/player-pair": (route) => {
      const q = new URL(route.request().url()).searchParams;
      if (!q.has("side"))
        return [
          200,
          { ...META, modes: [{ key: "casual", teamed: 21, against: 0 }] },
        ];
      if (!verified) return [403, { error: "verification_required" }];
      return [
        200,
        {
          battles: q.has("before")
            ? [game(21)]
            : Array.from({ length: 20 }, (_, i) => game(i + 1)),
          next_before: q.has("before") ? null : "fixture-pair-page",
        },
      ];
    },
  });
  await page.goto(`/home/player/${FRIEND.slice(1)}?tab=together`);
  const teamed = page.getByRole("region", { name: "Teamed up", exact: true });
  await expect(teamed.getByRole("link")).toHaveCount(20);
  verified = false;
  await teamed.getByRole("button", { name: "Older team battles" }).click();
  await expect(
    teamed.getByText("These battles could not be read just now"),
  ).toBeVisible();
  await expect(
    teamed.getByText("These battles could not be read just now"),
  ).toBeInViewport();
  await expect(
    page.getByRole("heading", { level: 1, name: "Birch Lantern" }),
  ).toBeVisible();
  await expect(page.getByText("No shared battles recorded")).toHaveCount(0);
  expect(errors).toEqual([]);
  if (process.env.PAIR_SHOTS)
    await page.screenshot({
      path: `${process.env.PAIR_SHOTS}/pair-verify-loss-390.png`,
      fullPage: false,
    });
  verified = true;
  const retry = teamed.getByRole("button", { name: "Try again", exact: true });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(
    teamed.getByText("These battles could not be read just now"),
  ).toHaveCount(0);
  await teamed.getByRole("button", { name: "Older team battles" }).click();
  await expect(teamed.getByRole("link")).toHaveCount(21);
  expect(errors).toEqual([]);
});
