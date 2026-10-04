import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, ME } from "./fixtures.ts";

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
