import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, ME } from "./fixtures.ts";

const FRIEND = {
  player_tag: "#0VJ2QV",
  name: "Invented Willow",
  relationship: "friend",
  is_primary: false,
  claim_status: "unverified",
  status: "unverified",
  notify: false,
  close: false,
};

for (const width of [320, 390, 1280]) {
  test(`one friend list and relationship choice, with notify unchanged at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        new URL(request.url()).pathname === "/api/claims"
      )
        writes.push(request.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [
          200,
          {
            ...ME,
            claims: [
              ...ME.claims.map((c) => ({ ...c, status: c.claim_status })),
              FRIEND,
            ],
            entitlements: {
              ...ME.entitlements,
              player_slots: { used: 2, limit: 50 },
            },
            recordings: [
              ...ME.recordings,
              {
                subject_tag: FRIEND.player_tag,
                kind: "player",
                status: "active",
                created_at: "2026-11-17T18:00:00Z",
                freshest_poll: "2026-11-18T01:00:00Z",
                fetches_24h: 4,
              },
            ],
          },
        ],
        "GET /api/me/first-answer": [
          200,
          {
            player: {
              player_tag: FRIEND.player_tag,
              name: FRIEND.name,
              is_primary: false,
              relationship: "friend",
              recording_status: "active",
              profile_available: true,
              profile_observed_at: "2026-11-18T01:00:00Z",
              battlelog_observed_at: "2026-11-18T01:00:00Z",
              tracked_since: "2026-11-17T18:00:00Z",
              battles_30d: 0,
              battles_7d: 0,
            },
            connection: {
              active_connections: 0,
              successful_data_calls_7d: 0,
              data_read_days_7d: 0,
              last_data_read_at: null,
            },
            clan: null,
          },
        ],
      }),
    );
    await page.goto("/settings/players");
    await expect(
      page.getByRole("heading", { name: "Friends", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(FRIEND.name, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Watching", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Add as").locator("option")).toHaveText([
      "Friend",
      "Also you",
    ]);
    const addAs = page.getByLabel("Add as");
    await addAs.focus();
    await expect(addAs).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Follow", exact: true }),
    ).toBeFocused();
    await addAs.selectOption("alt");
    await expect(addAs).toHaveValue("alt");
    await addAs.selectOption("friend");
    await expect(addAs).toHaveValue("friend");
    for (const control of [
      page.getByLabel("Player tag", { exact: true }),
      addAs,
    ]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `/tmp/elixir-friend-follows-${width}.png`,
      fullPage: true,
    });
    await page.goto(`/settings/players/${FRIEND.player_tag.slice(1)}`);
    await expect(
      page.getByRole("combobox", { name: "Relationship" }).locator("option"),
    ).toHaveText(["Friend", "Also you"]);
    await expect(
      page.getByRole("switch", { name: "On your timeline" }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByRole("button", { name: "Stop watching" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Verify your player" }),
    ).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const select = await page
      .getByRole("combobox", { name: "Relationship" })
      .boundingBox();
    expect(select!.height).toBeGreaterThanOrEqual(44);
    expect(select!.width).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: `/tmp/elixir-friend-manage-${width}.png`,
      fullPage: true,
    });
    expect(writes).toEqual([]);
  });
}
