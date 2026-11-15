import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { mockApi } from "./fixtures.ts";
import { homeApi, ownerPassport } from "./home-fixture.ts";
import { ADA } from "./player-fixture.ts";
import { signedIn as clanIn } from "./clan/fixtures.ts";
import { identityFixtures } from "./identity-fixture.ts";

/**
 * Phone friction (#1016): a quiet Home says why as far as Elixir knows it
 * and leads to Find, with People to follow in the main column; the player
 * page's and Clan's tabs keep one row at 320 and 390, scrolling inside
 * their bar with a chevron on the edge that has more, every tab still one
 * tap away. Invented players only. Set ELIXIR_DESIGN_CAPTURE_DIR to keep
 * the captures for review.
 */
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

async function capture(page: Page, name: string) {
  const dir = process.env.ELIXIR_DESIGN_CAPTURE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    animations: "disabled",
  });
}

async function noSideways(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

/** Every tab in the row shares one top: no second line. */
async function oneRow(page: Page, label: string) {
  const tops = await page
    .getByRole("tablist", { name: label })
    .getByRole("tab")
    .evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
  expect(tops.length).toBeGreaterThan(3);
  expect(new Set(tops).size, `${label}: ${tops.join(",")}`).toBe(1);
}

const EMPTY_FEED = {
  as_of: new Date().toISOString(),
  window: {
    from: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    to: new Date().toISOString(),
  },
  seen_to: null,
  timeline: [],
  total: 0,
  next: null,
  timeline_more: 0,
};

const SUGGESTED = {
  ok: true,
  used: 3,
  limit: 50,
  people: [
    {
      tag: "#0YCLGYCG",
      name: "Juniper",
      why: [{ kind: "battles", against: 1, friendly: 1, with_you: 0, days: 7 }],
      free: false,
      reason: null,
    },
    {
      tag: "#00QGUQRG",
      name: "Hazel",
      why: [{ kind: "clan", clan_name: "Ada's Clan" }],
      free: true,
      reason: "followed_by_others",
    },
  ],
};

for (const width of [320, 390, 1280]) {
  test(`a quiet Home says why and leads to Find at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(
      page,
      homeApi({
        "GET /api/me/home/feed": [200, EMPTY_FEED],
        "GET /api/me/people/suggested": [200, SUGGESTED],
        "GET /api/me/passport": [
          200,
          ownerPassport(["done", "done", "done", "todo", "done", "done"], {
            follows: { following: 3, active: 0, inactive: 3, unknown: 0 },
          }),
        ],
      }),
    );
    await page.goto("/home");
    const quiet = page.getByRole("heading", {
      name: "The players you follow have been quiet",
    });
    await expect(quiet).toBeVisible();
    await expect(page.getByText(/notify switch/)).toHaveCount(0);
    const find = page.getByRole("link", { name: "Find your people" });
    await expect(find).toHaveAttribute("href", "/home/find");
    // People to follow moves under the quiet line, before Your week, and
    // is drawn once.
    const people = page.getByRole("heading", { name: "People to follow" });
    await expect(people).toHaveCount(1);
    await expect(page.getByText("Juniper")).toBeVisible();
    // Each with why, as a fact.
    await expect(
      page.getByText("You played a friendly battle this week"),
    ).toBeVisible();
    const [p, w] = await Promise.all([
      people.boundingBox(),
      page.getByRole("heading", { name: "Your week" }).boundingBox(),
    ]);
    if (width < 761) expect(p && w && p.y < w.y).toBe(true);
    await noSideways(page);
    await accessible(page, `quiet Home ${width}`);
    await capture(page, `quiet-home-${width}`);
  });

  test(`the player page's tabs keep one row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, homeApi({ "GET /api/player": [200, ADA] }));
    await page.goto("/home/player/00C298UC");
    await expect(page.locator(".kit-phead__name")).toBeVisible();
    await oneRow(page, "Player");
    await noSideways(page);
    // The last tab is still one tap away: scroll it in and open it.
    const record = page
      .getByRole("tablist", { name: "Player" })
      .getByRole("tab", { name: "Record" });
    await record.scrollIntoViewIfNeeded();
    await record.click();
    await expect(record).toHaveAttribute("aria-selected", "true");
    await page.goto("/home/player/00C298UC");
    await expect(page.locator(".kit-phead__name")).toBeVisible();
    await capture(page, `player-tabs-${width}`);
    await accessible(page, `player tabs ${width}`);
  });

  test(`Clan's tabs keep one row and deep links still open at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, identityFixtures({ ...clanIn(), ...homeApi() }));
    // A deep link to the last tab opens it, scrolled into view.
    await page.goto("/clan/0QC8RCGY/policy");
    const bar = page.getByRole("tablist", { name: "Clan" });
    const policy = bar.getByRole("tab", { name: "Policy" });
    await expect(policy).toHaveAttribute("aria-selected", "true");
    await expect(policy).toBeInViewport();
    await oneRow(page, "Clan");
    await noSideways(page);
    await page.goto("/clan/0QC8RCGY/members");
    await expect(bar.getByRole("tab", { name: "Members" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await oneRow(page, "Clan");
    await capture(page, `clan-tabs-${width}`);
    await accessible(page, `clan tabs ${width}`);
  });
}
