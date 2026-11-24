import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, clanTab } from "./fixtures.ts";

/**
 * Member exceptions (2026-11-23): Run's Exceptions page for a leader
 * (what leaders set, what is automatic, adding one), and the clan-visible
 * ones on the roster for everyone. Invented players only; nothing here
 * writes past the mocked door.
 */
const LEADER_VIEW = {
  leader: true,
  kinds: [],
  lengths: [],
  max_days: 365,
  exceptions: [
    {
      exception_id: "x1",
      player_tag: "#M1",
      player_name: "Zed",
      role: "member",
      kind: "keep_in_clan",
      visibility: "leaders",
      until: "2099-01-20T00:00:00.000Z",
      note: "Exams until January",
      set_by: "#098R2R0PUL",
      set_by_name: "Ada",
      set_at: "2026-09-10T12:00:00.000Z",
    },
  ],
  members: [{ player_tag: "#M1", name: "Zed", role: "member" }],
  automatic: {
    leadership: [
      { player_tag: "#098R2R0PUL", name: "Ada", role: "leader" },
      { player_tag: "#02QQPCYQQ", name: "Ben", role: "coLeader" },
    ],
    elders: { shielded: true, members: [] },
    away: [],
  },
  removal_enabled: true,
  away_max_days: 14,
  band: null,
};

for (const size of ["wide", "@narrow"])
  test(`a leader sees each exception with its end and who can see it, and adds one ${size}`, async ({
    page,
  }) => {
    if (size === "wide")
      await page.setViewportSize({ width: 1100, height: 900 });
    else await page.setViewportSize({ width: 390, height: 860 });
    const writes: { url: string; body: unknown }[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/0QC8RCGY/exceptions": [200, LEADER_VIEW],
        "PUT /api/clan/clans/0QC8RCGY/members/M1/exceptions/not_for_elder": (
          route,
        ) => {
          writes.push({
            url: route.request().url(),
            body: route.request().postDataJSON(),
          });
          return [200, { ok: true }];
        },
      }),
    );
    await page.goto("/clan/0QC8RCGY/run/exceptions");
    await expect(
      page.getByRole("heading", { name: "Exceptions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Members the rules leave alone. You pick who can see each one.",
      ),
    ).toBeVisible();
    const set = page.getByRole("region", { name: "Set by leaders · 1" });
    await expect(set).toContainText("Zed");
    await expect(set).toContainText("Keep in clan");
    await expect(set).toContainText("Exams until January");
    await expect(set).toContainText("leaders only");
    const auto = page.getByRole("region", { name: "Automatic · 2" });
    await expect(auto).toContainText("Leaders are never judged by the rules.");
    await expect(auto).toContainText("Up to 14 days, set in Rules.");

    await set.getByRole("button", { name: "Add" }).click();
    const form = page.getByRole("form", { name: "Add an exception" });
    await form.getByLabel("Who?").selectOption("#M1");
    const kinds = form.getByRole("group", {
      name: "What should the rules skip?",
    });
    // Keep in clan is running on Zed; Keep as Elder is for Elders only.
    await expect(kinds.getByRole("button")).toHaveText([
      "Not for Elder · No promotion",
      "Away · No kick",
    ]);
    await kinds.getByRole("button", { name: /^Not for Elder/ }).click();
    await form.getByLabel(/Why\?/).fill("Second account");
    await form
      .getByRole("group", { name: "How long?" })
      .getByRole("button", { name: "2 weeks" })
      .click();
    await expect(form).toContainText("Every exception ends. You can renew it.");
    await form
      .getByRole("group", { name: "Who can see it?" })
      .getByRole("button", { name: "The whole clan" })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/elixir-exceptions-${size}.png`,
      fullPage: true,
    });
    await form.getByRole("button", { name: "Add exception" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.body).toEqual({
      length: "2w",
      visibility: "clan",
      note: "Second account",
    });
  });

test("the roster shows the exceptions the whole clan can see, and no others", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/clans/0QC8RCGY/exceptions": [
        200,
        {
          leader: false,
          exceptions: [
            {
              exception_id: "x2",
              player_tag: "#M1",
              player_name: "Zed",
              kind: "away",
              visibility: "clan",
              until: "2099-01-20T00:00:00.000Z",
            },
          ],
        },
      ],
    }),
  );
  await page.goto("/clan/0QC8RCGY/feed");
  await clanTab(page, "Members").click();
  const zed = page.getByRole("row").filter({ hasText: "Zed" });
  await expect(zed.getByText("Away", { exact: true })).toBeVisible();
  await expect(page.getByText("Keep in clan", { exact: true })).toHaveCount(0);
});
