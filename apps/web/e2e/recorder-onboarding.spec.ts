import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";

const connection = {
  active_connections: 0,
  successful_data_calls_7d: 0,
  data_read_days_7d: 0,
  last_data_read_at: null,
};
const player = {
  player_tag: ME.claims[0]!.player_tag,
  name: "Example player",
  recording_status: "active",
  profile_available: false,
  profile_observed_at: null,
  last_battle_at: null,
  battles_30d: 0,
  battles_7d: 0,
};
const profile = {
  player_tag: player.player_tag,
  name: player.name,
  snapshot: {
    date: "2026-10-06",
    trophies: 9001,
    lifetime: { battle_count: 1234, wins: 800, losses: 400 },
  },
};
const summary = {
  player_tag: player.player_tag,
  name: player.name,
  last_30_days: { battles: 0, wins: 0, losses: 0 },
  top_deck: null,
};
const PLAYER_PAGE = {
  player: {
    tag: player.player_tag,
    name: player.name,
    clan_tag: null,
    clan_name: null,
    trophies: 9001,
    recorded: true,
  },
  you: { own: true, following: false, relationship: "primary", clanmate: null },
  badges: {},
  follows: { count: 0, players: [] },
  followers: { count: 0, players: [] },
  window_days: 30,
  timeline: [],
  timeline_more: 0,
  moments: [],
  highlights: [],
};
const battle = {
  battle_id: "abc123abc123",
  battle_time: "2026-07-01T13:00:00Z",
  type: "riverRacePvP",
  game_mode: { name: "River Race" },
  me: {
    player_tag: player.player_tag,
    outcome: "win",
    deck_hash: null,
    trophy_change: null,
  },
  opponents: [{ player_tag: "#00J", name: "Recorded rival" }],
};
const clan = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  war_weeks: 3,
  latest_week: { season_id: 120, section_index: 1 },
};
const history = {
  clan_tag: clan.clan_tag,
  name: clan.name,
  weeks: [{ season_id: 120, section_index: 1, our_fame: 3456 }],
  standings: [],
  days: [],
  member_weeks: [],
};
const cases = [
  {
    name: "browser-only newcomer",
    player: null,
    clan: null,
    action: "Go to Players & following",
    to: "/settings/players",
    state: "Add your player",
  },
  {
    name: "accepted tag pending capture",
    player,
    clan: null,
    action: "Check recording status",
    to: "/settings/players/20JJJ2CCRU",
    state: "First read pending",
  },
  {
    name: "profile without captured battles",
    player: { ...player, profile_available: true },
    clan: null,
    action: "View recorded profile",
    to: "/home/player/20JJJ2CCRU?tab=record",
    state: "Recorded and ready to read",
  },
  {
    name: "stopped with older retained history",
    player: {
      ...player,
      recording_status: "stopped",
      last_battle_at: battle.battle_time,
    },
    clan: null,
    action: "Open the player page",
    to: "/home/player/20JJJ2CCRU",
    state: "Recording stopped",
  },
  {
    name: "war-only battles",
    player: { ...player, battles_30d: 1, battles_7d: 1 },
    clan: null,
    action: "Open the player page",
    to: "/home/player/20JJJ2CCRU",
    state: "Recorded and ready to read",
  },
  {
    name: "failed attempt with retained profile",
    player: {
      ...player,
      profile_available: true,
      capture_attempts: [
        {
          endpoint: "player",
          last_failed_at: "2026-10-06T23:00:00Z",
          last_admitted_at: "2026-10-06T22:00:00Z",
        },
      ],
    },
    clan: null,
    action: "View recorded profile",
    to: "/home/player/20JJJ2CCRU?tab=record",
    state: "The last read failed",
  },
  {
    name: "profile not found before any capture",
    player: {
      ...player,
      capture_attempts: [
        {
          endpoint: "player",
          last_failed_at: "2026-10-06T23:00:00Z",
          last_failed_status: 404,
        },
      ],
    },
    clan: null,
    action: "Fix the tag",
    // Lands on the inline fix on the player's page (2026-10-08).
    to: "/settings/players/20JJJ2CCRU#fix-tag",
    state: "Tag not found",
  },
  {
    name: "partial capture",
    player: {
      ...player,
      battles_30d: 3,
      capture_interval: {
        ratio: 0.5,
        observed_from: "2026-10-05T10:00:00Z",
        observed_to: "2026-10-06T10:00:00Z",
        expected_battles: 6,
        captured_battles: 3,
      },
    },
    clan: null,
    action: "Open the player page",
    to: "/home/player/20JJJ2CCRU",
    state: "Recorded and ready to read",
  },
  {
    name: "paused empty record",
    player: { ...player, recording_status: "paused" },
    clan: null,
    action: "Check recording status",
    to: "/settings/players/20JJJ2CCRU",
    state: "Recording paused",
  },
  {
    name: "only old clan war history",
    player: null,
    clan,
    action: "Go to Players & following",
    to: "/settings/players",
    state: "Add your player",
  },
];

for (const width of [390, 1280]) {
  test(`accepted tag with interrupted Tracking refresh at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let added = false,
      failRefresh = true,
      adds = 0;
    await mockApi(
      page,
      signedIn({
        "GET /api/me": () =>
          added && failRefresh
            ? [503, { error: "unavailable" }]
            : [
                200,
                {
                  ...ME,
                  role: "member",
                  claims: added ? ME.claims : [],
                  recordings: [],
                },
              ],
        "POST /api/claims": () => {
          added = true;
          adds++;
          return [200, { player_tag: player.player_tag }];
        },
        "GET /api/me/first-answer": [200, { player, connection, clan: null }],
        "GET /api/me/clans": [200, { clans: [], home_clan: null }],
      }),
    );
    await page.goto("/settings/players");
    await page
      .getByRole("textbox", { name: "Player tag", exact: true })
      .fill(player.player_tag);
    await page
      .getByRole("button", { name: "Follow", exact: true })
      .first()
      .click();
    await expect(
      page.getByText(
        /Your tag was saved, but Players & following could not refresh/,
      ),
    ).toBeVisible();
    await expect(page.getByText("You are not following that")).toHaveCount(0);
    failRefresh = false;
    await page.reload();
    await page.goto("/settings/players/20JJJ2CCRU");
    await expect(
      page.getByRole("region", { name: "Your recording" }),
    ).toContainText("First read pending");
    expect(adds).toBe(1);
  });
  for (const state of cases) {
    test(`first recorded value: ${state.name} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const calls: { tool: string; args: Record<string, unknown> }[] = [];
      const writes: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        const p = new URL(r.url()).pathname;
        if (
          p.startsWith("/api/") &&
          r.method() !== "GET" &&
          p !== "/api/explore"
        )
          writes.push(`${r.method()} ${p}`);
      });
      await mockApi(
        page,
        signedIn({
          "GET /api/me": [
            200,
            {
              ...ME,
              role: "member",
              claims: state.player ? ME.claims : [],
              recordings: state.player
                ? [
                    {
                      subject_tag: player.player_tag,
                      status: state.player.recording_status,
                    },
                  ]
                : [],
            },
          ],
          "GET /api/me/first-answer": [
            200,
            {
              as_of: "2026-10-07T00:00:00Z",
              player: state.player,
              clan: state.clan,
              connection,
            },
          ],
          "GET /api/me/clans": [200, { clans: [], home_clan: null }],
          "GET /api/player": [200, PLAYER_PAGE],
          "POST /api/explore": (route) => {
            const call = route.request().postDataJSON();
            calls.push(call);
            expect(call.args.live).not.toBe(true);
            if (call.tool === "players_profile")
              return [200, { body: profile }];
            if (call.tool === "players_summary")
              return [200, { body: summary }];
            if (call.tool === "battles_query")
              return [
                200,
                {
                  body: {
                    name: player.name,
                    battles: [battle],
                    total_count: 1,
                    next_cursor: null,
                  },
                },
              ];
            if (call.tool === "war_history") return [200, { body: history }];
            return [404, { error: "unexpected read" }];
          },
        }),
      );
      // With no player there is no record page yet: Home's first step is the
      // answer. Every other state reads on that player's record page.
      if (!state.player) {
        await page.goto("/home");
        await expect(
          page.getByRole("heading", { name: state.state }),
        ).toBeVisible();
        await expect(page.getByLabel("Your player tag")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(0);
        await page.goto("/settings/players#add-player-tag");
        await expect(
          page.getByRole("textbox", { name: "Player tag", exact: true }),
        ).toBeFocused();
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
        return;
      }
      const home = "/settings/players/20JJJ2CCRU";
      await page.goto(home);
      const recording = page.getByRole("region", { name: "Your recording" });
      await expect(recording).toContainText(state.state);
      await expect(
        recording.getByRole("link", { name: "Connect your client ›" }),
      ).not.toBeVisible();
      // On its own record page a bad tag is corrected in place.
      if (state.action === "Fix the tag") {
        await expect(page.getByLabel(/tag/i).first()).toBeVisible();
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
        return;
      }
      const next = recording.getByRole("link", {
        name: `${state.action} ›`,
        exact: true,
      });
      // Nothing links a page to itself: on this page the action is the page.
      if (state.to === home) {
        await expect(next).toHaveCount(0);
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
        return;
      }
      await expect(next).toHaveAttribute("href", state.to);
      if (state.name === "partial capture")
        await expect(recording).toContainText(
          "3 of 6 battles recorded. Other time remains unknown.",
        );
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        axe.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await next.click();
      await expect(page).toHaveURL(
        new RegExp(`${state.to.replace(/[?]/g, "\\?")}$`),
      );
      // The record folded into the player page (2026-11-12): the profile
      // is its Record tab, read only once that tab is open.
      if (state.action === "View recorded profile") {
        await expect(page.getByRole("tab", { name: /Record/ })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(page.locator("main")).toContainText("9,001");
        await expect(page.locator("main")).toContainText("Battles, all time");
      } else if (state.action === "Open the player page") {
        await expect(page.locator("main")).toContainText("Example player");
        expect(calls.some((c) => c.tool === "players_profile")).toBe(false);
      }
      await page.goBack();
      await expect(recording).toContainText(state.state);
      await page.reload();
      await expect(next).toHaveAttribute("href", state.to);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test(`add retry → saved tag → pending → dated profile at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let added = false;
    let captured = false;
    let adds = 0;
    let failRead = false;
    let selectedReads = 0;
    let authed = true;
    let feedbackSends = 0;
    let signouts = 0;
    await mockApi(
      page,
      signedIn({
        "GET /api/me": () => [
          200,
          authed
            ? {
                ...ME,
                role: "member",
                claims: added ? ME.claims : [],
                recordings: added
                  ? [{ subject_tag: player.player_tag, status: "active" }]
                  : [],
                signals: {
                  ...ME.signals,
                  tracking: added ? 1 : 0,
                  connections: 0,
                },
              }
            : SIGNED_OUT,
        ],
        "POST /api/claims": (route) => {
          expect(route.request().postDataJSON()).toEqual({
            player_tag: "20jjj2ccru",
          });
          adds++;
          if (adds === 1)
            return [503, { message: "Adding is temporarily unavailable." }];
          added = true;
          return [
            200,
            { ok: true, player_tag: player.player_tag, recording: "active" },
          ];
        },
        "GET /api/me/first-answer": (route) => {
          if (failRead) return [503, { error: "unavailable" }];
          const selected = new URL(route.request().url()).searchParams.get(
            "player_tag",
          );
          if (selected) {
            expect(selected).toBe(player.player_tag);
            selectedReads++;
          }
          return [
            200,
            {
              player: added ? { ...player, profile_available: captured } : null,
              clan: null,
              connection,
            },
          ];
        },
        "GET /api/me/clans": [200, { clans: [], home_clan: null }],
        "POST /api/feedback": (route) => {
          expect(route.request().postDataJSON()).toMatchObject({
            message: "Fixture: help with my new record",
            category: "general",
          });
          feedbackSends++;
          return feedbackSends === 1
            ? [503, { message: "Feedback interrupted." }]
            : [200, { ok: true, feedback_id: 9 }];
        },
        "POST /api/session/signout": () => {
          signouts++;
          if (signouts === 1)
            return [503, { message: "Sign-out interrupted." }];
          authed = false;
          return [200, { ok: true }];
        },
        "GET /api/player": [200, PLAYER_PAGE],
        "POST /api/explore": (route) => {
          const call = route.request().postDataJSON();
          expect(call.args).toEqual({ player_tag: player.player_tag });
          if (call.tool === "players_summary") return [200, { body: summary }];
          expect(call.tool).toBe("players_profile");
          return [200, { body: profile }];
        },
      }),
    );
    await page.goto("/settings/players");
    await page
      .getByRole("textbox", { name: "Player tag", exact: true })
      .fill("20jjj2ccru");
    await page
      .getByRole("button", { name: "Follow", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("Adding is temporarily unavailable."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Follow", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/settings\/players\/20JJJ2CCRU$/);
    const recording = page.getByRole("region", { name: "Your recording" });
    await expect(recording).toContainText("Player tag saved");
    await expect(recording).toContainText("First read pending");
    await expect(
      page.getByText("Adding is temporarily unavailable."),
    ).toHaveCount(0);
    await expect(
      recording.getByRole("link", { name: "View recorded profile ›" }),
    ).toHaveCount(0);
    captured = true;
    await recording.getByRole("button", { name: "Check again" }).click();
    await expect(
      recording.getByRole("link", { name: "View recorded profile ›" }),
    ).toBeVisible();
    failRead = true;
    await recording.getByRole("button", { name: "Check again" }).click();
    await expect(recording.getByRole("alert")).toContainText(
      "Your recorded data could not be read just now",
    );
    await expect(
      recording.getByRole("link", { name: "View recorded profile ›" }),
    ).toBeVisible();
    failRead = false;
    await recording
      .getByRole("link", { name: "View recorded profile ›" })
      .click();
    await expect(page.getByRole("tab", { name: /Record/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("main")).toContainText("9,001");
    await page.goBack();
    await page.reload();
    await expect(
      recording.getByRole("link", { name: "View recorded profile ›" }),
    ).toBeVisible();
    expect(adds).toBe(2);
    expect(selectedReads).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Help for this page" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "How recording works", exact: true })
      .click();
    await expect(page).toHaveURL(/\/docs\/recording$/);
    await page.goBack();
    await expect(recording).toContainText("Recorded and ready to read");
    await page.goto("/settings/feedback");
    // The page's own compose.
    await page
      .getByRole("main")
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    const message = page.getByRole("textbox", {
      name: "What you want to say",
      exact: true,
    });
    await message.focus();
    await page.keyboard.type("Fixture: help with my new record");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Feedback interrupted.")).toBeVisible();
    await expect(message).toHaveValue("Fixture: help with my new record");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(/^Received, thank you\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "fb_9" })).toHaveAttribute(
      "href",
      "/settings/feedback/9",
    );
    expect(feedbackSends).toBe(2);
    await page.goBack();
    await expect(recording).toContainText("Recorded and ready to read");
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByText(/Not signed out\./)).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    expect(signouts).toBe(2);
  });
}

test("Quickstart starts with browser use and retains client deep links", async ({
  page,
}) => {
  await page.goto("/docs/quickstart");
  await expect(
    page.getByRole("heading", { name: "Get started with Elixir", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("Choose your digest");
  await expect(page.locator("main")).toContainText("Connect a client");
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "Stats", exact: true })
      .first(),
  ).toHaveAttribute("href", "/home/you/stats");
  // The client steps are on their own page.
  await page.goto("/docs/connect-a-client#connect");
  await expect(page.locator("#claude-desktop")).toBeAttached();
  await page.goto("/docs");
  await expect(page.locator("main")).toContainText("follow a few people");
  await expect(page.locator("main")).toContainText("Connecting an AI is");
});
