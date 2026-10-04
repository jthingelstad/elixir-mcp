import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, ME } from "./fixtures.ts";

for (const size of ["wide", "@narrow"])
  test(`withdrawn removal warning and Board triage remain readable without decision controls ${size}`, async ({
    page,
  }) => {
    if (size === "wide")
      await page.setViewportSize({ width: 1100, height: 900 });
    const writes: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() !== "GET" &&
        /actions\/.*\/(?:decide|draft|reopen)/.test(r.url())
      )
        writes.push(r.url());
    });
    const statuses = [
      "protected",
      "not_candidate",
      "evidence_held",
      "eligible",
    ];
    const card = {
      card_id: "synthetic-withdrawn",
      number: 45,
      type: "removal",
      label: "Remove from the clan",
      status: "withdrawn",
      can_act: false,
      can_complete: false,
      can_draft: false,
      can_reopen: false,
      audience: { kind: "leaders" },
      player_tag: "#8QCV",
      player_name: "Invented member",
      raised_at: "2026-10-03T22:00:00Z",
      policy_version: 1,
      removal_safety: {
        status: "held",
        reason: "Profile observations are missing inside the measured window.",
        checked_at: "2026-10-04T08:00:00Z",
        latest_activity_interval: {
          counter_increase: 1,
          observed_from: "2026-10-02T01:00:00Z",
          observed_to: "2026-10-03T02:00:00Z",
          no_battles_captured: true,
        },
      },
      evidence: { rationale: { headline: "Saved historical rationale." } },
      log: [
        {
          entry_id: "original",
          kind: "raised",
          at: "2026-10-03T22:00:00Z",
          by: { system: "elixir-clan" },
          text: "Saved historical rationale.",
        },
        {
          entry_id: "withdrawal",
          kind: "withdrawn",
          at: "2026-10-04T09:20:00Z",
          by: { system: "elixir-clan" },
          text: "Inactivity is not established.",
        },
      ],
    };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/2PQRJ8LV/members/SYNTH0/notes": [200, []],
        "GET /api/clan/clans/2PQRJ8LV/members/SYNTH0/grants": [200, []],
        "GET /api/clan/clans/2PQRJ8LV/actions/45": [
          200,
          { action: card, decline_reasons: [], model: { set: true } },
        ],
        "GET /api/clan/clans/2PQRJ8LV/manage": [
          200,
          {
            evaluated_at: "2026-10-04T08:00:00Z",
            policy_version: 1,
            boundaries: [],
            band: null,
            roster: { size: 4, open_slots: 46 },
            policy: { ranks_elder: true, removal: true },
            board: statuses.map((status, i) => ({
              player_tag: `#SYNTH${i}`,
              name: `Invented ${i}`,
              role: i === 0 ? "elder" : "member",
              bucket: i === 2 ? "held" : i === 3 ? "actionable" : "clear",
              phrase: "Recorded contribution",
              judgment: {
                promotion:
                  i === 0
                    ? "not_applicable"
                    : i === 1
                      ? "unknown"
                      : i === 2
                        ? "held"
                        : "ready",
                demotion: i === 0 ? "held" : "not_applicable",
                removal: status === "eligible" ? "ready" : "held",
              },
              judgment_reasons: [],
              promotion: { state: "none" },
              demotion: { state: "none" },
              removal: {
                state: "none",
                triage: { status, reason: `Explanation ${i}` },
              },
            })),
          },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/actions/45");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("This Action is closed");
    await expect(alert).not.toContainText("may still explicitly decline");
    await expect(alert).toContainText("2026-10-04 03:00 CDT");
    const layout = await alert.evaluate((e) => ({
      direction: getComputedStyle(e).flexDirection,
      children: [...e.children].map((c) => {
        const b = c.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      }),
    }));
    expect(layout.direction).toBe("column");
    for (let i = 1; i < layout.children.length; i++)
      expect(layout.children[i]!.top).toBeGreaterThanOrEqual(
        layout.children[i - 1]!.bottom,
      );
    for (const name of [
      "Decline",
      "Complete",
      "Reopen action",
      "Draft in our voice",
    ])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    await expect(page.getByLabel("Chat message")).toHaveCount(0);
    await expect(page.getByText(/Log · 2 entries/)).toBeVisible();
    await expect(
      page.getByText("2026-10-04 04:20 CDT", { exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-triage-withdrawn-${size}.png`,
      fullPage: true,
    });
    await page.goto("/clan/2PQRJ8LV/manage/board");
    await expect(page.getByLabel("Removal triage")).toContainText(
      "Protected 1 · Not currently a removal candidate 1 · Evidence held 1 · Eligible 1",
    );
    await expect(page.getByLabel("Elder evidence held")).toContainText(
      "Promotion 2 · Demotion 1",
    );
    const groups = page.getByRole("navigation", { name: "Board groups" });
    await groups.getByRole("link", { name: "Clear · 2" }).click();
    await expect(page).toHaveURL(/#board-clear$/);
    await expect(
      page.getByRole("heading", { name: "Clear · 2" }),
    ).toBeInViewport();
    const pageFits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(pageFits).toBe(true);
    const table = page.getByRole("region", { name: "Clear members" });
    if (size === "wide")
      expect(await table.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
    else {
      expect(await table.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(
        true,
      );
      await table.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => table.evaluate((e) => e.scrollLeft))
        .toBeGreaterThan(0);
    }
    for (const label of [
      "Protected",
      "Not currently a removal candidate",
      "Evidence held",
      "Eligible",
    ])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(
      page.getByText("held · activity unknown", { exact: true }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-triage-board-${size}.png`,
      fullPage: true,
    });
    await table.evaluate((e) => {
      e.scrollLeft = 0;
    });
    await page.getByRole("button", { name: "Invented 0", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Invented 0", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    const sheet = page.getByPlaceholder("A leader note (leaders see these)");
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((e) => e.closest("td")?.colSpan)).toBe(6);
    await page.getByRole("button", { name: "Invented 0", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    expect(writes).toEqual([]);
  });

for (const size of ["wide", "@narrow"])
  test(`held removal list and direct Action preserve audit while withholding unsafe words ${size}`, async ({
    page,
  }) => {
    const decisions: unknown[] = [];
    let forbidden = 0;
    let card = {
      card_id: "synthetic-removal",
      number: 45,
      type: "removal",
      label: "Remove from the clan",
      status: "proposed",
      can_act: true,
      can_complete: false,
      can_draft: false,
      can_reopen: false,
      audience: { kind: "leaders" },
      player_tag: "#8QCV",
      player_name: "Invented member",
      raised_at: "2026-10-03T22:00:00Z",
      copy: "Unsafe old removal copy.",
      draft_context_version: "frozen",
      removal_safety: {
        status: "held",
        reason:
          "Time after the latest profile counter observation is unmeasured.",
        checked_at: "2026-10-04T08:00:00Z",
        latest_activity_interval: {
          counter_increase: 1,
          observed_from: "2026-10-02T01:00:00Z",
          observed_to: "2026-10-03T02:00:00Z",
          no_battles_captured: true,
        },
      },
      evidence: {
        rationale: { headline: "8.02 battle-free days." },
        facts: [],
      },
      log: [
        {
          entry_id: "raised",
          kind: "raised",
          at: "2026-10-03T22:00:00Z",
          by: { system: "elixir-clan" },
          text: "8.02 battle-free days.",
        },
      ],
    };
    const view = () =>
      [
        200,
        {
          clan_tag: "#2PQRJ8LV",
          open: card.status === "proposed" ? [card] : [],
          recent: card.status === "proposed" ? [] : [card],
          decline_reasons: ["not_now", "evidence_wrong"],
          model: { set: true },
        },
      ] as [number, unknown];
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/2PQRJ8LV/actions": view,
        "GET /api/clan/clans/2PQRJ8LV/actions/45": () => [
          200,
          {
            action: card,
            decline_reasons: ["not_now", "evidence_wrong"],
            model: { set: true },
          },
        ],
        "POST /api/clan/clans/2PQRJ8LV/actions/synthetic-removal/draft": () => {
          forbidden++;
          return [409, { error: "removal_evidence_held" }];
        },
        "POST /api/clan/clans/2PQRJ8LV/actions/synthetic-removal/reopen":
          () => {
            forbidden++;
            return [409, { error: "removal_evidence_held" }];
          },
        "POST /api/clan/clans/2PQRJ8LV/actions/synthetic-removal/decide": (
          route,
        ) => {
          const body = route.request().postDataJSON();
          decisions.push(body);
          if (body.status !== "declined") forbidden++;
          card = { ...card, status: "declined", can_act: false };
          return [200, card];
        },
      }),
    );
    await page.goto("/clan/2PQRJ8LV/actions");
    await expect(
      page.getByText(/Held: inactivity not established/),
    ).toBeVisible();
    await page.getByRole("link", { name: /#45/ }).click();
    await expect(page.getByRole("alert")).toContainText(
      "counter increased by 1",
    );
    await expect(page.getByRole("alert")).toContainText(
      "No battles from that interval were captured",
    );
    await expect(page.getByLabel("Chat message")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Copy the chat message" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Unsafe old removal copy.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Draft in our voice" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Complete", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText(/Saved rationale at the time/)).toBeVisible();
    await page.goto("/clan/2PQRJ8LV/actions/45");
    await expect(page.getByRole("alert")).toContainText(
      "inactivity is not established",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await page.getByLabel("Why decline").selectOption("evidence_wrong");
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(
      page.getByText("Declined", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reopen action" }),
    ).toHaveCount(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      status: "declined",
      reason: "evidence_wrong",
    });
    expect(forbidden).toBe(0);
  });
