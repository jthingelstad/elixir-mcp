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
  opponents: [{ player_tag: "#P0Y", name: "Recorded rival" }],
};
const clan = {
  clan_tag: "#2PQRJ8LV",
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
    action: "Go to Tracking",
    to: "/console/account/tracking",
    state: "Add your player",
  },
  {
    name: "accepted tag pending capture",
    player,
    clan: null,
    action: "Check recording status",
    to: "/console/account/tracking/20JJJ2CCRU",
    state: "Capture pending",
  },
  {
    name: "profile without captured battles",
    player: { ...player, profile_available: true },
    clan: null,
    action: "View recorded profile",
    to: "/console/explore/profile/20JJJ2CCRU",
    state: "Captured data available",
  },
  {
    name: "stopped with older retained history",
    player: {
      ...player,
      recording_status: "stopped",
      last_battle_at: battle.battle_time,
    },
    clan: null,
    action: "Browse recorded battles",
    to: "/console/explore/list/battles:20JJJ2CCRU",
    state: "Recording stopped",
  },
  {
    name: "war-only battles",
    player: { ...player, battles_30d: 1, battles_7d: 1 },
    clan: null,
    action: "Browse recorded battles",
    to: "/console/explore/list/battles:20JJJ2CCRU",
    state: "Captured data available",
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
    to: "/console/explore/profile/20JJJ2CCRU",
    state: "Capture attempt failed",
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
    to: "/console/account/tracking/20JJJ2CCRU#fix-tag",
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
    action: "Browse recorded battles",
    to: "/console/explore/list/battles:20JJJ2CCRU",
    state: "Captured data available",
  },
  {
    name: "paused empty record",
    player: { ...player, recording_status: "paused" },
    clan: null,
    action: "Check recording status",
    to: "/console/account/tracking/20JJJ2CCRU",
    state: "Recording paused",
  },
  {
    name: "only old clan war history",
    player: null,
    clan,
    action: "Go to Tracking",
    to: "/console/account/tracking",
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
    await page.goto("/console/account/tracking");
    await page
      .getByRole("textbox", { name: "Player tag", exact: true })
      .fill(player.player_tag);
    await page
      .getByRole("button", { name: "Track", exact: true })
      .first()
      .click();
    await expect(
      page.getByText(/Your tag was saved, but Tracking could not refresh/),
    ).toBeVisible();
    await expect(page.getByText("You are not tracking that")).toHaveCount(0);
    failRefresh = false;
    await page.reload();
    await page.goto("/console/account/tracking/20JJJ2CCRU");
    await expect(
      page.getByRole("region", { name: "Your recording" }),
    ).toContainText("Capture pending");
    expect(adds).toBe(1);
  });
  test(`retained battles retry, paginate, Back and reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let unavailable = true;
    const calls: Record<string, unknown>[] = [];
    const token = "opaque/+cursor=";
    await mockApi(
      page,
      signedIn({
        "POST /api/explore": (route) => {
          const call = route.request().postDataJSON();
          expect(call.tool).toBe("battles_query");
          expect(call.args.live).not.toBe(true);
          expect(call.args.season_id).toBeUndefined();
          expect(call.args.mode).toBeUndefined();
          calls.push(call.args);
          if (unavailable) return [503, { error: "unavailable" }];
          const older = Boolean(call.args.cursor);
          if (older) expect(call.args.cursor).toBe(token);
          return [
            200,
            {
              body: {
                battles: [
                  {
                    ...battle,
                    opponents: [
                      {
                        player_tag: "#P0Y",
                        name: older ? "Earlier rival" : "Recorded rival",
                      },
                    ],
                  },
                ],
                has_more: !older,
                next_cursor: older ? null : token,
              },
            },
          ];
        },
      }),
    );
    await page.goto("/console/explore/list/battles:20JJJ2CCRU");
    await expect(page.getByText("Could not load this record")).toBeVisible();
    unavailable = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("main")).toContainText("Recorded rival");
    await page.getByRole("link", { name: "Older battles ›" }).click();
    await expect(page).toHaveURL(/cursor=opaque%2F%2Bcursor%3D$/);
    await expect(page.locator("main")).toContainText("Earlier rival");
    await page.reload();
    await expect(page.locator("main")).toContainText("Earlier rival");
    await page.getByRole("link", { name: "Newest battles ›" }).click();
    await expect(page.locator("main")).toContainText("Recorded rival");
    await page.goBack();
    await expect(page.locator("main")).toContainText("Earlier rival");
    expect(calls.some((args) => args.cursor === token)).toBe(true);
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
          "POST /api/explore": (route) => {
            const call = route.request().postDataJSON();
            calls.push(call);
            expect(call.args.live).not.toBe(true);
            if (call.tool === "players_profile")
              return [200, { body: profile }];
            if (call.tool === "battles_query")
              return [
                200,
                {
                  body: {
                    name: player.name,
                    battles: [battle],
                    total_count: 1,
                    has_more: false,
                  },
                },
              ];
            if (call.tool === "war_history") return [200, { body: history }];
            return [404, { error: "unexpected read" }];
          },
        }),
      );
      await page.goto("/console/account/overview");
      const recording = page.getByRole("region", { name: "Your recording" });
      await expect(recording).toContainText(state.state);
      await expect(recording.getByText("AI clients (optional)")).toBeVisible();
      await expect(
        recording.getByRole("link", { name: "Connect your client ›" }),
      ).not.toBeVisible();
      const next = recording.getByRole("link", {
        name: `${state.action} ›`,
        exact: true,
      });
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
      if (state.clan) {
        await recording
          .getByRole("link", { name: "View recorded war week ›" })
          .click();
        await expect(
          page.getByRole("heading", { name: "Season 120, week 2" }),
        ).toBeVisible();
        await expect(page.locator("main")).toContainText("3456");
        expect(calls.at(-1)).toEqual({
          tool: "war_history",
          args: { clan_tag: clan.clan_tag, season_id: 120, section_index: 1 },
        });
        await page.goBack();
      }
      await next.click();
      await expect(page).toHaveURL(new RegExp(`${state.to}$`));
      if (state.action === "View recorded profile") {
        await expect(
          page.getByRole("heading", {
            name: "Recorded profile · Example player",
          }),
        ).toBeVisible();
        await expect(page.locator("main")).toContainText("9,001");
        await expect(page.locator("main")).toContainText(
          "Lifetime battle count",
        );
      } else if (state.action === "Browse recorded battles") {
        await expect(page.locator("main")).toContainText("Recorded rival");
        await expect(page.locator("main")).toContainText("River Race");
        expect(calls.at(-1)?.args).toEqual({
          player_tag: player.player_tag,
          verbosity: "compact",
          include_total: true,
        });
      } else if (state.player)
        await expect(
          page.getByRole("region", { name: "Your recording" }),
        ).toContainText(state.state);
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
        "POST /api/explore": (route) => {
          expect(route.request().postDataJSON()).toEqual({
            tool: "players_profile",
            args: { player_tag: player.player_tag.replace(/^#/, "") },
          });
          return [200, { body: profile }];
        },
      }),
    );
    await page.goto("/console/account/tracking");
    await page
      .getByRole("textbox", { name: "Player tag", exact: true })
      .fill("20jjj2ccru");
    await page
      .getByRole("button", { name: "Track", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("Adding is temporarily unavailable."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Track", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/console\/account\/tracking\/20JJJ2CCRU$/);
    const recording = page.getByRole("region", { name: "Your recording" });
    await expect(recording).toContainText("Player tag saved");
    await expect(recording).toContainText("Capture pending");
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
      "Could not check your recorded data",
    );
    await expect(
      recording.getByRole("link", { name: "View recorded profile ›" }),
    ).toBeVisible();
    failRead = false;
    await recording
      .getByRole("link", { name: "View recorded profile ›" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Recorded profile · Example player" }),
    ).toBeVisible();
    await page.goBack();
    await page.reload();
    await expect(
      recording.getByRole("link", { name: "View recorded profile ›" }),
    ).toBeVisible();
    expect(adds).toBe(2);
    expect(selectedReads).toBeGreaterThan(0);
    await page
      .getByRole("link", { name: "How recording works", exact: true })
      .click();
    await expect(page).toHaveURL(/\/docs\/recording$/);
    await page.goBack();
    await expect(recording).toContainText("Captured data available");
    await page.goto("/console/account/feedback");
    await page
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.focus();
    await page.keyboard.type("Fixture: help with my new record");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Feedback interrupted.")).toBeVisible();
    await expect(message).toHaveValue("Fixture: help with my new record");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(/^Received — thank you\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "fb_9" })).toHaveAttribute(
      "href",
      "/console/account/feedback/9",
    );
    expect(feedbackSends).toBe(2);
    await page.goBack();
    await expect(recording).toContainText("Captured data available");
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByText(/Not signed out\./)).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:4321\/$/);
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
  await page.goto("/docs/quickstart#3-connect");
  await expect(
    page.getByRole("heading", { name: "Get started with Elixir", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "without connecting an AI client",
  );
  await expect(page.locator("main")).toContainText(
    "Optional: connect a client",
  );
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "Ladder", exact: true })
      .first(),
  ).toHaveAttribute("href", "/ladder");
  await expect(page.locator('[id="3-connect"]')).toBeAttached();
  await expect(page.locator("#claude-desktop")).toBeAttached();
  await page.goto("/docs");
  await expect(page.locator("main")).toContainText("free account");
  await expect(page.locator("main")).toContainText("AI client is optional");
});
