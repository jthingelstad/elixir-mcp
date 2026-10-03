import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

for (const size of ["wide", "@narrow"]) {
  test(`leadership welcome: edit, draft, restore, copy and human completion ${size}`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    let drafts = 0;
    const decisions: unknown[] = [];
    const action = {
      card_id: "welcome1",
      number: 37,
      type: "welcome",
      label: "Welcome a newcomer",
      status: "proposed",
      can_act: true,
      audience: { kind: "elders" },
      player_tag: "#8QCV",
      player_name: "Newcomer",
      raised_at: "2026-10-03T12:00:00Z",
      channel: "clan_chat",
      copy: "Welcome to the clan, Newcomer!",
      message: null,
      evidence: { joined_at: "2026-10-03T11:55:00Z" },
      log: [],
    };
    const responses = signedIn({
      "GET /api/clan/clans/2PQRJ8LV/actions/37": () => [
        200,
        {
          clan_tag: "#2PQRJ8LV",
          action,
          decline_reasons: [],
          model: { set: true, refused: false },
        },
      ],
      "POST /api/clan/clans/2PQRJ8LV/actions/welcome1/draft": (route) => {
        drafts++;
        expect(route.request().postDataJSON()).toEqual({ note: "warm" });
        return [
          200,
          { line: "Glad you joined, Newcomer!", model: "stub", warnings: [] },
        ];
      },
      "POST /api/clan/clans/2PQRJ8LV/actions/welcome1/decide": (route) => {
        decisions.push(route.request().postDataJSON());
        action.status = "done";
        action.can_act = false;
        return [200, action];
      },
    });
    const roster = responses["GET /api/clan/roster"] as [
      number,
      Record<string, unknown>,
    ];
    responses["GET /api/clan/roster"] = [
      200,
      { ...roster[1], member_count: 12 },
    ];
    await mockApi(page, responses);
    await page.goto("/clan/2PQRJ8LV/actions/37");
    await expect(
      page.getByRole("heading", { name: "Welcome a newcomer" }),
    ).toBeVisible();
    const editor = page.getByLabel("Chat message", { exact: true });
    await editor.fill("Welcome aboard, Newcomer!");
    await page.getByLabel("Draft tone").selectOption("warm");
    await page.getByRole("button", { name: "Draft in our voice" }).click();
    await expect(editor).toHaveValue("Glad you joined, Newcomer!");
    expect(drafts).toBe(1);
    expect(decisions).toEqual([]);
    await page.getByRole("button", { name: "Put back what I had" }).click();
    await expect(editor).toHaveValue("Welcome aboard, Newcomer!");
    await page.getByRole("button", { name: "Copy the chat message" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "Welcome aboard, Newcomer!",
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
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/elixir-clan-readiness-${size === "wide" ? "wide" : "narrow"}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Welcomed", exact: true }).click();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    expect(decisions).toEqual([
      {
        status: "done",
        reason: null,
        note: null,
        sent: { line: "Welcome aboard, Newcomer!" },
      },
    ]);
    expect(errors).toEqual([]);
  });
}
