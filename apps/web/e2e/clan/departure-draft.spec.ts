import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

for (const width of [390, 1280]) {
  for (const classification of ["member_left", "member_kicked"]) {
    test(`confirmed ${classification} draft stays human reviewed at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      let action = {
        card_id: "d1",
        number: 37,
        type: "departure",
        label: "Departure: kicked, left, or ignore?",
        status: "proposed",
        can_act: true,
        can_draft: false,
        draft_context_version: "unknown",
        audience: { kind: "leaders" },
        player_tag: "#M1",
        player_name: "Zed",
        raised_at: "2026-09-25T12:00:00Z",
        decided_by_name: "Ada",
        decided_at: "2026-09-25T12:00:00Z",
        copy: null as string | null,
        outcome: null as { classification: string; verified_at: string } | null,
        evidence: { left_at: "2026-09-24T12:00:00Z", tenure_days: 38 },
        log: [],
      };
      const drafts: unknown[] = [];
      const decisions: unknown[] = [];
      const line =
        classification === "member_left"
          ? "Thanks for your time with us, Zed. Wishing you well!"
          : "Wishing you well, Zed.";
      await mockApi(
        page,
        signedIn({
          "GET /api/clan/clans/2PQRJ8LV/actions/37": () => [
            200,
            {
              clan_tag: "#2PQRJ8LV",
              action,
              model: { set: true },
              decline_reasons: [],
            },
          ],
          "POST /api/clan/clans/2PQRJ8LV/actions/d1/draft": (route) => {
            drafts.push(route.request().postDataJSON());
            return [
              200,
              {
                line,
                model: "fixture",
                draft_context_version: action.draft_context_version,
              },
            ];
          },
          "POST /api/clan/clans/2PQRJ8LV/actions/d1/decide": (route) => {
            decisions.push(route.request().postDataJSON());
            return [200, {}];
          },
        }),
      );
      await page.goto("/clan/2PQRJ8LV/actions/37");
      await expect(
        page.getByRole("button", { name: "Left", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Draft in our voice" }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("Chat message", { exact: true }),
      ).toHaveCount(0);
      // Reflect an existing confirmed record in fixtures; no decision is sent.
      action = {
        ...action,
        status: "done",
        can_act: false,
        can_draft: true,
        draft_context_version: classification,
        outcome: { classification, verified_at: "2026-09-25T12:00:00Z" },
        copy: "Thanks for your time with us Zed, good luck out there.",
      };
      await page.reload();
      await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions\/37$/);
      await expect(page).toHaveTitle(/Elixir/);
      const editor = page.getByLabel("Chat message", { exact: true });
      await expect(editor).toHaveValue(action.copy!);
      await expect(page.getByText(/confirmed by a leader/)).toBeVisible();
      await page.getByRole("button", { name: "Draft in our voice" }).click();
      await expect(editor).toHaveValue(line);
      expect(drafts).toEqual([
        { note: null, expected_draft_version: classification },
      ]);
      expect(decisions).toEqual([]);
      await expect(
        page.getByRole("button", { name: "Kicked", exact: true }),
      ).toHaveCount(0);
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        axe.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      await page.screenshot({
        path: `/tmp/elixir-frozen-${classification}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Put back what I had" }).click();
      await expect(editor).toHaveValue(action.copy!);
      expect(errors).toEqual([]);
    });
  }
}
