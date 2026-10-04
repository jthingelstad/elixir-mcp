import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, ME } from "./fixtures.ts";

for (const size of ["wide", "@narrow"])
  for (const entry of ["closed", "history"])
    test(`reopen from ${entry} preserves decline and sent words ${size}`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const sent = {
        part: 1,
        title: "Season 136",
        body: "Original sent words.",
        sent_at: "2026-10-03T12:00:00Z",
        sent_by_name: "Ada",
        shared: true,
      };
      let card = {
        card_id: "declined-update",
        number: 33,
        type: "awards_standings",
        label: "Share award standings",
        status: "declined",
        can_act: false,
        can_reopen: true,
        audience: { kind: "leaders" },
        raised_at: "2026-10-03T10:00:00Z",
        decided_at: "2026-10-03T12:01:00Z",
        decline_reason: "not_now",
        channel: "leader_message",
        messages_sent: [sent],
        evidence: {
          scope: "current",
          season_id: 136,
          as_of: "2026-10-03T11:59:00Z",
          messages: [
            {
              part: 1,
              message: { title: "Season 136", body: "Generated first words." },
            },
            {
              part: 2,
              message: {
                title: "Season 136",
                body: "So far: Points Cup: 1. Ari 9,000.",
              },
            },
          ],
        },
        log: [
          {
            entry_id: "decline",
            kind: "declined",
            at: "2026-10-03T12:01:00Z",
            text: "Waited for context.",
            by: { name: "Ada", role: "leader" },
          },
        ],
      };
      const requests: Record<string, unknown>[] = [];
      let forbiddenWrites = 0;
      await mockApi(
        page,
        signedIn({
          "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
          "GET /api/clan/clans/2PQRJ8LV/manage": [
            200,
            {
              clan_tag: "#2PQRJ8LV",
              policy: {},
              boundaries: [],
              board: [],
              inbox: [],
              band: null,
            },
          ],
          "GET /api/clan/clans/2PQRJ8LV/history": () => [
            200,
            {
              cards: card.status === "declined" ? [card] : [],
              timeline: [],
              holds: [],
            },
          ],
          "GET /api/clan/clans/2PQRJ8LV/actions": () => [
            200,
            {
              clan_tag: "#2PQRJ8LV",
              open: card.status === "proposed" ? [card] : [],
              recent: card.status === "declined" ? [card] : [],
              decline_reasons: [],
            },
          ],
          "GET /api/clan/clans/2PQRJ8LV/actions/33": () => [
            200,
            { clan_tag: "#2PQRJ8LV", action: card, decline_reasons: [] },
          ],
          "POST /api/clan/clans/2PQRJ8LV/actions/declined-update/reopen": (
            route,
          ) => {
            requests.push(route.request().postDataJSON());
            card = {
              ...card,
              status: "proposed",
              can_act: true,
              can_reopen: false,
              log: [
                ...card.log,
                {
                  entry_id: "reopen",
                  kind: "reopened",
                  at: "2026-10-03T12:02:00Z",
                  text: "Reopened for review.",
                  by: { name: "Ada", role: "leader" },
                },
              ],
            };
            return [200, card];
          },
          "POST /api/clan/clans/2PQRJ8LV/actions/declined-update/decide":
            () => {
              forbiddenWrites++;
              return [409, {}];
            },
          "POST /api/clan/clans/2PQRJ8LV/actions/declined-update/messages/2/sent":
            () => {
              forbiddenWrites++;
              return [409, {}];
            },
        }),
      );
      await page.goto(
        entry === "history"
          ? "/clan/2PQRJ8LV/manage/history"
          : "/clan/2PQRJ8LV/actions",
      );
      if (entry === "closed")
        await page
          .getByRole("combobox", { name: "Show" })
          .selectOption("closed");
      const detail = `/clan/2PQRJ8LV/actions/33${entry === "closed" ? "?show=closed" : ""}`;
      await page.locator(`a[href="${detail}"]`).last().click();
      await page
        .getByRole("button", { name: "Reopen action", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Complete update", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText("Waited for context.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Reopened for review.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Original sent words.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Mark message 1 sent" }),
      ).toHaveCount(0);
      const reviewed =
        "So far: Points Cup: 1. Ari 9,000. Donations: 1. Bo 4,300.";
      await page.getByLabel("Message", { exact: true }).fill(reviewed);
      await page
        .getByRole("button", { name: "Copy the message", exact: true })
        .click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        reviewed,
      );
      expect(card.messages_sent).toEqual([sent]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.expected_decided_at).toBe("2026-10-03T12:01:00Z");
      expect(forbiddenWrites).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        axe.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      await page.screenshot({
        path: `/tmp/elixir-reopen-${entry}-${size === "wide" ? "wide" : "narrow"}.png`,
        fullPage: true,
      });
      await page.goBack();
      if (entry === "history")
        await expect(
          page.getByText("No action taken yet.", { exact: true }),
        ).toBeVisible();
      else {
        await expect(page.getByRole("combobox", { name: "Show" })).toHaveValue(
          "closed",
        );
        await expect(
          page.getByText("No closed actions in the last 30 days.", {
            exact: true,
          }),
        ).toBeVisible();
      }
    });
