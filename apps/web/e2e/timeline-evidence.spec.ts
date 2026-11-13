import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";
import { HOME_READS } from "./home-fixture.ts";

for (const width of [390, 1280]) {
  test(`Timeline evidence reads ordered pages and offers a changed-evidence recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const evidence = {
      kind: "session",
      status: "recorded_only",
      version: "ev_fixture",
      observed_at: "2026-10-03T12:40:00Z",
      count: 30,
      completeness: "recorded_sitting",
      capture_completeness: "unknown",
      through: "2026-10-03T12:30:00Z",
      open: true,
    };
    const item = {
      id: "tl_00000000000000000000",
      revision: 30,
      at: "2026-10-03T12:00:00Z",
      subject_tag: "#P0YQ2L8",
      subject_name: "Example Player",
      kind: "battle_session",
      text: "Example Player played 30 recorded games.",
      facts: {},
      evidence,
    };
    const calls: string[] = [];
    let changed = false;
    await mockApi(
      page,
      signedIn({
        ...HOME_READS,
        "GET /api/me/timeline": (route) => {
          const params = new URL(route.request().url()).searchParams;
          if (!params.has("evidence_item_id"))
            return [
              200,
              {
                timeline: [item],
                seen_to: null,
                window: {
                  from: "2026-09-27T12:40:00Z",
                  to: "2026-10-04T12:40:00Z",
                },
              },
            ];
          calls.push(params.toString());
          if (changed) return [409, { error: "evidence_changed" }];
          const offset = Number(params.get("evidence_offset"));
          return [
            200,
            {
              item_id: item.id,
              ...evidence,
              offset,
              next_offset: offset === 0 ? 25 : null,
              battles: [
                {
                  battle_id: String(offset),
                  mode_group: "ladder",
                  outcome: "win",
                  crowns: 2,
                  opponents: [
                    {
                      player_tag: "#QQ2CLUV",
                      name: "Example Rival",
                      crowns: 1,
                      clan_tag: null,
                      clan_name: null,
                    },
                  ],
                  trophy_change: 30,
                  at: "2026-10-03T12:10:00Z",
                  url: "https://elixir.poapkings.com/battle/abcdef000001",
                  relation: "constituent",
                },
              ],
            },
          ];
        },
      }),
    );
    await page.goto("/home");
    await page
      .getByRole("button", { name: "Open session", exact: true })
      .click();
    const panel = page.locator(".kit-tl__evidence");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Whether every game was read is unknown");
    await expect(panel).toContainText("still open");
    await expect(
      panel.getByRole("link", {
        name: "Win 2-1 against Example Rival, Trophy Road",
      }),
    ).toHaveAttribute(
      "href",
      "https://elixir.poapkings.com/battle/abcdef000001",
    );
    await panel.getByRole("button", { name: "Next games" }).click();
    await expect(
      panel.getByRole("button", { name: "Previous games" }),
    ).toBeVisible();
    expect(calls.at(-1)).toContain("evidence_offset=25");
    expect(
      calls.every((x) => x.includes("expected_evidence_version=ev_fixture")),
    ).toBe(true);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((x) =>
        ["serious", "critical"].includes(x.impact ?? ""),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-timeline-evidence-${width}.png`,
      fullPage: true,
    });
    changed = true;
    await page
      .getByRole("button", { name: "Close session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Open session", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Open session", exact: true })
      .click();
    // The query cache can show its old result until refetch; opening the
    // same evidence after a change must eventually surface the conflict.
    await expect(panel.getByRole("link", { name: /Win 2-1/ })).toHaveCount(0);
    await expect(panel.getByRole("alert")).toContainText(
      "unavailable or changed",
    );
    await panel.getByRole("button", { name: "Refresh timeline" }).click();
    await expect(panel).toHaveCount(0);
  });
}

for (const status of ["unknown", "proved"]) {
  test(`an ${status} arena change uses only its own crossing proof`, async ({
    page,
  }) => {
    const evidence = {
      kind: "crossing",
      status,
      version: "ev_crossing",
      observed_at: "2026-10-03T12:40:00Z",
      count: status === "proved" ? 1 : 0,
      completeness: status === "proved" ? "proved_crossing" : "unknown",
    };
    const item = {
      id: "tl_00000000000000000001",
      revision: 1,
      at: "2026-10-03T12:00:00Z",
      text: "Example Player changed arena.",
      subject_name: "Example Player",
      kind: "arena_changed",
      facts: {},
      evidence,
    };
    await mockApi(
      page,
      signedIn({
        ...HOME_READS,
        "GET /api/me/timeline": (route) => {
          if (
            !new URL(route.request().url()).searchParams.has("evidence_item_id")
          )
            return [
              200,
              {
                timeline: [item],
                window: {
                  from: "2026-09-27T12:40:00Z",
                  to: "2026-10-04T12:40:00Z",
                },
                seen_to: null,
              },
            ];
          return [
            200,
            {
              item_id: item.id,
              ...evidence,
              offset: 0,
              next_offset: null,
              battles:
                status === "proved"
                  ? [
                      {
                        battle_id: "abc",
                        at: "2026-10-03T12:00:00Z",
                        mode_group: "ladder",
                        outcome: "win",
                        url: "https://elixir.poapkings.com/battle/abcdef000002",
                      },
                    ]
                  : [],
            },
          ];
        },
      }),
    );
    await page.goto("/home");
    await page
      .getByRole("button", { name: "Open crossing", exact: true })
      .click();
    const panel = page.locator(".kit-tl__evidence");
    await expect(panel).toBeVisible();
    if (status === "unknown") {
      await expect(panel).toContainText("Elixir read the change");
      await expect(panel.getByRole("link")).toHaveCount(0);
    } else {
      await expect(panel).toContainText(
        "This recorded game proves the crossing",
      );
      await expect(panel.getByRole("link")).toContainText("Win, Trophy Road");
    }
    await page
      .getByRole("button", { name: "Close crossing", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Open crossing", exact: true }),
    ).toBeFocused();
  });
}

for (const [summaryCount, evidenceCount] of [
  [15, 10],
  [32, 20],
] as const) {
  test(`milestone evidence explains ${summaryCount}/${evidenceCount} games and closes back to its row`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const evidence = {
      kind: "session",
      status: "recorded_only",
      version: "ev_milestone",
      count: evidenceCount,
      observed_at: "2026-10-03T12:40:00Z",
      completeness: "recorded_sitting",
      capture_completeness: "unknown",
      open: false,
      from: "2026-10-03T12:00:00Z",
      through: "2026-10-03T12:10:00Z",
    };
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: `tl_${String(i).padStart(20, "0")}`,
      at: "2026-10-03T12:00:00Z",
      subject_name: `Example Player ${i}`,
      kind: "session_standout",
      text: `Example Player ${i} played ${summaryCount} games in one sitting (9 wins, 6 losses; ranked, ladder and friendly; five wins in a row). The full recorded sitting ended after the last milestone named in this update.`,
      facts: { battles: summaryCount, ended_at: "2026-10-03T12:15:00Z" },
      evidence,
    }));
    await mockApi(
      page,
      signedIn({
        ...HOME_READS,
        "GET /api/me/timeline": (route) => {
          const params = new URL(route.request().url()).searchParams;
          if (!params.has("evidence_item_id"))
            return [
              200,
              {
                timeline: items,
                window: {
                  from: "2026-09-27T12:00:00Z",
                  to: "2026-10-04T12:00:00Z",
                },
                seen_to: null,
              },
            ];
          return [
            200,
            {
              ...evidence,
              item_id: params.get("evidence_item_id"),
              offset: 0,
              next_offset: null,
              battles: Array.from({ length: evidenceCount }, (_, i) => ({
                battle_id: String(i),
                at: "2026-10-03T12:01:00Z",
                mode_group: "ranked",
                outcome: "win",
                url: `https://elixir.poapkings.com/battle/fixture${i}`,
              })),
            },
          ];
        },
      }),
    );
    await page.goto("/home");
    const row = page.locator(".kit-feed__item", {
      hasText: "Example Player 12",
    });
    await expect(row).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const trigger = row.locator(".kit-feed__links .btn");
    await trigger.click();
    const panel = page.locator(".kit-tl__evidence");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(
      `The summary covers ${summaryCount} games`,
    );
    await expect(panel).toContainText(`${evidenceCount} recorded games from`);
    await expect(panel).toContainText("ends at the latest milestone");
    await expect(panel).toContainText("The summarized sitting was closed");
    await expect(panel.getByRole("link")).toHaveCount(evidenceCount);
    await expect(panel.getByRole("button", { name: "Next games" })).toHaveCount(
      0,
    );
    await panel.getByRole("link").last().scrollIntoViewIfNeeded();
    await trigger.click();
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toBeInViewport();
    await page.screenshot({
      path: `/tmp/elixir-evidence-scope-${summaryCount}-desktop.png`,
      fullPage: false,
    });
  });
}

test("on an agent's Timeline, evidence takes focus and Close returns it to its row", async ({
  page,
}) => {
  const PUBLIC_ID = "abc12345";
  const evidence = {
    kind: "session",
    status: "recorded_only",
    version: "ev_agent",
    observed_at: "2026-10-03T12:40:00Z",
    count: 1,
    completeness: "recorded_sitting",
    capture_completeness: "unknown",
    through: "2026-10-03T12:30:00Z",
    open: false,
  };
  const item = {
    id: "tl_00000000000000000099",
    at: "2026-10-03T12:00:00Z",
    subject_name: "Example Player",
    kind: "battle_session",
    text: "Example Player played a recorded game.",
    facts: {},
    evidence,
  };
  await mockApi(
    page,
    signedIn({
      "GET /api/me/principals": [
        200,
        {
          agents: [
            {
              public_id: PUBLIC_ID,
              name: "clan-bot",
              kind: "agent",
              status: "approved",
              tokens: [],
              clans: [],
            },
          ],
          addable_clans: [],
        },
      ],
      [`GET /api/agent/${PUBLIC_ID}`]: [
        200,
        { authenticated: true, role: "member", claims: [], recordings: [] },
      ],
      [`GET /api/agent/${PUBLIC_ID}/timeline`]: (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (!params.has("evidence_item_id"))
          return [
            200,
            {
              timeline: [item],
              seen_to: null,
              window: {
                from: "2026-09-27T12:40:00Z",
                to: "2026-10-04T12:40:00Z",
              },
            },
          ];
        return [
          200,
          {
            item_id: item.id,
            ...evidence,
            offset: 0,
            next_offset: null,
            battles: [
              {
                battle_id: "abc",
                at: "2026-10-03T12:10:00Z",
                mode_group: "ladder",
                outcome: "win",
                url: "https://elixir.poapkings.com/battle/abcdef000003",
              },
            ],
          },
        ];
      },
    }),
  );
  await page.goto(`/settings/agents/${PUBLIC_ID}/timeline`);
  const trigger = page.getByRole("button", { name: "View games", exact: true });
  await trigger.click();
  const panel = page.getByRole("region", { name: "Timeline evidence" });
  await expect(panel).toBeFocused();
  await expect(panel.getByRole("link")).toContainText("Win, Trophy Road");
  await panel.getByRole("button", { name: "Close evidence" }).click();
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
