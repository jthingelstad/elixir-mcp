import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi } from "./fixtures.ts";
import { HOME, homeApi, ownerPassport } from "./home-fixture.ts";

const NOW = "2026-11-17T20:00:00.000Z";
const first = {
  ...HOME.first,
  as_of: NOW,
  player: {
    ...HOME.first.player,
    tracked_since: NOW,
    profile_available: true,
    battlelog_observed_at: null,
    last_battle_at: null,
    battles_30d: 0,
    verified: false,
  },
  clan: null,
  setup: { following: 0, following_played: 0 },
};
const PEOPLE = [
  {
    tag: "#00JRG2RU",
    name: "Amber",
    free: true,
    why: [{ kind: "clan", clan_name: "Grove", recorded: true }],
  },
  {
    tag: "#0LJR0G22",
    name: "Birch",
    free: false,
    why: [{ kind: "clan", clan_name: "Grove" }],
  },
  {
    tag: "#02G2PJC0",
    name: "Cedar",
    free: false,
    why: [{ kind: "clan", clan_name: "Grove" }],
  },
];
const progress = {
  player_tag: first.player.player_tag,
  clan: { tag: "#0U082URG", name: "Grove" },
  state: "roster",
  may_request: true,
  poll_ms: 5000,
};
const shots = process.env.ONBOARDING_SHOTS;

for (const width of [320, 390, 1280]) {
  test(`people are ready to follow before your battles, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: new Date(NOW) });
    const sent: string[][] = [];
    let listed = [...PEOPLE];
    let battlesLanded = false;
    const currentFirst = () =>
      battlesLanded
        ? { ...first, player: { ...first.player, battlelog_observed_at: NOW } }
        : first;
    await mockApi(
      page,
      homeApi({
        "GET /api/me": () => [
          200,
          {
            ...ME,
            claims: [
              ...ME.claims,
              ...sent
                .flat()
                .map((player_tag) => ({ player_tag, relationship: "friend" })),
            ],
          },
        ],
        "GET /api/me/home": () => [200, { first: currentFirst() }],
        "GET /api/me/first-answer": () => [200, currentFirst()],
        "GET /api/me/people/onboarding": [
          200,
          {
            ...progress,
            state: "ready",
            may_request: false,
            read_at: NOW,
            poll_ms: null,
          },
        ],
        "GET /api/me/people/starter": () => [
          200,
          {
            ok: true,
            offer: sent.length === 0,
            people: sent.length ? [] : listed,
            used: 1,
            limit: 50,
          },
        ],
        "GET /api/me/passport": [200, ownerPassport([], { complete: true })],
        "POST /api/me/follow-all": (route) => {
          const tags = route.request().postDataJSON().player_tags;
          sent.push(tags);
          listed = listed.filter((person) => !tags.includes(person.tag));
          return [200, { ok: true, followed: tags }];
        },
      }),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/timeline");
    const amber = page.getByRole("checkbox", { name: "Follow Amber" });
    await expect(amber).toBeVisible();
    await expect(
      page.getByText("Your battles are on their way.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Prove it", { exact: true })).toBeHidden();
    if (shots) await page.screenshot({ path: `${shots}/early-${width}.png` });
    const birch = page.getByRole("checkbox", { name: "Follow Birch" });
    await birch.uncheck();
    const follow = page.getByRole("button", { name: "Follow these (2)" });
    await follow.focus();
    await page.keyboard.press("Enter");
    expect(sent).toEqual([]);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Follow these", exact: true })
      .click();
    await expect(page.getByText("Your follows are ready.")).toBeVisible();
    expect(sent).toEqual([[PEOPLE[0]!.tag, PEOPLE[2]!.tag]]);
    await expect(birch).not.toBeChecked();
    await expect(
      page.getByRole("heading", { name: "Your people", exact: true }),
    ).toBeVisible();
    battlesLanded = true;
    await page.clock.fastForward(5000);
    await expect(
      page.getByText("Your battles are ready in the Timeline."),
    ).toBeVisible();
    await expect(birch).not.toBeChecked();
    const open = page.getByRole("button", {
      name: "Open Timeline",
      exact: true,
    });
    await expect(open).toBeVisible();
    await expect(open).toBeFocused();
    const bounds = (await open.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    if (shots)
      await page.screenshot({ path: `${shots}/followed-${width}.png` });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Timeline", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`a collector roster landing fills the waiting suggestions, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: new Date(NOW) });
    let landed = false;
    let queued = 0;
    await mockApi(
      page,
      homeApi({
        "GET /api/me/home": [200, { first }],
        "GET /api/me/first-answer": [200, first],
        "GET /api/me/people/onboarding": () => [
          200,
          landed
            ? {
                ...progress,
                state: "ready",
                may_request: false,
                read_at: NOW,
                poll_ms: null,
              }
            : { ...progress, may_request: queued === 0 },
        ],
        "POST /api/me/people/onboarding": (route) => {
          expect(route.request().postDataJSON()).toEqual({});
          queued += 1;
          return [
            200,
            {
              ...progress,
              may_request: false,
              queued: true,
              reason: "pending",
            },
          ];
        },
        "GET /api/me/people/starter": () => [
          200,
          {
            ok: true,
            offer: true,
            people: landed ? PEOPLE : [],
            used: 1,
            limit: 50,
          },
        ],
      }),
    );
    await page.goto("/timeline");
    await expect(
      page.getByText("Finding your clanmates in Grove."),
    ).toBeVisible();
    await expect.poll(() => queued).toBe(1);
    if (shots) await page.screenshot({ path: `${shots}/waiting-${width}.png` });
    landed = true;
    await page.clock.fastForward(5000);
    await expect(
      page.getByRole("checkbox", { name: "Follow Amber" }),
    ).toBeVisible();
    expect(queued).toBe(1);
    if (shots) await page.screenshot({ path: `${shots}/arrived-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}
