import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/**
 * The Clan picker: a plain select beside the clan's name, only with two or
 * more clans (docs/DECISIONS.md, the picker reversal of 2026-11-05). The
 * fixture's person leads Example Clan and is a member of Second Clan; picking
 * lands on the Feed.
 */
const ACTIONS = {
  "GET /api/clan/clans/0QC8RCGY/actions": [
    200,
    {
      clan_tag: "#0QC8RCGY",
      as_of: "2026-09-13T09:00:00Z",
      open: [],
      recent: [],
      decline_reasons: ["not_now", "other"],
      discord: { set: false },
    },
  ] as [number, unknown],
};

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

const SIZES = [
  ["phone", { width: 390, height: 844 }],
  ["tablet", { width: 820, height: 1180 }],
  ["desktop", { width: 1280, height: 800 }],
] as const;

for (const [size, viewport] of SIZES)
  test(`switching clans from the head on a ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page, signedIn(ACTIONS));
    await page.goto("/clan/0JR0LRU0/members");
    await expect(page.getByText("Ben")).toBeVisible();
    const picker = page.getByRole("combobox", { name: "Clan" });
    await expect(picker).toHaveValue("#0JR0LRU0");
    await expect(picker.locator("option")).toHaveText([
      "Example Clan, Leader",
      "Second Clan, Member",
      "All your clans…",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await accessible(page, `the picker, ${size}`);

    // Everyone lands on the Feed.
    await picker.selectOption("#0QC8RCGY");
    await expect(page).toHaveURL(/\/clan\/0QC8RCGY\/feed$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Example Clan",
    );
    await expect(picker).toHaveValue("#0QC8RCGY");
    await picker.selectOption("#0JR0LRU0");
    await expect(page).toHaveURL(/\/clan\/0JR0LRU0\/feed$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Second Clan",
    );

    // Each pick was a step in history.
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/0QC8RCGY\/feed$/);
    await expect(picker).toHaveValue("#0QC8RCGY");
  });

test("the picker's last choice is the whole list of clans", async ({
  page,
}) => {
  await mockApi(page, signedIn(ACTIONS));
  await page.goto("/clan/0JR0LRU0/members");
  await expect(page.getByText("Ben")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Clan" })
    .selectOption({ label: "All your clans…" });
  await expect(page).toHaveURL(/\/clan\/clans$/);
  await expect(page.getByRole("heading", { name: "Your clans" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Clan" })).toHaveCount(0);
});

test("one clan: no picker at all", async ({ page }) => {
  const only = { ...ME, clans: [ME.clans[0]!], selected: ME.clans[0]! };
  await mockApi(
    page,
    signedIn({ ...ACTIONS, "GET /api/clan/me": [200, only] }),
  );
  await page.goto("/clan/0QC8RCGY/members");
  await expect(page.getByText("Ben")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Clan" })).toHaveCount(0);
});

test("@narrow the old address for your players goes to Players & following, and away to Members", async ({
  page,
}) => {
  await mockApi(page, signedIn(ACTIONS));
  await page.goto("/clan/0JR0LRU0/members");
  await expect(page.getByText("Ben")).toBeVisible();
  await page.goto("/clan/you/away");
  await expect(page).toHaveURL(/\/clan\/0JR0LRU0\/members\/away$/);
});
