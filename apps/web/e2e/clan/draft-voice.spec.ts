import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

// "Draft in our voice" (2026-10-20): a clan-chat draft is lines, each its
// own send (up to three for a promotion, two for a welcome), and a
// welcome or a farewell takes the leader's note beside the tone. Every
// name and number here is invented.

const accessible = async (page: import("@playwright/test").Page) => {
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
};

for (const size of ["wide", "@narrow"]) {
  test(`a promotion drafts three chat lines, each copied on its own ${size}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const plain =
      "Congrats, new Elder! Sunny Kettle is now an Elder: 40 of 48 war decks, 22 ranked battles. Thank you for showing up for the clan.";
    const action = {
      card_id: "p1",
      number: 49,
      type: "promotion",
      label: "Promote to Elder",
      status: "proposed",
      channel: "clan_chat",
      can_act: true,
      audience: { kind: "leaders" },
      player_tag: "#P8QY",
      player_name: "Sunny Kettle",
      raised_at: "2026-10-18T11:00:00Z",
      draft_context_version: "frozen-context",
      evidence: { phrase: "40 of 48 war decks, 22 ranked battles" },
      log: [],
      delivery: {
        version: 1,
        channel: "clan_chat",
        parts: [{ part: 1, options: { clan_chat: { lines: [plain] } } }],
      },
    };
    const drafted = [
      "Congrats Sunny Kettle, our newest Elder!",
      "40 of 48 war decks in four weeks: you missed almost none.",
      "Six seasons with us and the Iron King award in season 140. Thank you.",
    ];
    const drafts: unknown[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions/49": () => [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            action,
            decline_reasons: [],
            model: { set: true, refused: false },
          },
        ],
        "POST /api/clan/clans/2PQRJ8LV/actions/p1/draft": (route) => {
          drafts.push(route.request().postDataJSON());
          return [
            200,
            {
              lines: drafted,
              model: "fixture",
              warnings: ["line 2: check the number"],
              draft_context_version: "frozen-context",
            },
          ];
        },
      }),
    );
    await page.goto("/clan/2PQRJ8LV/actions/49");
    const single = page.getByRole("textbox", {
      name: "Chat message",
      exact: true,
    });
    await expect(single).toHaveValue(plain);
    // A promotion takes the leader's note, never a chat tone.
    await expect(page.getByLabel("Draft tone")).toHaveCount(0);
    await page
      .getByLabel("What should it say?")
      .fill("Mention the Iron King award");
    await page.getByRole("button", { name: "Draft in our voice" }).click();
    for (const [i, line] of drafted.entries())
      await expect(
        page.getByRole("textbox", {
          name: `Chat message ${i + 1}`,
          exact: true,
        }),
      ).toHaveValue(line);
    await expect(
      page.getByText(/Check: line 2: check the number/),
    ).toBeVisible();
    expect(drafts).toEqual([
      {
        note: "Mention the Iron King award",
        expected_draft_version: "frozen-context",
        channel: "clan_chat",
      },
    ]);
    await page
      .getByRole("button", { name: "Copy the chat message 2", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      drafted[1],
    );
    await accessible(page);
    await page.screenshot({
      path: `/tmp/elixir-draft-lines-${size === "wide" ? "wide" : "narrow"}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Put back what I had" }).click();
    await expect(single).toHaveValue(plain);
    await expect(
      page.getByRole("textbox", { name: "Chat message 2", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("@narrow a welcome takes the leader's note and completes with both lines sent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = {
    card_id: "w2",
    number: 61,
    type: "welcome",
    label: "Welcome a newcomer",
    status: "proposed",
    can_act: true,
    audience: { kind: "elders" },
    player_tag: "#Q2LY",
    player_name: "Maple Fox",
    raised_at: "2026-10-19T12:00:00Z",
    channel: "clan_chat",
    copy: "Welcome to the clan, Maple Fox!",
    evidence: { joined_at: "2026-10-19T11:55:00Z" },
    log: [],
  };
  const drafts: unknown[] = [];
  const decisions: unknown[] = [];
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/clans/2PQRJ8LV/actions/61": () => [
        200,
        {
          clan_tag: "#2PQRJ8LV",
          action,
          decline_reasons: [],
          model: { set: true, refused: false },
        },
      ],
      "POST /api/clan/clans/2PQRJ8LV/actions/w2/draft": (route) => {
        drafts.push(route.request().postDataJSON());
        return [
          200,
          {
            lines: [
              "Welcome to the clan, Maple Fox!",
              "1,200 career wins already; war days are Thursday to Sunday.",
            ],
            model: "fixture",
            warnings: [],
          },
        ];
      },
      "POST /api/clan/clans/2PQRJ8LV/actions/w2/decide": (route) => {
        decisions.push(route.request().postDataJSON());
        return [200, { ...action, status: "done", can_act: false }];
      },
    }),
  );
  await page.goto("/clan/2PQRJ8LV/actions/61");
  await page.getByLabel("Draft tone").selectOption("warm");
  await page
    .getByLabel("What should it say?")
    .fill("Tell them when war days are");
  await page.getByRole("button", { name: "Draft in our voice" }).click();
  await expect(
    page.getByRole("textbox", { name: "Chat message 2", exact: true }),
  ).toHaveValue("1,200 career wins already; war days are Thursday to Sunday.");
  await expect(page.getByText(/Each message is its own send/)).toBeVisible();
  expect(drafts).toEqual([
    { note: "Tell them when war days are", tone: "warm" },
  ]);
  await page
    .getByRole("textbox", { name: "Chat message 2", exact: true })
    .fill("War days are Thursday to Sunday.");
  await accessible(page);
  await page.getByRole("button", { name: "Welcomed", exact: true }).click();
  await expect
    .poll(() => decisions)
    .toEqual([
      {
        status: "done",
        reason: null,
        note: null,
        sent: {
          lines: [
            "Welcome to the clan, Maple Fox!",
            "War days are Thursday to Sunday.",
          ],
        },
      },
    ]);
  expect(errors).toEqual([]);
});
