import { test, expect } from "@playwright/test";
import { mockApi, signedIn } from "./fixtures.ts";

const base = "/clan/2PQRJ8LV";
const closed = {
  card_id: "closed-welcome",
  number: 44,
  type: "welcome",
  label: "Earlier welcome",
  status: "done",
  can_act: false,
  audience: { kind: "leaders" },
  raised_at: "2026-10-01T12:00:00Z",
  closed_at: "2026-10-02T12:00:00Z",
  evidence: {},
  log: [],
};
const activity = {
  name: "Ben",
  as_of: "2026-10-04T12:00:00Z",
  window: { from: "2026-09-21T00:00:00Z", to: "2026-10-04T12:00:00Z" },
  last_recorded_battle_in_clan: "2026-10-03T12:00:00Z",
  last_seen_in_game: null,
  weeks: [],
  war_weeks: [],
  coverage: { available: false, intervals: [] },
  battles: [
    {
      battle_id: "battle1",
      battle_time: "2026-10-03T12:00:00Z",
      mode_group: "war",
      game_mode: { name: "CW_Battle_1v1" },
      outcome: "win",
      crowns: 1,
      opponent_crowns: 0,
    },
    {
      battle_id: "battle2",
      battle_time: "2026-10-03T11:55:00Z",
      mode_group: "ranked",
      game_mode: { name: "Ranked1v1_NewArena2" },
      outcome: "loss",
      crowns: 0,
      opponent_crowns: 1,
    },
    {
      battle_id: "battle3",
      battle_time: "2026-10-03T11:50:00Z",
      mode_group: "future",
      game_mode: { name: "New mode" },
      outcome: "draw",
      crowns: 0,
      opponent_crowns: 0,
    },
  ],
  next_cursor: null,
};

for (const size of ["wide", "@narrow"]) {
  test(`Decided keeps its place through back forward and reload ${size}`, async ({
    page,
  }) => {
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/api\/clan\/(?!select)/.test(new URL(request.url()).pathname)
      )
        writes.push(request.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions": [
          200,
          { clan_tag: "#2PQRJ8LV", open: [], recent: [closed] },
        ],
        "GET /api/clan/clans/2PQRJ8LV/history": [
          200,
          {
            cards: [{ ...closed, decided_at: new Date().toISOString() }],
            timeline: [],
            holds: [],
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/actions/44": [
          200,
          { action: closed, decline_reasons: [] },
        ],
      }),
    );
    // Decided is Run's (slice 8, #766).
    await page.goto(`${base}/run/decided`);
    await expect(page).toHaveURL(/\/run\/decided$/);
    await page.getByRole("link", { name: /Earlier welcome/ }).click();
    await expect(page).toHaveURL(/\/actions\/44$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/run\/decided$/);
    await expect(
      page.getByRole("link", { name: /Earlier welcome/ }),
    ).toBeVisible();
    await page.goForward();
    await expect(
      page
        .getByRole("heading", { name: "Earlier welcome", exact: true })
        .first(),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("link", { name: "‹ Feed" }).click();
    await expect(page).toHaveURL(/\/feed$/);
    await expect(
      page.getByText("Nothing waiting for you", { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/actions\/44$/);
    await page.screenshot({
      path: `/tmp/elixir-actions-context-${size.replace("@", "")}.png`,
      fullPage: true,
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`roster search survives member activity and refresh with consistent mode names ${size}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/members/UQ8LP2R9C/activity": [
          200,
          activity,
        ],
      }),
    );
    await page.goto(`${base}/members`);
    await page.getByRole("searchbox", { name: "Find a member" }).fill("Ben");
    await page.getByRole("searchbox", { name: "Find a member" }).press("Enter");
    await expect(page).toHaveURL(/\?find=Ben$/);
    // A name opens the player page (slice 8, #766); the member's old page
    // here is its Clan tab (2026-11-12), and Back is the roster's search.
    await expect(
      page.getByRole("link", { name: "Ben", exact: true }),
    ).toHaveAttribute("href", "/home/player/UQ8LP2R9C");
    await page.goto(`${base}/members/uq8lp2r9c?find=Ben`);
    await expect(page).toHaveURL(/\/home\/player\/UQ8LP2R9C\?tab=clan$/);
    await page.getByText("Recent battles in this clan").click();
    await expect(page.getByText(/^War · win/)).toBeVisible();
    await expect(page.getByText(/^Path of Legends · loss/)).toBeVisible();
    await expect(page.getByText(/^New mode · draw/)).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("searchbox", { name: "Find a member" }),
    ).toHaveValue("Ben");
    await page.reload();
    await expect(
      page.getByRole("searchbox", { name: "Find a member" }),
    ).toHaveValue("Ben");
    await page.getByRole("link", { name: "Ben", exact: true }).click();
    await page.goBack();
    await expect(
      page.getByRole("searchbox", { name: "Find a member" }),
    ).toHaveValue("Ben");
    await page.getByRole("searchbox", { name: "Find a member" }).fill("");
    await page.getByRole("searchbox", { name: "Find a member" }).press("Enter");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members$/);
    await expect(
      page.getByRole("link", { name: "Ada", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
