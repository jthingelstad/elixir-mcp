import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

// How our messages sound, and the drafted entry's words (2026-10-20,
// calls 5 and 6 of the Draft in our voice redesign). One voice, set by
// leaders in Settings, shown (never edited) on Social ▸ Discord; the
// "drafted" log entry carries what the model wrote to leaders, and only
// that a draft was made to anyone else. Which roles get the words is the
// server's (packages/clan/test/manage.test.mjs); this is what each one
// sees. Every name and word here is invented.

const API = "/api/clan/clans/2PQRJ8LV";

const accessible = async (page: Page) => {
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

const asRole = (role: "leader" | "elder") => {
  const first = {
    ...ME.clans[0]!,
    role,
    role_label: role === "leader" ? "Leader" : "Elder",
  };
  return { ...ME, clans: [first], selected: first };
};

const CHANNEL = {
  clan_tag: "#2PQRJ8LV",
  connection: {
    enabled: true,
    webhook: "discord.com/api/webhooks/1…fixture",
    enabled_at: "2026-10-10T12:00:00Z",
    disabled_reason: null,
    categories: {},
    rewrite: true,
    set_by_name: "Ada",
    updated_at: "2026-10-10T12:00:00Z",
    delivery: null,
  },
  policy: { ready: true, defaults: { members: true }, ruled_out: {} },
  categories: [{ key: "members", label: "Members", why: "Who joins." }],
  in_effect: { members: true },
  model: { available: true, set: true, refused: false, name: "Model X" },
  voice: "",
  voice_max: 400,
  editor_runs_per_day: 50,
};

for (const size of ["wide", "@narrow"]) {
  test(`a leader sets the clan's voice in Settings; Discord shows it and links back ${size}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let voice = {
      clan_tag: "#2PQRJ8LV",
      voice: "",
      max: 400,
      set_by_name: null as string | null,
      set_at: null as string | null,
    };
    const writes: unknown[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, asRole("leader")],
        [`GET ${API}/social`]: [200, { enabled: true }],
        [`GET ${API}/sharing`]: [200, { types: {} }],
        [`GET ${API}/discord`]: [200, { set: false }],
        [`GET ${API}/model`]: [
          200,
          { set: false, models: [], uses: { recent: [] }, per_day: 20 },
        ],
        [`GET ${API}/voice`]: () => [200, voice],
        [`PUT ${API}/voice`]: (route) => {
          const body = route.request().postDataJSON();
          writes.push(body);
          voice = {
            ...voice,
            voice: body.voice,
            set_by_name: "Ada",
            set_at: "2026-10-20T12:00:00Z",
          };
          return [200, voice];
        },
        [`GET ${API}/activity-discord`]: () => [
          200,
          { ...CHANNEL, voice: voice.voice },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/manage/settings");
    await expect(
      page.getByText("Not set · Used by drafts and the Discord editor", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Manage How our messages sound",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "How our messages sound",
    });
    const box = dialog.getByLabel("How our messages sound");
    await expect(box).toHaveAttribute("maxlength", "400");
    await expect(
      dialog.getByText(
        /^0\/400\. At most 400 characters, one paragraph, no links or mentions\./,
      ),
    ).toBeVisible();
    await expect(dialog.getByText(/never the facts/)).toBeVisible();
    await accessible(page);
    await box.fill("Warm and short; cheer the wins, keep goodbyes kind.");
    await expect(dialog.getByText(/^51\/400\./)).toBeVisible();
    await dialog.getByRole("button", { name: "Save the voice" }).click();
    await expect(
      dialog.getByText("Last set by Ada · 2026-10-20"),
    ).toBeVisible();
    expect(writes).toEqual([
      { voice: "Warm and short; cheer the wins, keep goodbyes kind." },
    ]);
    await page.screenshot({
      path: `/tmp/elixir-voice-settings-${size.replace("@", "")}.png`,
      fullPage: false,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByText(
        "“Warm and short; cheer the wins, keep goodbyes kind.” · Used by drafts and the Discord editor",
        { exact: true },
      ),
    ).toBeVisible();

    // Social ▸ Discord shows the one voice, as written, and links to it.
    await page.goto("/clan/2PQRJ8LV/discord");
    await page
      .getByRole("button", { name: "Manage Channel voice", exact: true })
      .click();
    const channel = page.getByRole("dialog", { name: "Channel voice" });
    await expect(
      channel.getByText(
        "“Warm and short; cheer the wins, keep goodbyes kind.”",
      ),
    ).toBeVisible();
    await expect(channel.getByRole("textbox")).toHaveCount(0);
    await expect(
      channel.getByRole("button", {
        name: "Preview the last 5 in the clan’s voice",
      }),
    ).toBeVisible();
    await accessible(page);
    await channel
      .getByRole("link", { name: "Settings › How our messages sound" })
      .click();
    await expect(page).toHaveURL(
      /\/clan\/2PQRJ8LV\/manage\/settings#settings-voice$/,
    );
    await expect(
      page.getByRole("dialog", { name: "How our messages sound" }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

const WELCOME = (drafted: Record<string, unknown>) => ({
  card_id: "w1",
  number: 41,
  type: "welcome",
  label: "Welcome",
  status: "proposed",
  channel: "clan_chat",
  can_act: true,
  audience: { kind: "elders" },
  player_tag: "#P8QY",
  player_name: "Sunny Kettle",
  raised_at: "2026-10-20T10:00:00Z",
  draft_context_version: "frozen-context",
  evidence: { facts: [] },
  delivery: {
    version: 1,
    channel: "clan_chat",
    parts: [
      {
        part: 1,
        options: {
          clan_chat: { lines: ["Welcome to the clan, Sunny Kettle!"] },
        },
      },
    ],
  },
  log: [
    {
      entry_id: "e1",
      kind: "raised",
      at: "2026-10-20T10:00:00Z",
      by: { system: "elixir-clan" },
      text: "Sunny Kettle joined.",
    },
    {
      entry_id: "e2",
      kind: "drafted",
      at: "2026-10-20T11:00:00Z",
      by: { tag: "#20QQL8CCRU", name: "Ada", role: "leader" },
      text: "Drafted clan-chat words in the clan's voice (model-x).",
      ...drafted,
    },
  ],
});

for (const size of ["wide", "@narrow"])
  for (const role of ["leader", "elder"] as const)
    test(`the drafted entry: ${role === "leader" ? "a leader reads what the model wrote" : "an elder sees only that a draft was made"} ${size}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // As the server shapes it for each role: the words for leaders and
      // co-leaders, no detail for anyone else.
      const action = WELCOME(
        role === "leader"
          ? {
              detail: {
                draft: {
                  lines: [
                    "Welcome aboard, Sunny Kettle!  Glad you found us.",
                    "Say hi in chat when you can.",
                  ],
                },
              },
            }
          : { detail: null },
      );
      await mockApi(
        page,
        signedIn({
          "GET /api/clan/me": [200, asRole(role)],
          [`GET ${API}/actions/41`]: [
            200,
            { clan_tag: "#2PQRJ8LV", action, decline_reasons: [] },
          ],
        }),
      );
      await page.goto("/clan/2PQRJ8LV/actions/41");
      await expect(
        page.getByRole("heading", { name: /Welcome · Sunny Kettle/ }),
      ).toBeVisible();
      await page
        .locator("summary")
        .filter({ hasText: /^History · 2 entries/ })
        .click();
      await expect(
        page.getByText("Drafted by the clan's model", { exact: true }),
      ).toBeVisible();
      if (role === "leader") {
        await expect(
          page.getByText("What the model wrote", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Welcome aboard, Sunny Kettle!  Glad you found us."),
        ).toBeVisible();
        await expect(
          page.getByText("Say hi in chat when you can.", { exact: true }),
        ).toBeVisible();
      } else {
        await expect(page.getByText("What the model wrote")).toHaveCount(0);
        await expect(page.getByText(/Welcome aboard/)).toHaveCount(0);
      }
      await accessible(page);
      await page.screenshot({
        path: `/tmp/elixir-drafted-entry-${role}-${size.replace("@", "")}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
