import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * Find opens on Suggested (2026-11-13). Jamie: Find "lands you on a search
 * that ONLY works by player tag and is essnetially a dead end... give me a
 * list to just click on of suggested follows and give me a line on why".
 * Every row says why as a fact and what following costs; ten show, then
 * Show more. Invented players only.
 */
const HOSTILE = "<img src=x onerror=alert(1)>Fern";
const battles = (o: Record<string, number>) => [
  {
    kind: "battles",
    against: 0,
    with_you: 0,
    friendly: 0,
    clanmate_battles: 0,
    days: 30,
    ...o,
  },
];
const CLANMATES = [
  "#02G2PJC0",
  "#08VP8VYY",
  "#0J9YCYL2",
  "#09VURCVC",
  "#0VJLCPJ0",
  "#00JRG2RU",
  "#0LJR0G22",
  "#0U082URG",
  "#00092VJ2",
];
const PEOPLE = [
  {
    tag: "#0YP8U0Y0",
    name: HOSTILE,
    why: battles({ against: 1, friendly: 1 }),
    free: false,
    reason: null,
  },
  {
    tag: "#0G2ULUJP",
    name: "Juniper",
    why: [
      {
        kind: "followed_by",
        via: { tag: "#0Q2UQ2YR", name: "Ada" },
        others: 0,
      },
    ],
    free: false,
    reason: null,
  },
  {
    tag: "#080J2V9Q",
    name: "Elm",
    why: battles({ with_you: 2 }),
    free: true,
    reason: "recorded",
  },
  ...CLANMATES.map((tag, i) => ({
    tag,
    name: `Invented Clanmate ${i + 1}`,
    why: [{ kind: "clan", clan_name: "Grove" }],
    free: false,
    reason: null,
  })),
];
const FIND = {
  ok: true,
  days: 30,
  people: PEOPLE,
  more: 4,
  used: 3,
  limit: 50,
};

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const [label, width] of [
  ["phone", 390],
  ["desktop", 1180],
] as const) {
  test(`${label}: Find opens on Suggested, a list to tap with why on every row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, homeApi({ "GET /api/me/people/find": [200, FIND] }));
    await page.goto("/home/find");
    const find = page.getByRole("tablist", { name: "Find" });
    await expect(find.getByRole("tab", { name: "Suggested" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const list = page.locator(".kit-findsuggest");
    const rows = list.locator(".kit-people__row");
    await expect(rows).toHaveCount(10);
    await expect(rows.nth(0)).toContainText(
      "You played a friendly battle in the last 30 days",
    );
    await expect(rows.nth(0)).toContainText("Uses a slot");
    await expect(rows.nth(1)).toContainText("Ada follows them");
    await expect(rows.nth(2)).toContainText(
      "Your 2v2 teammate twice in the last 30 days",
    );
    await expect(rows.nth(2)).toContainText("Free · already recorded");
    await expect(rows.nth(3)).toContainText("In your clan");
    await expect(
      list.getByRole("link", { name: "Juniper", exact: true }),
    ).toHaveAttribute("href", "/home/player/0G2ULUJP");
    // A hostile name is text.
    await expect(list.getByText(HOSTILE)).toBeVisible();
    await expect(list.locator("img[src=x]")).toHaveCount(0);
    await noSideways(page);
    await page.screenshot({
      path: test.info().outputPath(`find-suggested-${width}.png`),
    });
    const results = await new AxeBuilder({ page })
      .include(".kit-findsuggest")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);

    // Show more: the rest of the list, and where more are.
    await list.getByRole("button", { name: "Show more (2)" }).click();
    await expect(rows).toHaveCount(12);
    await expect(list).toContainText(
      "More are in From your battles and Your clan.",
    );
    await list.getByRole("button", { name: "Show fewer" }).click();
    await expect(rows).toHaveCount(10);
  });
}

test("a Follow on Suggested is the one confirmed, priced Follow", async ({
  page,
}) => {
  const posted: unknown[] = [];
  await mockApi(
    page,
    homeApi({
      "GET /api/me/people/find": [200, FIND],
      "POST /api/claims": (route) => {
        posted.push(route.request().postDataJSON());
        return [
          200,
          {
            ok: true,
            player_tag: "#0G2ULUJP",
            added: true,
            first_read: true,
            not_found: false,
            relationship: "friend",
          },
        ];
      },
    }),
  );
  await page.goto("/home/find");
  const row = page
    .locator(".kit-findsuggest .kit-people__row")
    .filter({ hasText: "Juniper" });
  await row.getByRole("button", { name: "Follow", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Follow Juniper?" });
  await expect(dialog).toContainText("Uses 1 of your 50 player slots · 3 used");
  expect(posted).toEqual([]);
  await dialog.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(posted).toEqual([{ player_tag: "#0G2ULUJP", relationship: "friend" }]);
});
