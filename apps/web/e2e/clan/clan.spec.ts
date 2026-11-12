import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, clanTab, mockApi, signedIn } from "./fixtures.ts";
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

test("a signed-out Clan deep link uses the common sign-in and comes back to its page", async ({
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
  await page.goto("/clan/2PQRJ8LV/today");
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("elixir.after_sign_in")),
    )
    .toBe("/clan/2PQRJ8LV/feed");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/signin$/);
  expect(
    await page.evaluate(() => localStorage.getItem("elixir.after_sign_in")),
  ).toBe("/clan/2PQRJ8LV/feed");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
  await expect(clanTab(page, /^Feed/)).toHaveAttribute("aria-selected", "true");
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
    page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }),
  ).toHaveAttribute("href", "/signin");
  // A new account comes back to Clan.
  for (const signup of await page
    .getByRole("link", { name: "Create your account" })
    .all())
    await expect(signup).toHaveAttribute(
      "href",
      "/signin?signup&return_to=%2Fclan",
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
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
  await expect(clanTab(page, "Run")).toHaveCount(0);
  await clanTab(page, "Members").click();
  await expect(page.getByText("Ben")).toBeVisible();
  await expect(page.getByRole("link", { name: "Clan map" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Scout" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Verify Ada" })).toBeVisible();
  await rendered(page);
  await accessible(page, "unverified clan page");

  // Into the Console on this origin, in the app (2026-10-20): the link
  // was production's address, whatever origin the page was on.
  const origin = new URL(page.url()).origin;
  await page.getByRole("link", { name: "Verify Ada" }).click();
  await expect(page).toHaveURL(`${origin}/settings/players/verify`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Verify");
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
    const welcomed = page.getByRole("button", { name: "Done", exact: true });
    await page.getByRole("button", { name: "Draft in our voice" }).click();
    await expect(editor).toBeDisabled();
    await expect(copy).toBeDisabled();
    await expect(welcomed).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Decline", exact: true }),
    ).toBeDisabled();
    expect(deliveries).toEqual([]);
    await accessible(page, "pending welcome draft");
    finishDraft();
    await expect(editor).toHaveValue("Glad you joined, Zed!");
    await expect(copy).toBeEnabled();
    await expect(welcomed).toBeEnabled();
    // A chat line is the game's 200 characters.
    await editor.fill("x".repeat(201));
    await expect(copy).toBeDisabled();
    await expect(
      page.getByText("Shorten to 200 characters before copying."),
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
          sent: { lines: ["Welcome aboard, Zed! Glad you're here."] },
        },
      ]);
  });

  test("choose a clan, read its roster, walk the tabs, report a standing", async ({
    page,
  }) => {
    // `vite preview` answers the prefix only with its slash; the edge
    // serves /clan too.
    await page.goto("/clan/");
    // Nothing selected: the chooser, at Clan's own address.
    await expect(page).toHaveURL(/\/clan\/?$/);
    await expect(
      page.getByRole("heading", { name: "Your clans" }),
    ).toBeVisible();
    await accessible(page, "chooser");

    // Picking one is remembered and lands on its Feed, the race on top
    // and the clan card's chips in the head (G5).
    await page.getByText("Example Clan").first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
    await expect(
      page.getByText("Clan Wars · race open, day 2 of 4"),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "13 of 24 war decks this week" }),
    ).toBeVisible();
    const chips = page.getByRole("list", { name: "This clan" });
    await expect(chips).toContainText("2nd in the river race · 4,820 fame");
    await clanTab(page, "Members").click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members$/);
    await expect(page.getByText("Ben")).toBeVisible();
    await expect(page.getByText("Co-leader").first()).toBeVisible();
    // The clan's own figures, its comings and goings in the account's zone,
    // and a roster that finds a member.
    await expect(
      page.getByText(/invite only · 5,000 trophies to join$/),
    ).toBeVisible();
    const tiles = page.getByRole("group", { name: "The clan in numbers" });
    await expect(tiles).toContainText("1,220");
    const comings = page.getByRole("region", { name: "Comings and goings" });
    await expect(comings).toContainText("Lu departed");
    await expect(comings).toContainText(
      "Finished 1st in the Colosseum, Season 135, week 5, with 10,305 fame",
    );
    await expect(comings).toContainText(/Sat Sep 5( 2026)?, 5:13 pm/);
    await expect(comings).not.toContainText(/kick|\bleft\b/i);
    const find = page.getByRole("searchbox", { name: "Find a member" });
    await find.fill("ze");
    await find.press("Enter");
    const roster = page.getByRole("region", { name: "Members" });
    await expect(roster).toContainText("Zed");
    await expect(roster).not.toContainText("Ben");
    await find.fill("");
    await find.press("Enter");
    // The tabs carry the clan: Run for a leader, and Scout at the roster's
    // foot (elders and up, G6).
    await expect(clanTab(page, "Run")).toBeVisible();
    await expect(page.getByRole("region", { name: "Scout" })).toBeVisible();
    await rendered(page);
    await accessible(page, "clan page");

    // Standing, first on Standings (G6, 2026-11-12).
    await clanTab(page, "Standings").click();
    await expect(page).toHaveURL(/\/standings$/);
    const standing = page.getByRole("region", { name: "Standing" });
    await expect(
      standing.getByRole("heading", { name: "Standing" }),
    ).toBeVisible();
    await expect(
      page.getByText(/^How it works here · Policy v1/),
    ).toBeVisible();
    // Each group its own panel; war decks per race in words for a reader;
    // a leader is not banded, so their own line carries their role.
    await expect(
      page.getByRole("region", { name: "Holding Elder" }),
    ).toContainText("Cy");
    await expect(
      page.getByRole("img", {
        name: "Zed's war decks: Season 135, week 5 12 of 16, Season 136, week 1 12 of 12, Season 136, week 2 16 of 16",
      }),
    ).toBeVisible();
    const yours = page.getByRole("region", { name: "You" });
    await expect(yours).toContainText("Leader");
    await expect(yours).toContainText("44 of 44");
    await page.getByText(/^How it works here · Policy v1/).click();
    await expect(
      page.getByText("Read the policy in full, in Run"),
    ).toBeVisible();
    await expect(
      page.getByText(/Leaders and co-leaders have no group/).first(),
    ).toBeVisible();
    await rendered(page);
    await accessible(page, "standing");

    // Report this: a standing that reads wrong files a judgment item
    // pointing at the clan and the policy, read back in the Console.
    await standing.getByRole("button", { name: "Report this" }).click();
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
      context: { path: "/clan/2PQRJ8LV/standings" },
    });
    expect(body.refs).toContainEqual({ kind: "clan", ref: "#2PQRJ8LV" });
    await expect(sheet.getByRole("status")).toContainText("Received");
    await expect(
      sheet.getByRole("link", { name: "Read it as fb_41" }),
    ).toHaveAttribute("href", "/settings/feedback/41");
    await accessible(page, "report this");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("arriving at another of your clans by URL selects it", async ({
    page,
  }) => {
    await page.goto("/clan/GQ08RJPL");
    await expect(page).toHaveURL(/\/clan\/GQ08RJPL\/feed$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Second Clan",
    );
    // A member: no Run.
    await expect(clanTab(page, "Run")).toHaveCount(0);
  });

  test("a clan with no policy yet keeps its tabs, and Today says what waits on one", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn(
        {
          "GET /api/clan/clans/2PQRJ8LV/actions": [409, { error: "no_policy" }],
        },
        { policy: { set: false } },
      ),
    );
    await page.goto("/clan/2PQRJ8LV");
    for (const name of ["Standings", "War", "Members", "Policy", "Run"])
      await expect(clanTab(page, name)).toBeVisible();
    await expect(clanTab(page, /^Feed/)).toBeVisible();
    await expect(page.locator(".clan-today")).toContainText(/policy/i);
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
    await page.goto("/clan/2PQRJ8LV/manage/policy");
    await expect(page).toHaveURL(/\/run\/about$/);
    await expect(
      page.getByText(/Leaders can prepare and save its policy now/),
    ).toBeVisible();
    await expect(page.getByText(/This clan has 6 members/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save this clan's policy" }),
    ).toBeEnabled();
  });

  test("the policy is separated sections: one at a time, each switched on or off", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/policy": [200, POLICY_VIEW] }),
    );
    await page.goto("/clan/2PQRJ8LV/members");
    await clanTab(page, "Run").click();
    await expect(page).toHaveURL(/\/run$/);
    const list = page.getByRole("navigation", { name: "Run" });
    await expect(list.getByRole("link", { name: /^Clan Wars/ })).toContainText(
      "On",
    );
    await expect(list.getByRole("link", { name: /^Ranked/ })).toContainText(
      "Off",
    );
    // About first; nothing from another section on the page.
    await expect(page.getByLabel(/War rate window/)).toHaveCount(0);
    await list.getByRole("link", { name: /^Clan Wars/ }).click();
    await expect(page).toHaveURL(/\/run\/clan-wars$/);
    await expect(page.getByLabel(/Minimum war decks/)).toHaveValue("8");
    await list.getByRole("link", { name: /^Ranked/ }).click();
    await page.getByLabel("Count ranked play").check();
    await expect(page.getByLabel(/Minimum ranked battles/)).toHaveValue("5");
    await expect(list.getByRole("link", { name: /^Ranked/ })).toContainText(
      "changed",
    );
    await expect(
      page
        .locator(".clan-save")
        .getByText(/settings? changed: Count ranked play/),
    ).toBeVisible();
    await accessible(page, "policy sections");
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
    await page.goto("/clan/2PQRJ8LV/members");
    await clanTab(page, "Run").click();
    const list = page.getByRole("navigation", { name: "Run" });
    await list.getByRole("link", { name: /^Clan settings/ }).click();
    await expect(page).toHaveURL(/\/run\/settings$/);
    await expect(
      page.getByRole("heading", { name: "Clan settings" }),
    ).toBeVisible();
    await expect(page.getByText("Kicks and leaves")).toBeVisible();
    await accessible(page, "clan settings");
    await list.getByRole("link", { name: /^Model & voice/ }).click();
    await expect(page).toHaveURL(/\/run\/model-voice$/);
    await expect(page.getByLabel("Add the clan's key")).toHaveAttribute(
      "type",
      "password",
    );
    // The old Settings anchors land on the section they named, which moved.
    await page.goto("/clan/2PQRJ8LV/manage/settings#settings-voice");
    await expect(page).toHaveURL(/\/run\/model-voice#settings-voice$/);
    await expect(page.locator("#settings-voice")).toBeInViewport();
    // The model's old address lands on the page.
    await page.goto("/clan/2PQRJ8LV/manage/model");
    await expect(page).toHaveURL(/\/run\/model-voice$/);
    await accessible(page, "model and voice");
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
            model_for: {
              recruit_pitch: {
                id: "claude-opus-5-5",
                name: "Claude Opus 5.5",
              },
            },
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
    await page.goto("/clan/2PQRJ8LV/run/model-voice");
    await expect(
      page.getByText(
        /6 uses · 5,088 tokens in, 404 out · about \$0\.01 of the \$5\.00 cap/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("spinbutton", { name: "Monthly cap" }),
    ).toHaveValue("5");
    await expect(
      page.getByRole("button", { name: "Remove cap" }),
    ).toBeVisible();
    await expect(
      page.getByText(/^With Anthropic, Sat Oct 10( 2026)?$/),
    ).toBeVisible();
    await expect(
      page.getByText("Recruiting pitch: Claude Opus 5.5"),
    ).toBeVisible();
    await accessible(page, "model and voice with a key");
  });

  test("the leaders' Discord nudge opens Run's Discord page", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            as_of: "2026-09-13T09:00:00Z",
            open: [],
            recent: [],
            decline_reasons: ["not_now", "other"],
            discord: { set: false },
          },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/today");
    await page.getByRole("link", { name: "Set it up in Run" }).click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/run\/discord$/);
    await expect(
      page.getByRole("region", { name: "Actions in Discord" }),
    ).toBeVisible();
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
    await page.goto("/clan/2PQRJ8LV/members");
    await clanTab(page, /^Feed/).click();
    await expect(page).toHaveURL(/\/feed$/);
    const row = page.getByRole("link", { name: /#37.*Remove from the clan/ });
    await expect(row).toContainText("1 comment");
    await expect(
      page.getByRole("region", { name: "Waiting for you" }),
    ).toContainText("Sleepy");
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
    await accessible(page, "actions list");
    await row.click();
    await expect(page).toHaveURL(/\/actions\/37$/);
    await expect(
      page.getByRole("heading", { name: "Remove from the clan: Sleepy" }),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: /^History, 2 entries/ })
      .click();
    await expect(page.getByText("I messaged them yesterday.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    // An action's page is under Today.
    await expect(clanTab(page, /^Feed/)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await rendered(page);
    await accessible(page, "an action's page");
    // The address works on its own, sent to someone.
    await page.goto("/clan/2PQRJ8LV/actions/37");
    await expect(
      page.getByRole("heading", { name: "Remove from the clan: Sleepy" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "‹ Feed" }).click();
    await expect(page).toHaveURL(/\/feed$/);
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
    await page.goto("/clan/2PQRJ8LV/week");
    await expect(page).toHaveURL(/\/war$/);
    await expect(page.getByText(/what this clan counts/)).toBeVisible();
    await page
      .getByLabel("Period")
      .selectOption({ label: "The week of Aug 31" });
    await expect(page).toHaveURL(/\/war\/2026-w36$/);
    const war = page
      .getByRole("region", { name: "War decks and points" })
      .first();
    await expect(war.getByRole("row", { name: /^Ada 16/ })).toBeVisible();
    await expect(war.getByRole("row", { name: /^Ben 10/ })).toBeVisible();
    await page.getByText("Who came and went · 1").click();
    await expect(page.getByText("Lu departed")).toBeVisible();
    await rendered(page);
    await accessible(page, "the week");
    await page
      .getByLabel("Period")
      .selectOption({ label: "The week of Aug 24" });
    await expect(page).toHaveURL(/\/war\/2026-w35$/);
    await expect(clanTab(page, "War")).toHaveAttribute("aria-selected", "true");
    await rendered(page);
    // A week's old address keeps naming the week.
    await page.goto("/clan/2PQRJ8LV/week/2026-w35");
    await expect(page).toHaveURL(/\/war\/2026-w35$/);
  });

  test("you here: your week, your races, what the policy makes of them", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/me": [200, memberView()] }),
    );
    await page.goto("/clan/2PQRJ8LV/members");
    // A clanmate's name opens the player page (slice 8, #766); your own
    // name opens your record in this clan, which the player page cannot.
    await page
      .getByRole("region", { name: "Members" })
      .getByRole("link", { name: "Ada", exact: true })
      .click();
    await expect(page).toHaveURL(/\/members\/20qql8ccru$/i);
    await expect(page.getByText("only you see this page")).toBeVisible();
    await expect(page.getByText(/Aug 20: Co-leader → Leader/)).toBeVisible();
    await expect(
      page.getByRole("group", { name: "This week so far" }),
    ).toContainText("Season 136, week 1, so far");
    await expect(
      page.getByRole("img", {
        name: "Your war decks: Season 135, week 2 16 of 16, Season 135, week 3 16 of 16, Season 135, week 4 16 of 16, Season 135, week 5 16 of 16, Season 136, week 1 8 so far",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("64 of 64 in the finished races."),
    ).toBeVisible();
    await expect(page.getByText(/War Champ · 1st/)).toBeVisible();
    await rendered(page);
    await accessible(page, "you here");
    // The old address of your record still finds it.
    await page.goto("/clan/2PQRJ8LV/me");
    await expect(page).toHaveURL(/\/members\/20qql8ccru$/i);
  });

  test("@narrow the six tabs fit a phone and the count of what waits rides on Feed", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV/members");
    await expect(clanTab(page, /^Feed/)).toHaveAccessibleName(
      /^Feed 2 waiting for you$/,
    );
    for (const name of ["Standings", "War", "Members", "Policy", "Run"])
      await expect(clanTab(page, name)).toBeAttached();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await clanTab(page, "Standings").click();
    await expect(page).toHaveURL(/\/standings$/);
    await expect(page.getByRole("region", { name: "Standing" })).toBeVisible();
    await accessible(page, "narrow standing");
  });

  test("@narrow Run is a list, then a section with a way back", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/policy": [200, POLICY_VIEW] }),
    );
    await page.goto("/clan/2PQRJ8LV/run");
    const list = page.getByRole("navigation", { name: "Run" });
    await expect(list).toBeVisible();
    await expect(page.locator(".clan-run__section")).toBeHidden();
    await list.getByRole("link", { name: /^Clan Wars/ }).click();
    await expect(list).toBeHidden();
    await expect(page.getByLabel(/Minimum war decks/)).toHaveValue("8");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "‹ Run" }).click();
    await expect(list).toBeVisible();
    await accessible(page, "narrow run");
  });

  test("@narrow your record: one column, nothing wider than the phone", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/me": [200, memberView()] }),
    );
    await page.goto("/clan/2PQRJ8LV/members/me");
    await expect(page).toHaveURL(/\/members\/20qql8ccru$/i);
    await expect(page.getByText("only you see this page")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^Your war decks: Season 135/ }),
    ).toBeVisible();
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(wide, "no sideways scroll").toBe(false);
    await accessible(page, "narrow you here");
  });
});

test("one application and account survive Home and Clan navigation at phone, tablet and desktop sizes", async ({
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
  // From one place to another through the shared shell. At 760px and below
  // the places are the phone's tabs (components.css), so the width says
  // which to use. Never ask whether the bar's link is visible yet: that
  // check does not wait (CI, 2026-10-21). Home's name may carry ", new
  // items" while the feed has news (slice 7).
  const switchTo = async (to: string, width: number) =>
    page
      .locator(width > 760 ? "header" : ".kit-bottom")
      .getByRole("link", { name: new RegExp(`^${to}(, new items)?$`) })
      .click();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/home");
    await page.evaluate(() => {
      (window as Window & { applicationMarker?: string }).applicationMarker =
        "same-app";
    });
    await switchTo("Clan", viewport.width);
    // The chooser, then the clan's landing: Today.
    await expect(page).toHaveURL(/\/clan(\/2PQRJ8LV\/feed|\/)?$/);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { applicationMarker?: string }).applicationMarker,
      ),
    ).toBe("same-app");
    if (!page.url().endsWith("/feed"))
      await page.getByText("Example Clan", { exact: true }).first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/feed$/);
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
    await switchTo("Home", viewport.width);
    await expect(page).toHaveURL(/\/home$/);
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

test("before cutover Clan links leave Home for the legacy document", async ({
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
  await page.goto("/home");
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
  await page.goto("/signin?return_to=/clan");
  await expect(
    page.getByRole("heading", { name: "Legacy Clan return" }),
  ).toBeVisible();
});
