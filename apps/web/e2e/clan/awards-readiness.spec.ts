import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, ME } from "./fixtures.ts";

const members = [
  { player_tag: "#20QQL8CCRU", name: "Ada", role: "leader" },
  { player_tag: "#UQ8LP2R9C", name: "Ben", role: "coLeader" },
] as const;
type Grant = {
  season_id: number;
  award_id: string;
  kind: string;
  name: string;
  rank: number;
  player_tag: string;
  player_name: string;
  metric_value: number | null;
  metric_unit: string | null;
  manual: boolean;
  granted_at: string;
  note?: string;
  granted_by_name?: string;
};
const configs = [
  {
    id: "points",
    kind: "season_points_podium",
    name: "Points Cup",
    params: { podium: 3 },
  },
  {
    id: "attendance",
    kind: "perfect_attendance",
    name: "Attendance Cup",
    params: { decks_per_day: 4, allowed_misses: 0 },
  },
  {
    id: "donations",
    kind: "donations_podium",
    name: "Donation Cup",
    params: { podium: 3 },
  },
  {
    id: "rookie",
    kind: "rookie_podium",
    name: "Rookie Cup",
    params: { podium: 3 },
  },
  {
    id: "pick",
    kind: "leaders_pick",
    name: "Clan Pick",
    params: { granted_by: "leaders" },
  },
].map((c) => ({
  ...c,
  enabled: true,
  description: "Review the final podium and previous holder before choosing.",
}));
const makeView = () => {
  const grants: Grant[] = configs.slice(0, 4).map((c) => ({
    season_id: 135,
    award_id: c.id,
    kind: c.kind,
    name: c.name,
    rank: 1,
    player_tag: members[0].player_tag,
    player_name: "Ada",
    metric_value:
      c.id === "attendance" ? 80 : c.id === "donations" ? 1200 : 16000,
    metric_unit:
      c.id === "attendance"
        ? "war_decks"
        : c.id === "donations"
          ? "donations"
          : "points",
    manual: false,
    granted_at: "2026-09-08T10:00:00Z",
  }));
  const awards = configs.map((c) => ({
    award_id: c.id,
    kind: c.kind,
    name: c.name,
    description: c.description,
    rule: "Synthetic fixture rule.",
    computed: c.kind !== "leaders_pick",
    state: c.id === "pick" ? "manual" : "closed",
    rows: [] as Record<string, unknown>[],
  }));
  return {
    clan_tag: "#2PQRJ8LV",
    can_edit: true,
    can_grant: ["pick"],
    evaluated_at: "2026-10-03T12:00:00Z",
    as_of: "2026-10-03T12:00:00Z",
    freshness_seconds: 120,
    members,
    config: { schema: 1, awards: configs },
    config_version: 1,
    versions: [],
    kinds: {},
    grants,
    seasons: [
      {
        season_id: 136,
        closed: false,
        complete: true,
        weeks: 4,
        awards: awards.map((a) => ({
          ...a,
          state: a.computed ? "live" : "manual",
          rows: [] as Record<string, unknown>[],
        })),
      },
      {
        season_id: 135,
        closed: true,
        closed_at: "2026-09-08T10:00:00Z",
        complete: true,
        weeks: 5,
        awards,
      },
    ] as const,
  };
};

for (const size of ["wide", "@narrow"]) {
  test(`all awards receipts and explicit manual confirmation ${size}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const data = makeView();
    const picks: unknown[] = [];
    const responses = signedIn({
      "GET /api/clan/clans/2PQRJ8LV/awards": () => [200, data],
      "POST /api/clan/clans/2PQRJ8LV/awards/grants": (route) => {
        const body = route.request().postDataJSON();
        picks.push(body);
        const grant: Grant = {
          season_id: 135,
          award_id: "pick",
          kind: "leaders_pick",
          name: "Clan Pick",
          rank: 1,
          player_tag: members[1].player_tag,
          player_name: "Ben",
          metric_value: null,
          metric_unit: null,
          manual: true,
          granted_at: "2026-10-03T12:05:00Z",
          note: body.note,
          granted_by_name: "Ada",
        };
        data.grants.push(grant);
        const manual = data.seasons[1].awards.find(
          (a) => a.award_id === "pick",
        );
        if (!manual) throw new Error("Fixture manual award is missing");
        manual.rows.push({ ...grant, name: "Ben" });
        return [200, grant];
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
    await page.goto("/clan/2PQRJ8LV/manage/awards");
    await expect(
      page.getByRole("heading", { name: "Award races", exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Season" }).selectOption("135");
    await expect(page.getByText("80 war decks", { exact: true })).toBeVisible();
    await expect(page.getByText("1,200 cards", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/No recorded Clan Pick grant for season 134/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Grant Clan Pick for season 135" })
      .click();
    await page
      .getByLabel("Member", { exact: true })
      .selectOption(members[1].player_tag);
    await expect(
      page.getByRole("button", { name: "Grant Clan Pick", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Why this member")
      .fill("Reviewed the final podium and award history.");
    await expect(
      page.getByText(/Confirm Clan Pick for season 135 for Ben/),
    ).toBeVisible();
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
      path: `/tmp/elixir-awards-${size === "wide" ? "wide" : "narrow"}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Grant Clan Pick", exact: true })
      .click();
    await expect(
      page
        .getByText("Reviewed the final podium and award history.", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    expect(picks).toEqual([
      {
        award_id: "pick",
        player_tag: members[1].player_tag,
        player_name: "Ben",
        season_id: 135,
        note: "Reviewed the final podium and award history.",
      },
    ]);
    expect(errors).toEqual([]);
  });

  for (const weekly of [false, true]) {
    test(`segmented ${weekly ? "weekly standings" : "awards"} retain complete reviewed copy ${size}`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const action = {
        card_id: "awards1",
        number: 38,
        type: weekly ? "awards_standings" : "awards_announcement",
        label: weekly
          ? "Share this week’s award standings"
          : "Announce season awards",
        status: "proposed",
        can_act: true,
        audience: { kind: "leaders" },
        player_tag: null,
        player_name: null,
        raised_at: "2026-10-03T12:00:00Z",
        channel: "leader_message",
        message: {
          title: weekly ? "S136 W1 1/2" : "S135 awards 1/2",
          body: weekly
            ? "Provisional S136 W1. Points Cup: 1. Ada, 3200 points."
            : "Points Cup: Ada, Ben; Attendance Cup: Ada",
        },
        evidence: {
          season_id: weekly ? 136 : 135,
          section_index: 0,
          part: 1,
          parts: 2,
          awards: [
            { name: "Points Cup", winners: ["Ada", "Ben"] },
            { name: "Attendance Cup", winners: ["Ada"] },
          ],
        },
        log: [],
      };
      const responses = signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions/38": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            action,
            decline_reasons: [],
            model: { set: true, refused: false },
          },
        ],
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
      await page.goto("/clan/2PQRJ8LV/actions/38");
      await expect(
        page.getByText(/Message 1 of 2; send every part/),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Copy the message", exact: true })
        .click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        action.message.body,
      );
      await expect(
        page.getByRole("button", { name: "Sent", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (weekly) {
        await expect(
          page.getByText(/Share provisional standings through that week/),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Draft in our voice", exact: true }),
        ).toHaveCount(0);
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(
          axe.violations.filter((v) =>
            ["serious", "critical"].includes(v.impact ?? ""),
          ),
        ).toEqual([]);
      }
      await page.screenshot({
        path: `/tmp/elixir-${weekly ? "weekly" : "awards"}-message-${size === "wide" ? "wide" : "narrow"}.png`,
        fullPage: true,
      });
    });
  }
}

for (const size of ["wide", "@narrow"]) {
  test(`member Awards selects one season and retains management gates ${size}`, async ({
    page,
  }) => {
    const data = {
      ...makeView(),
      can_edit: false,
      can_grant: [],
      can_send: false,
    };
    const selected = { ...ME.clans[0], role: "member", role_label: "Member" };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected, clans: [selected] }],
        "GET /api/clan/clans/2PQRJ8LV/awards": [200, data],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/awards");
    await expect(page.getByRole("combobox", { name: "Season" })).toHaveValue(
      "136",
    );
    await expect(
      page.getByRole("button", {
        name: /Edit awards|Grant .*season|Send current update/,
      }),
    ).toHaveCount(0);
    await expect(page.getByText("80 war decks", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("combobox", { name: "Season" }).selectOption("135");
    await expect(page.getByText("80 war decks", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Season" })).toHaveValue(
      "135",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`current update retries one Action and records each reviewed message ${size}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const data = { ...makeView(), can_send: true };
    const requests: string[] = [];
    const sent: Record<string, unknown>[] = [];
    const action = {
      card_id: "current1",
      number: 42,
      type: "awards_standings",
      label: "Share current award standings",
      status: "proposed",
      can_act: true,
      audience: { kind: "leaders" },
      raised_at: "2026-10-03T12:00:00Z",
      channel: "leader_message",
      messages_sent: [] as Record<string, unknown>[],
      evidence: {
        scope: "current",
        season_id: 136,
        as_of: "2026-10-03T12:00:00Z",
        messages: [
          {
            part: 1,
            message: {
              title: "S136 now 1/2",
              body: "Provisional S136. Points Cup: Ada, 3200 points.",
            },
          },
          {
            part: 2,
            message: {
              title: "S136 now 2/2",
              body: "Provisional S136. Attendance Cup: 10 on track.",
            },
          },
        ],
      },
      log: [],
    };
    const responses = signedIn({
      "GET /api/clan/clans/2PQRJ8LV/awards": [200, data],
      "POST /api/clan/clans/2PQRJ8LV/awards/update": (route) => {
        requests.push(route.request().postDataJSON().request_id);
        return requests.length === 1
          ? [503, { error: "synthetic lost response" }]
          : [200, { action }];
      },
      "GET /api/clan/clans/2PQRJ8LV/actions/42": () => [
        200,
        { clan_tag: "#2PQRJ8LV", action, decline_reasons: [] },
      ],
      ...(Object.fromEntries(
        [1, 2].map((part) => [
          `POST /api/clan/clans/2PQRJ8LV/actions/current1/messages/${part}/sent`,
          (route) => {
            const words = route.request().postDataJSON();
            sent.push({ part, ...words });
            action.messages_sent.push({
              part,
              ...words,
              sent_by: members[0].player_tag,
              sent_by_name: "Ada",
              sent_at: "2026-10-03T12:05:00Z",
              shared: true,
            });
            return [200, action];
          },
        ]),
      ) as Record<
        string,
        (route: import("@playwright/test").Route) => [number, unknown]
      >),
      "POST /api/clan/clans/2PQRJ8LV/actions/current1/decide": () => {
        action.status = "done";
        action.can_act = false;
        return [200, action];
      },
    });
    await mockApi(page, responses);
    await page.goto("/clan/2PQRJ8LV/awards");
    const prepare = page.getByRole("button", {
      name: "Send season 136 update to clan",
      exact: true,
    });
    await prepare.click();
    await expect(page.getByRole("alert")).toContainText("Retry");
    await prepare.click();
    await page.getByRole("link", { name: /Review Action #42/ }).click();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBeTruthy();
    expect(requests[1]).toBe(requests[0]);
    const complete = page.getByRole("button", {
      name: "Complete update",
      exact: true,
    });
    await expect(complete).toBeDisabled();
    await page
      .getByRole("button", { name: "Copy the message", exact: true })
      .first()
      .click();
    expect(sent).toHaveLength(0);
    const reviewed = "Reviewed provisional standings. Ada, 3200 points.";
    await page.getByLabel("Message", { exact: true }).first().fill(reviewed);
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
      path: `/tmp/elixir-grouped-update-${size === "wide" ? "wide" : "narrow"}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Mark message 1 sent", exact: true })
      .click();
    await expect(page.getByText(reviewed, { exact: true })).toBeVisible();
    await expect(complete).toBeDisabled();
    await page
      .getByRole("button", { name: "Mark message 2 sent", exact: true })
      .click();
    await expect(complete).toBeEnabled();
    expect(sent[0]?.body).toBe(reviewed);
    expect(sent).toHaveLength(2);
    await complete.click();
    await expect(complete).toHaveCount(0);
  });

  test(`Actions defaults to Open and refreshes suggestions explicitly ${size}`, async ({
    page,
  }) => {
    const open = {
      card_id: "open1",
      number: 1,
      type: "welcome",
      label: "Welcome the newcomer",
      status: "proposed",
      player_name: "Example",
      raised_at: "2026-10-03T12:00:00Z",
      log: [],
    };
    const recent = {
      ...open,
      card_id: "closed1",
      number: 2,
      label: "Earlier welcome",
      status: "done",
      decided_at: "2026-10-03T12:01:00Z",
    };
    let refreshes = 0;
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/clans/2PQRJ8LV/actions": (route) => {
          if (
            new URL(route.request().url()).searchParams.get("refresh") === "1"
          )
            refreshes++;
          return [
            200,
            { open: [open], recent: [recent], as_of: "2026-10-03T12:00:00Z" },
          ];
        },
      }),
    );
    await page.goto("/clan/2PQRJ8LV/actions");
    await expect(page.getByRole("combobox", { name: "Show" })).toHaveValue(
      "open",
    );
    await expect(
      page.getByRole("link", { name: /Welcome the newcomer/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Earlier welcome/ }),
    ).toHaveCount(0);
    await page.getByRole("combobox", { name: "Show" }).selectOption("closed");
    await expect(
      page.getByRole("link", { name: /Earlier welcome/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Welcome the newcomer/ }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Refresh suggestions", exact: true })
      .click();
    await expect.poll(() => refreshes).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const size of ["wide", "@narrow"]) {
  test(`award places reflect donation tiebreak and current update names its season ${size}`, async ({
    page,
  }) => {
    const data = makeView();
    Object.assign(data, { can_send: true });
    const points = data.seasons[0].awards.find(
      (award) => award.award_id === "points",
    );
    if (!points) throw new Error("Missing points fixture");
    points.rows = [
      {
        player_tag: "#P1",
        name: "Higher donor",
        points: 8650,
        donations: 1978,
        rank: 4,
        place: 4,
        tied: true,
        place_tied: false,
      },
      {
        player_tag: "#P2",
        name: "Lower donor",
        points: 8650,
        donations: 684,
        rank: 4,
        place: 5,
        tied: true,
        place_tied: false,
      },
      {
        player_tag: "#P3",
        name: "Shared place",
        points: 8000,
        donations: 500,
        rank: 6,
        place: 6,
        tied: true,
        place_tied: true,
      },
    ];
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/") && request.method() !== "GET")
        writes.push(request.method() + " " + new URL(request.url()).pathname);
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(
      page,
      signedIn({ "GET /api/clan/clans/2PQRJ8LV/awards": [200, data] }),
    );
    await page.goto("/clan/2PQRJ8LV/awards");
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/awards$/);
    await expect(
      page.getByRole("heading", { name: "Award races", exact: true }),
    ).toBeVisible();
    for (const [name, place] of [
      ["Higher donor", "4"],
      ["Lower donor", "5"],
      ["Shared place", "6="],
    ] as const) {
      await expect(
        page.getByRole("row").filter({ hasText: name }).locator("td").first(),
      ).toHaveText(place);
    }
    await page.screenshot({
      path: `/tmp/elixir-awards-live-places-${size.replace("@", "")}.png`,
      fullPage: true,
    });
    await page.getByRole("combobox", { name: "Season" }).selectOption("135");
    await expect(
      page.getByRole("button", { name: "Send season 136 update to clan" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This prepares the current season 136 update, while you are viewing season 135.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/elixir-awards-places-${size.replace("@", "")}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(
      writes.filter((write) =>
        /awards\/(update|grants)|actions\/.+\/decide/.test(write),
      ),
    ).toEqual([]);
  });
}
