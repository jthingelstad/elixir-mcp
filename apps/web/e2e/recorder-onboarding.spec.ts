import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

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
const cases = [
  {
    name: "browser-only newcomer",
    player: null,
    connection,
    clan: null,
    role: "member",
    action: "Go to Tracking",
    destination: "/console/account/tracking",
    evidence: "Start with your player tag in Tracking.",
    question: null,
  },
  {
    name: "active player waiting for capture",
    player,
    connection,
    clan: null,
    role: "member",
    action: "Check recording status",
    destination: "/console/account/tracking",
    evidence: "Waiting for the first profile or battle capture.",
    question: null,
  },
  {
    name: "browser-only profile",
    player: { ...player, profile_available: true },
    connection,
    clan: null,
    role: "member",
    action: "Open Ladder",
    destination: "/ladder",
    evidence: "0 in the last 30 days · a profile is enough to start",
    question: "Start with your player snapshot",
  },
  {
    name: "stopped recording with older battles and no profile",
    player: {
      ...player,
      recording_status: "stopped",
      last_battle_at: "2026-07-01T00:00:00Z",
    },
    connection: { ...connection, active_connections: 1 },
    clan: null,
    role: "member",
    action: "Open Ladder",
    destination: "/ladder",
    evidence: "older retained battles · none in the last 30 days",
    question: "Review your retained history",
  },
  {
    name: "leader with clan history and a connected client read",
    player: {
      ...player,
      profile_available: true,
      profile_observed_at: new Date().toISOString(),
      battles_30d: 20,
      battles_7d: 4,
    },
    connection: {
      ...connection,
      active_connections: 1,
      successful_data_calls_7d: 1,
      data_read_days_7d: 1,
      last_data_read_at: new Date().toISOString(),
    },
    clan: { clan_tag: "#2PQRJ8LV", name: "Example Clan", war_weeks: 3 },
    role: "leader",
    action: "Open Ladder",
    destination: "/ladder",
    evidence: "20 in the last 30 days · 4 in the last 7",
    question: "Review your recorded battles",
  },
  {
    name: "paused recording without capture",
    player: { ...player, recording_status: "paused" },
    connection,
    clan: null,
    role: "member",
    action: "Check recording status",
    destination: "/console/account/tracking",
    evidence: "recording paused",
    question: null,
  },
];

for (const width of [390, 1280]) {
  for (const state of cases) {
    test(`recorder next step for ${state.name} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const writes: string[] = [];
      page.on("request", (r) => {
        const path = new URL(r.url()).pathname;
        // Ladder's existing read bridge uses POST. Only its saved-data
        // reads qualify here; nickname edits or live requests do not.
        if (path === "/api/explore" && r.method() === "POST") {
          const { tool, args = {} } = r.postDataJSON();
          if (
            ["players_summary", "battles_performance"].includes(tool) &&
            args.player_tag === player.player_tag &&
            args.live !== true
          )
            return;
        }
        if (path.startsWith("/api/") && r.method() !== "GET")
          writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
      });
      await mockApi(
        page,
        signedIn({
          "GET /api/me": [
            200,
            {
              ...ME,
              role: state.role,
              claims: state.player
                ? ME.claims.map((c) => ({ ...c, name: state.player!.name }))
                : [],
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
              player: state.player,
              clan: state.clan,
              connection: state.connection,
            },
          ],
          "GET /api/me/clans": [
            200,
            {
              clans: state.clan ? [{ ...state.clan, scope: "activity" }] : [],
              home_clan: state.clan,
            },
          ],
          // This navigation check also covers a temporarily unavailable
          // destination read. Full Ladder results have their own journeys.
          "POST /api/explore": [503, { error: "temporarily_unavailable" }],
        }),
      );
      // Enter the existing deep URL directly, then follow the actual next
      // step, return with browser Back, and reload the same saved facts.
      await page.goto("/console/account/overview");
      const recording = page.getByRole("region", { name: "Your recording" });
      await expect(recording).toContainText(state.evidence);
      await expect(recording).not.toContainText(/\d of 6/);
      await expect(recording).not.toContainText("snapshot never");
      await expect(recording).toContainText("Clan war history (optional)");
      await expect(recording).toContainText("AI client connection (optional)");
      await expect(page.locator("main")).not.toContainText(
        "Everything is recording",
      );
      const next = recording.getByRole("link", {
        name: `${state.action} ›`,
        exact: true,
      });
      await expect(next).toHaveAttribute("href", state.destination);
      if (state.question) {
        await expect(
          recording.getByRole("heading", {
            name: "Ask an AI client (optional)",
          }),
        ).toBeVisible();
        await expect(
          recording.getByRole("button", {
            name: `Copy question: ${state.question}`,
          }),
        ).toBeVisible();
      } else {
        await expect(
          recording.getByRole("button", { name: /Copy question/ }),
        ).toHaveCount(0);
      }
      if (state.player?.recording_status === "stopped") {
        await expect(
          recording.getByRole("link", { name: /Manage recording/ }),
        ).toHaveAttribute("href", "/console/account/tracking");
        await expect(recording).not.toContainText("Waiting for the first");
        await expect(recording).toContainText(
          "no successful data read in the last 7 days",
        );
      }
      if (state.clan) {
        await expect(recording).toContainText("Example Clan · 3 war weeks");
        await expect(recording).toContainText("successful data read");
      }
      const a11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        a11y.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await next.click();
      await expect(page).toHaveURL(new RegExp(`${state.destination}$`));
      await expect(page.locator("main")).not.toContainText("failed to render");
      await page.goBack();
      await expect(recording).toContainText(state.evidence);
      await page.reload();
      await expect(next).toHaveAttribute("href", state.destination);
      await expect(recording).toContainText(state.evidence);
      expect(writes).toEqual([]);
      if (state.name === "browser-only newcomer" || state.role === "leader") {
        await page.screenshot({
          path: `/tmp/recorder-onboarding-${state.role}-${width}.png`,
          fullPage: true,
        });
      }
    });
  }
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
});
