import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";
import { ME as ACCOUNT } from "../fixtures.ts";
import {
  FIELDS,
  GROUPS,
  TABS,
  memberWeeks,
  policyFromGoals,
  weeklyReport,
} from "@elixir-mcp/clan-engine";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";

/** A saved policy as the editor reads it: a war clan, version 1. */
const POLICY_VIEW = {
  can_edit: true,
  set: true,
  members: 40,
  min_members: 10,
  big_enough: true,
  current: {
    set: true,
    version: 1,
    values: policyFromGoals(["war", "donations"], "standard"),
    saved_at: "2026-09-20T12:00:00Z",
    saved_by: "#20QQL8CCRU",
    saved_by_name: "Ada",
  },
  tabs: TABS,
  groups: GROUPS,
  fields: FIELDS,
  versions: [
    {
      version: 1,
      saved_at: "2026-09-20T12:00:00Z",
      saved_by: "#20QQL8CCRU",
      saved_by_name: "Ada",
      note: null,
    },
  ],
};

/** Nothing serious or critical, on every page a journey lands on. */
async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${name}: accessibility`,
  ).toEqual([]);
}

/** "You here" for Ada, a Leader since Aug 20, from the engine's own read
 *  of a participation answer: five closed races and the one on now. */
function memberView() {
  const part = participation([
    member("#20QQL8CCRU", { name: "Ada", role: "leader" }),
    member("#M1", { name: "Zed" }),
  ]);
  const roster = {
    recent_events: [
      {
        type: "role_changed",
        at: "2026-08-20T00:00:00Z",
        detail: {
          player_tag: "#20QQL8CCRU",
          role_before: "coLeader",
          role_after: "leader",
        },
      },
    ],
  };
  return {
    clan_tag: "#2PQRJ8LV",
    clan_name: "Example Clan",
    as_of: NOW.toISOString(),
    freshness_seconds: 60,
    members: 12,
    min_members: 10,
    policy: { set: true, active: true },
    you: memberWeeks(part, "#20QQL8CCRU", roster, NOW),
    clan: {
      version: 1,
      goals: ["war"],
      counted: ["war", "donations"],
      ranks_elder: true,
      status: null,
      evidence: "100% war decks over 4 war weeks",
      next: [],
      minimums: {
        set: { war: 1 },
        met: { war: true },
        passes: true,
        unknown: false,
        rule: "any",
        window_weeks: 2,
      },
      tenure_min_days: null,
      inactivity: null,
    },
    open_actions: 2,
    hold: null,
    trophies: [
      {
        season_id: 135,
        award_id: "war_champ",
        name: "War Champ",
        rank: 1,
        manual: false,
      },
    ],
  };
}

async function rendered(page: Page) {
  await expect(page.locator("main")).not.toContainText("failed to render");
}

test("a signed-out Clan deep link uses the common sign-in and comes back to its action page", async ({
  page,
}) => {
  let authed = false;
  const answers = signedIn();
  const selected = { ...ME, selected: ME.clans[0] };
  await mockApi(page, {
    ...answers,
    "GET /api/me": () =>
      authed
        ? (answers["GET /api/me"] as [number, unknown])
        : [200, { authenticated: false }],
    "GET /api/clan/me": () => [
      authed ? 200 : 401,
      authed ? selected : { error: "signed_out" },
    ],
    "POST /api/auth": [200, { ok: true }],
    "POST /api/auth/code": () => {
      authed = true;
      return [200, { ok: true }];
    },
  });
  await page.goto("/clan/2PQRJ8LV/actions");
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("elixir.after_sign_in")),
    )
    .toBe("/clan/2PQRJ8LV/actions");
  await page.getByRole("link", { name: "Sign in with Elixir" }).click();
  await expect(page).toHaveURL(/\/console\/signin$/);
  expect(
    await page.evaluate(() => localStorage.getItem("elixir.after_sign_in")),
  ).toBe("/clan/2PQRJ8LV/actions");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
  await expect(
    page.getByRole("heading", { name: "Actions", exact: true }),
  ).toBeVisible();
  await accessible(page, "shared sign-in return");
});

test("a Clan landing uses the common sign-in without a separate OAuth login", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => calls.push(new URL(r.url()).pathname));
  await mockApi(page, {
    "GET /api/clan/me": [401, { error: "signed_out" }],
    "GET /api/me": [200, { authenticated: false }],
  });
  await page.goto("/clan");
  await expect(
    page.getByRole("link", { name: "Sign in with Elixir" }),
  ).toHaveAttribute("href", "/console/signin");
  // A new account comes back to Clan.
  for (const signup of await page
    .getByRole("link", { name: "Create your account" })
    .all())
    await expect(signup).toHaveAttribute(
      "href",
      "/console/signin?signup&return_to=%2Fclan",
    );
  expect(calls.filter((path) => path.startsWith("/api/clan/auth/"))).toEqual(
    [],
  );
  await accessible(page, "shared landing");
});

test("an unverified Leader: the notice first, then the clan as a member with the way to verify", async ({
  page,
}) => {
  const clan = {
    ...ME.clans[0],
    role: "member",
    role_label: "Member",
    verified: false,
    unlock: {
      player_tag: "#20QQL8CCRU",
      name: "Ada",
      role: "leader",
      role_label: "Leader",
    },
  };
  const notice = {
    clans: [
      {
        clan_tag: clan.clan_tag,
        clan_name: clan.name,
        player_tag: "#20QQL8CCRU",
        player_name: "Ada",
        role: "leader",
        role_label: "Leader",
      },
    ],
  };
  let me = {
    ...ME,
    identities: [{ ...ME.identities[0], claim_status: "unverified" }],
    clans: [clan],
    selected: clan,
    verify_notice: { ...notice, acknowledged: false },
  };
  await mockApi(
    page,
    signedIn({
      "GET /api/clan/me": () => [200, me],
      "POST /api/clan/verify-notice": () => {
        me = { ...me, verify_notice: { ...notice, acknowledged: true } };
        return [200, me];
      },
    }),
  );
  await page.goto("/clan/2PQRJ8LV");
  await expect(page).toHaveURL(/\/verify$/);
  await expect(
    page.getByRole("heading", { name: "Verify your player to lead here" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Verify in Elixir/ }),
  ).toBeVisible();
  await accessible(page, "verify notice");

  await page
    .getByRole("button", { name: "I understand, continue as a member" })
    .click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV$/);
  await expect(page.getByText("Ben")).toBeVisible();
  const rail = page.locator(".rail");
  await expect(rail.getByRole("link", { name: /^Board/ })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: /^Map/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Verify in Elixir/ }).first(),
  ).toBeVisible();
  await rendered(page);
  await accessible(page, "unverified clan page");
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, signedIn());
  });

  test("@narrow a welcome draft waits for review before copying and recording delivery", async ({
    page,
  }) => {
    const action = {
      card_id: "w1",
      number: 37,
      type: "welcome",
      label: "Welcome",
      status: "proposed",
      can_act: true,
      audience: { kind: "elders" },
      player_tag: "#M1",
      player_name: "Zed",
      raised_at: "2026-09-12T20:00:00Z",
      copy: "Welcome, Zed!",
      evidence: { joined_at: "2026-09-12T20:00:00Z" },
      log: [],
    };
    const deliveries: unknown[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions/37": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            action,
            model: { set: true },
            decline_reasons: [],
          },
        ],
        "POST /api/clan/clans/2PQRJ8LV/actions/w1/decide": (route) => {
          deliveries.push(route.request().postDataJSON());
          return [200, {}];
        },
      }),
    );
    let finishDraft: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      finishDraft = resolve;
    });
    await page.route(
      "**/api/clan/clans/2PQRJ8LV/actions/w1/draft",
      async (route) => {
        await waiting;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            line: "Glad you joined, Zed!",
            model: "fixture",
          }),
        });
      },
    );
    await page.goto("/clan/2PQRJ8LV/actions/37");
    const editor = page.getByLabel("Chat message", { exact: true });
    const copy = page.getByRole("button", { name: "Copy the chat message" });
    const welcomed = page.getByRole("button", { name: "Welcomed" });
    await page.getByRole("button", { name: "Draft in our voice" }).click();
    await expect(editor).toBeDisabled();
    await expect(copy).toBeDisabled();
    await expect(welcomed).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Skip", exact: true }),
    ).toBeDisabled();
    expect(deliveries).toEqual([]);
    await accessible(page, "pending welcome draft");
    finishDraft();
    await expect(editor).toHaveValue("Glad you joined, Zed!");
    await expect(copy).toBeEnabled();
    await expect(welcomed).toBeEnabled();
    await editor.fill("x".repeat(121));
    await expect(copy).toBeDisabled();
    await expect(
      page.getByText("Shorten to 120 characters before copying."),
    ).toBeVisible();
    await editor.fill("Welcome aboard, Zed! Glad you're here.");
    await expect(copy).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await accessible(page, "reviewed welcome draft");
    await welcomed.click();
    await expect
      .poll(() => deliveries)
      .toEqual([
        {
          status: "done",
          reason: null,
          note: null,
          sent: { line: "Welcome aboard, Zed! Glad you're here." },
        },
      ]);
  });

  test("choose a clan, read its roster, walk the rail, report a standing", async ({
    page,
  }) => {
    // `vite preview` answers the prefix only with its slash; the edge
    // serves /clan too.
    await page.goto("/clan/");
    // Nothing selected: the chooser.
    await expect(page).toHaveURL(/\/clan\/clans$/);
    await expect(
      page.getByRole("heading", { name: "Your clans" }),
    ).toBeVisible();
    const rail = page.locator(".rail");
    // Feedback is the rail's foot, into Elixir's one record; Clan keeps
    // no queue of its own (2026-10-08).
    await expect(
      rail.getByRole("button", { name: "Send feedback" }),
    ).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Feedback/ })).toHaveCount(0);
    await accessible(page, "chooser");

    // Picking one is remembered and lands on its page.
    await page.getByText("Example Clan").first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV$/);
    await expect(page.getByText("Ben")).toBeVisible();
    await expect(page.getByText("Co-leader").first()).toBeVisible();
    // The canvas: the clan's own figures, its comings and goings in the
    // account's zone, and a roster that finds a member.
    await expect(
      page.getByText("Invite only, 5,000 trophies to join.", { exact: false }),
    ).toBeVisible();
    const tiles = page.getByRole("group", { name: "The clan in numbers" });
    await expect(tiles).toContainText("1,220");
    await expect(tiles).toContainText("1st in race 135/4, +100");
    const comings = page.getByRole("region", { name: "Comings and goings" });
    await expect(comings).toContainText("Lu departed");
    await expect(comings).toContainText(
      "Finished 1st in the Colosseum, race 135/4 with 10,305 fame",
    );
    await expect(comings).toContainText("09-05 17:13 CDT");
    await expect(comings).not.toContainText(/kick|\bleft\b/i);
    await page.getByRole("searchbox", { name: "Find a member" }).fill("ze");
    const roster = page.getByRole("region", { name: "Roster" });
    await expect(roster).toContainText("Zed");
    await expect(roster).not.toContainText("Ben");
    await page.getByRole("searchbox", { name: "Find a member" }).fill("");
    // The rail now carries the clan: Manage for a leader, the tag aside.
    await expect(rail.getByRole("link", { name: /^Actions/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Board/ })).toBeVisible();
    await expect(rail).toContainText("#2PQRJ8LV");
    await rendered(page);
    await accessible(page, "clan page");

    // Standing, through the rail.
    await rail.getByRole("link", { name: /^Standing/ }).click();
    await expect(page).toHaveURL(/\/standing$/);
    await expect(page.getByRole("heading", { name: "Standing" })).toBeVisible();
    await expect(page.getByText("How it works here")).toBeVisible();
    // Each group its own panel; war decks per race in words for a reader;
    // a leader is not banded, so their own line carries their role.
    await expect(
      page.getByRole("region", { name: "Holding Elder" }),
    ).toContainText("Cy");
    await expect(
      page.getByRole("img", {
        name: "Zed's war decks: 135/4 12 of 16, 136/0 12 of 12, 136/1 16 of 16",
      }),
    ).toBeVisible();
    const yours = page.getByRole("region", { name: "You" });
    await expect(yours).toContainText("Leader");
    await expect(yours).toContainText("44 of 44");
    await expect(yours).toContainText("Races 135/4 to 136/1.");
    await expect(page.getByText("Read the policy in full ›")).toBeVisible();
    await expect(
      page.getByText(/Leaders and co-leaders are not banded/),
    ).toBeVisible();
    await rendered(page);
    await accessible(page, "standing");

    // Report this: a standing that reads wrong files a judgment item
    // pointing at the clan and the policy, read back in the Console.
    await page.getByRole("button", { name: "Report this" }).click();
    const sheet = page.getByRole("dialog", { name: "Report this" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Category")).toHaveValue("judgment");
    await sheet.getByLabel("Message").fill("Zed played every deck last week.");
    const [sent] = await Promise.all([
      page.waitForRequest(
        (r) =>
          r.method() === "POST" &&
          new URL(r.url()).pathname === "/api/feedback",
      ),
      sheet.getByRole("button", { name: "Send", exact: true }).click(),
    ]);
    const body = sent.postDataJSON();
    expect(body).toMatchObject({
      message: "Zed played every deck last week.",
      category: "judgment",
      area: "clan",
      context: { path: "/clan/2PQRJ8LV/standing" },
    });
    expect(body.refs).toContainEqual({ kind: "clan", ref: "#2PQRJ8LV" });
    await expect(sheet.getByRole("status")).toContainText("Received");
    await expect(
      sheet.getByRole("link", { name: "Read it as fb_41" }),
    ).toHaveAttribute("href", "/console/account/feedback/41");
    await accessible(page, "report this");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("arriving at another of your clans by URL selects it", async ({
    page,
  }) => {
    await page.goto("/clan/GQ08RJPL");
    await expect(page).toHaveURL(/\/clan\/GQ08RJPL$/);
    const rail = page.locator(".rail");
    await expect(rail).toContainText("Second Clan");
    // A member: no Manage group.
    await expect(rail.getByRole("link", { name: /^Board/ })).toHaveCount(0);
  });

  test("a clan with no policy yet: only the roster, Recruit, Scout, the policy editor and clan settings", async ({
    page,
  }) => {
    await mockApi(page, signedIn({}, { policy: { set: false } }));
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    await expect(rail.getByRole("link", { name: /^Policy/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Scout/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Recruit/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Settings/ })).toBeVisible();
    for (const name of [
      /^Actions/,
      /^Board/,
      /^Standing/,
      /^Award history/,
      /^Away/,
    ])
      await expect(rail.getByRole("link", { name })).toHaveCount(0);
  });

  test("a clan below 10 members is a statistics view: the policy editor says so", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn(
        {
          "GET /api/clan/clans/2PQRJ8LV/policy": [
            200,
            {
              can_edit: true,
              set: false,
              members: 6,
              min_members: 10,
              big_enough: false,
              current: {
                set: false,
                values: policyFromGoals([], "standard"),
                version: 0,
              },
              tabs: TABS,
              groups: GROUPS,
              fields: FIELDS,
              versions: [],
            },
          ],
        },
        { policy: { set: false, active: false, members: 6 } },
      ),
    );
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    for (const name of [/^Actions/, /^Board/, /^Standing/, /^Award history/])
      await expect(rail.getByRole("link", { name })).toHaveCount(0);
    await rail.getByRole("link", { name: /^Policy/ }).click();
    await expect(page).toHaveURL(/\/manage\/policy$/);
    await expect(
      page.getByText(/Leaders can prepare and save its policy now/),
    ).toBeVisible();
    await expect(page.getByText(/This clan has 6 members/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save this clan's policy" }),
    ).toBeEnabled();
  });

  test("the policy editor is tabs along the top: one at a time, each switched on or off", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/policy": [200, POLICY_VIEW] }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await page
      .locator(".rail")
      .getByRole("link", { name: /^Policy/ })
      .click();
    const tabs = page.getByRole("tablist", { name: "Policy" });
    await expect(
      tabs.getByRole("tab", { name: /^Clan Wars, on/ }),
    ).toBeVisible();
    await expect(
      tabs.getByRole("tab", { name: /^Ranked play, off/ }),
    ).toBeVisible();
    // About first; nothing from another tab on the page.
    await expect(page.getByLabel(/War rate window/)).toHaveCount(0);
    await tabs.getByRole("tab", { name: /^Clan Wars/ }).click();
    await expect(page.getByLabel(/Minimum war decks/)).toHaveValue("8");
    await tabs.getByRole("tab", { name: /^Ranked play/ }).click();
    await expect(
      page.getByText(/Off: this clan does not use it/),
    ).toBeVisible();
    await page.getByLabel("Count ranked play").check();
    await expect(page.getByLabel(/Minimum ranked battles/)).toHaveValue("5");
    await expect(
      tabs.getByRole("tab", { name: /^Ranked play, on, changed/ }),
    ).toBeVisible();
    await expect(
      page.getByText(/settings? changed: Count ranked play/),
    ).toBeVisible();
    await accessible(page, "policy tabs");
  });

  test("clan settings hold the clan's own model, for leaders", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/model": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            purposes: { recruit_pitch: { label: "Recruiting pitch" } },
            per_day: 20,
            keep_days: 90,
            uses: {
              today: 0,
              month: { count: 0, input_tokens: 0, output_tokens: 0 },
              recent: [],
            },
            set: false,
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/sharing": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            types: {
              departure_classified: {
                label: "Kicks and leaves",
                why: "When a leader answers a departure.",
                sees: "Everyone verified in the clan, and the clan's agent.",
              },
            },
          },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await page
      .locator(".rail")
      .getByRole("link", { name: /^Settings/ })
      .click();
    await expect(page).toHaveURL(/\/manage\/settings$/);
    await expect(
      page.getByRole("heading", { name: "Clan settings" }),
    ).toBeVisible();
    await expect(page.getByText("The clan’s own model")).toBeVisible();
    await expect(
      page.getByText("What Elixir Clan records in Elixir"),
    ).toBeVisible();
    await expect(page.getByText("Kicks and leaves")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByLabel("Add the clan's key")).toHaveAttribute(
      "type",
      "password",
    );
    // The model's old address lands on settings.
    await page.goto("/clan/2PQRJ8LV/manage/model");
    await expect(
      page.getByRole("heading", { name: "Clan settings" }),
    ).toBeVisible();
    await accessible(page, "clan settings");
  });

  test("a clan's key shows about what the month cost, and its monthly cap", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/model": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            purposes: { recruit_pitch: { label: "Recruiting pitch" } },
            per_day: 20,
            keep_days: 90,
            max_spend_cap_usd: 1000,
            prices_as_of: "2026-10-10",
            uses: {
              today: 0,
              month: {
                count: 6,
                input_tokens: 5088,
                output_tokens: 404,
                spend_usd: 0.014216,
                spend_estimated: false,
              },
              recent: [
                {
                  at: "2026-10-09T11:00:00Z",
                  by: "#20QQL8CCRU",
                  by_name: "Ada",
                  purpose: "recruit_pitch",
                  model: "claude-sonnet-5",
                  ok: true,
                  code: null,
                  input_tokens: 700,
                  output_tokens: 180,
                  spend_usd: 0.0032,
                },
              ],
            },
            spend_cap_usd: 5,
            spend_cap_set_by_name: "Ada",
            spend_cap_set_at: "2026-10-10T12:00:00Z",
            cap_reached: false,
            set: true,
            hint: "sk-ant-…mQAA",
            set_by: "#20QQL8CCRU",
            set_by_name: "Ada",
            set_at: "2026-09-25T10:00:00Z",
            model: "claude-sonnet-5",
            models: [
              { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
              { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
              { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
            ],
            model_listed: true,
            models_refreshed_at: "2026-10-10T12:00:00Z",
            models_refresh_error: null,
            refresh_due: false,
            refused_at: null,
            readable: true,
            owner_leads: true,
            usable: true,
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/sharing": [
          200,
          { clan_tag: "#2PQRJ8LV", types: {} },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/manage/settings");
    await expect(
      page.getByText(
        /6 uses · 5,088 tokens in, 404 out · about \$0\.01 of the \$5\.00 cap/,
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Monthly cap")).toHaveValue("5");
    await expect(
      page.getByRole("button", { name: "Remove cap" }),
    ).toBeVisible();
    await expect(page.getByText("From Anthropic, 2026-10-10")).toBeVisible();
    await accessible(page, "clan settings with a key");
  });

  test("actions are a short list; each has its own address, with its log open", async ({
    page,
  }) => {
    const removal = {
      card_id: "a1",
      number: 37,
      type: "removal",
      label: "Remove from the clan",
      status: "proposed",
      can_act: true,
      audience: { kind: "leaders" },
      player_tag: "#8QCV",
      player_name: "Sleepy",
      role_at_raise: "member",
      raised_at: "2026-09-12T20:00:00Z",
      copy: "Sleepy was removed for inactivity.",
      evidence: { rationale: { headline: "20 battle-free days." }, facts: [] },
      log: [
        {
          entry_id: "e1",
          kind: "raised",
          at: "2026-09-12T20:00:00Z",
          by: { system: "elixir-clan" },
          text: "20 battle-free days.",
        },
        {
          entry_id: "e2",
          kind: "comment",
          at: "2026-09-13T08:00:00Z",
          by: { tag: "#UQ8LP2R9C", name: "Ben", role: "coLeader" },
          text: "I messaged them yesterday.",
        },
      ],
    };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            as_of: "2026-09-13T09:00:00Z",
            open: [removal],
            recent: [],
            decline_reasons: ["not_now", "other"],
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/actions/37": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            action: removal,
            decline_reasons: ["not_now", "other"],
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/actions/99": [
          404,
          { error: "no_action" },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    await rail.getByRole("link", { name: /^Actions/ }).click();
    await expect(page).toHaveURL(/\/actions$/);
    const row = page.getByRole("link", { name: /#37.*Remove from the clan/ });
    await expect(row).toContainText("1 comment");
    await expect(
      page.getByRole("region", { name: "Waiting for you" }),
    ).toContainText("Sleepy");
    await expect(page.getByRole("button", { name: "Complete" })).toHaveCount(0);
    await accessible(page, "actions list");
    await row.click();
    await expect(page).toHaveURL(/\/actions\/37$/);
    await expect(
      page.getByRole("heading", { name: "Action #37" }),
    ).toBeVisible();
    await expect(page.getByText("I messaged them yesterday.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete" })).toBeVisible();
    // The action names itself, under the breadcrumb back to the list.
    await expect(
      page.getByRole("heading", { name: "Remove from the clan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Actions›#37");
    await expect(rail.getByRole("link", { name: /^Actions/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await rendered(page);
    await accessible(page, "an action's page");
    // The address works on its own, sent to someone.
    await page.goto("/clan/2PQRJ8LV/actions/37");
    await expect(
      page.getByRole("heading", { name: "Action #37" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "‹ All actions" }).click();
    await expect(page).toHaveURL(/\/actions$/);
    await page.goto("/clan/2PQRJ8LV/actions/99");
    await expect(page.getByText("No action #99 here")).toBeVisible();
  });

  test("the week: what the clan counts, everyone who took part, earlier weeks", async ({
    page,
  }) => {
    const part = participation([
      member("#20QQL8CCRU", { name: "Ada" }),
      member("#UQ8LP2R9C", { name: "Ben", war: [16, 16, 16, 16, 10, 0] }),
      member("#M1", {
        name: "Zed",
        war: [0, 0, 0, 0, 0, 0],
        donations: [0, 0, 0, 0, 0, 0],
      }),
    ]);
    const roster = {
      recent_events: [
        {
          type: "member_left",
          at: "2026-09-02T00:00:00Z",
          detail: { player_tag: "#L", name: "Lu" },
        },
      ],
    };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/week": (route) => {
          const week = new URL(route.request().url()).searchParams.get("week");
          return [
            200,
            {
              clan_tag: "#2PQRJ8LV",
              clan_name: "Example Clan",
              as_of: NOW.toISOString(),
              freshness_seconds: 60,
              policy: { set: true, active: true },
              ...weeklyReport(part, {
                roster,
                policy: EXAMPLE_POLICY,
                now: NOW,
                ...(week ? { week } : {}),
              }),
            },
          ];
        },
      }),
    );
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    await rail.getByRole("link", { name: /^The week/ }).click();
    await expect(page).toHaveURL(/\/week$/);
    await expect(page.getByRole("heading", { name: "The week" })).toBeVisible();
    await expect(page.getByText(/what this clan counts/)).toBeVisible();
    const all = page.getByRole("list", {
      name: "Clan Wars: played every deck asked",
    });
    const partway = page.getByRole("list", { name: "Clan Wars: partway" });
    await expect(all).toContainText("Ada16/16");
    await expect(partway).toContainText("Ben10/16");
    await expect(all).not.toContainText("Zed");
    await expect(partway).not.toContainText("Zed");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("The week");
    await expect(page.getByText("Departed", { exact: true })).toBeVisible();
    await rendered(page);
    await accessible(page, "the week");
    await page.getByRole("link", { name: /← Week of/ }).click();
    await expect(page).toHaveURL(/\/week\/2026-w35$/);
    await expect(rail.getByRole("link", { name: /^The week/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText(/This week so far/)).toHaveCount(0);
    await rendered(page);
  });

  test("you here: your week, your races, what the policy makes of them", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/me": [200, memberView()] }),
    );
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    await rail.getByRole("link", { name: /^You here/ }).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("heading", { name: "You here" })).toBeVisible();
    await expect(page.getByText("since Aug 20")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /2 actions wait for you/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "This week so far" }),
    ).toContainText("Race 136/0, four a war day");
    await expect(
      page.getByRole("img", {
        name: "Your war decks: 135/1 16 of 16, 135/2 16 of 16, 135/3 16 of 16, 135/4 16 of 16, 136/0 8 so far",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("64 of 64 in the finished races."),
    ).toBeVisible();
    await expect(page.getByText("This week, so far")).toBeVisible();
    await expect(page.getByText(/War Champ · 1st/)).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("You here");
    await rendered(page);
    await accessible(page, "you here");
    await page.getByRole("link", { name: "How Elder works here ›" }).click();
    await expect(page).toHaveURL(/\/standing$/);
  });

  test("@narrow the rail is a disclosure above the content", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV");
    const toggle = page.locator(".rail__toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("Clan");
    await expect(
      page.getByRole("navigation", { name: "Sections" }),
    ).toHaveCount(0);
    await toggle.click();
    await page
      .getByRole("navigation", { name: "Sections" })
      .getByRole("link", { name: /^Standing/ })
      .click();
    await expect(page).toHaveURL(/\/standing$/);
    await expect(
      page.getByRole("navigation", { name: "Sections" }),
    ).toHaveCount(0);
    await accessible(page, "narrow standing");
  });
  test("@narrow you here: one column, nothing wider than the phone", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/me": [200, memberView()] }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await page.locator(".rail__toggle").click();
    await page
      .getByRole("navigation", { name: "Sections" })
      .getByRole("link", { name: /^You here/ })
      .click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("heading", { name: "You here" })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^Your war decks: 135\/1/ }),
    ).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide, "no sideways scroll").toBe(false);
    await accessible(page, "narrow you here");
  });
});

test("one application and account survive Console and Clan navigation at phone, tablet and desktop sizes", async ({
  page,
}) => {
  const requests: {
    path: string;
    method: string;
    client: string | undefined;
  }[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      requests.push({
        path: new URL(r.url()).pathname,
        method: r.method(),
        client: r.headers()["x-elixir-client"],
      });
  });
  await mockApi(page, signedIn());
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/console/account/overview");
    await page.evaluate(() => {
      (window as Window & { applicationMarker?: string }).applicationMarker =
        "same-app";
    });
    const clanLink = page
      .locator("header")
      .getByRole("link", { name: "Clan", exact: true });
    if (await clanLink.isVisible()) await clanLink.click();
    else {
      await page
        .getByRole("button", { name: "Product: Console", exact: true })
        .click();
      await page
        .locator("#chrome-sheet")
        .getByRole("link", { name: "Clan", exact: true })
        .click();
    }
    await expect(page).toHaveURL(/\/clan\/(clans|2PQRJ8LV)$/);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { applicationMarker?: string }).applicationMarker,
      ),
    ).toBe("same-app");
    if (page.url().endsWith("/clans"))
      await page.getByText("Example Clan", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV$/);
    await expect(
      page.getByRole("button", { name: "Account: Ada", exact: true }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      "no sideways scroll",
    ).toBe(false);
    await accessible(page, `shared clan ${viewport.width}x${viewport.height}`);
    const consoleLink = page
      .locator("header")
      .getByRole("link", { name: "Console", exact: true });
    if (await consoleLink.isVisible()) await consoleLink.click();
    else {
      await page
        .getByRole("button", { name: "Product: Clan", exact: true })
        .click();
      await page
        .locator("#chrome-sheet")
        .getByRole("link", { name: "Console", exact: true })
        .click();
    }
    await expect(page).toHaveURL(/\/console\/account\/overview$/);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { applicationMarker?: string }).applicationMarker,
      ),
    ).toBe("same-app");
  }
  expect(requests.some((r) => r.path.startsWith("/api/clan/auth/"))).toBe(
    false,
  );
  const selects = requests.filter(
    (r) => r.path === "/api/clan/select" && r.method === "POST",
  );
  expect(selects.length).toBeGreaterThan(0);
  expect(selects.every((r) => r.client === "web")).toBe(true);
});

test("before cutover Clan links leave the Console for the legacy document", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, { ...ACCOUNT, features: { clan_internal: false } }],
    }),
  );
  await page.route("**/clan", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body><h1>Legacy Clan door</h1></body></html>",
    }),
  );
  await page.goto("/console/account/overview");
  await page
    .locator("header")
    .getByRole("link", { name: "Clan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Legacy Clan door" }),
  ).toBeVisible();
});

test("already signed-in return links also use the legacy Clan door before cutover", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, { ...ACCOUNT, features: { clan_internal: false } }],
    }),
  );
  await page.route("**/clan", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body><h1>Legacy Clan return</h1></body></html>",
    }),
  );
  await page.goto("/console/signin?return_to=/clan");
  await expect(
    page.getByRole("heading", { name: "Legacy Clan return" }),
  ).toBeVisible();
});
