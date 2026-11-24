import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";
import { signedIn as clanIn } from "./clan/fixtures.ts";

/** Real story ids and member locators, including small moments that fold.
 * TIMELINE_SOCIAL_SHOTS saves review captures outside the checkout. */
const shots = process.env.TIMELINE_SOCIAL_SHOTS;
const NOW = "2026-11-18T16:00:00.000Z";
const JUNIPER = { kind: "player", tag: "#0QPPRRC9", name: "Juniper" };
const ROWAN = { kind: "player", tag: "#0YCLUPC9", name: "Rowan" };
const ids = [
  "tl_00000000000000000001",
  "tl_00000000000000000002",
  "tl_00000000000000000003",
] as const;
const at = (hour: number) => `2026-11-18T${hour}:00:00.000Z`;
const baseItems = [
  {
    id: ids[0],
    kind: "badge_earned",
    at: at(15),
    subject_tag: JUNIPER.tag,
    subjects: [JUNIPER],
    text: "Juniper reached Mastery level 5 with Knight.",
    facts: { player_tag: JUNIPER.tag, badge: "MasteryKnight", level: 5 },
    moment_card: { id: 26000000, name: "Knight" },
  },
  {
    id: ids[1],
    kind: "badge_earned",
    at: at(14),
    subject_tag: ROWAN.tag,
    subjects: [ROWAN],
    text: "Rowan reached Mastery level 5 with Archers.",
    facts: { player_tag: ROWAN.tag, badge: "MasteryArchers", level: 5 },
    moment_card: { id: 26000001, name: "Archers" },
  },
  {
    id: ids[2],
    kind: "quiet_crossed",
    at: at(13),
    subject_tag: JUNIPER.tag,
    subjects: [JUNIPER],
    text: "Juniper passed 5 days without a recorded battle.",
    facts: {
      player_tag: JUNIPER.tag,
      rung: 5,
      days_quiet: 5,
      days_since_poll: 1,
    },
  },
].map((it) => ({
  ...it,
  subject_name: it.subjects[0]!.name,
  revision: 1,
  section: it.kind === "quiet_crossed" ? "presence" : "progress",
  visibility: "public",
  publishable: true,
  groups: ["friends"],
  observed_at: it.at,
  sort_at: it.at,
  item_ref: {
    source: "game",
    item_id: it.id,
    kind: it.kind,
    at: it.at,
    subject: { kind: "player", tag: it.subject_tag },
  },
}));
const ref = (id: string) => baseItems.find((it) => it.id === id)!.item_ref;

async function target(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function noSideways(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function capture(page: Page, name: string, width: number) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({
    path: path.join(shots, `${name}-${width}.png`),
    fullPage: true,
  });
}

async function arrange(page: Page, surface: "timeline" | "clan") {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const sent: Record<string, unknown>[] = [];
  const reads: { item: string | null; item_ref: unknown }[] = [];
  const replies = new Map<string, Record<string, unknown>[]>();
  replies.set(ids[2], [
    {
      id: "200",
      item_id: ids[2],
      text: "Hope we can play together soon.",
      at: at(13),
      mine: false,
      can_delete: false,
      can_report: true,
      can_block: false,
      author: {
        account_id: "pp_invented_rowan",
        player_tag: ROWAN.tag,
        name: ROWAN.name,
        verified: true,
      },
    },
  ]);
  const cheers = new Map<string, string | null>();
  const current = () =>
    baseItems.map((it) => ({
      ...it,
      cheers: cheers.get(it.id) ? { [cheers.get(it.id)!]: 1 } : {},
      my_cheer: cheers.get(it.id) ?? null,
      comments: {
        count: replies.get(it.id)?.length ?? 0,
        latest: replies.get(it.id) ?? [],
        open: true,
      },
    }));
  const routes = {
    ...clanIn(),
    ...homeApi({
      "GET /api/me": [
        200,
        { ...ME, features: { comments: true, posts: true } },
      ],
      "GET /api/me/home/feed": () => [
        200,
        {
          ...TIMELINE,
          timeline: current(),
          timeline_more: 0,
          total: baseItems.length,
          next: null,
        },
      ],
      "GET /api/clan/clans/0QC8RCGY/feed": () => [
        200,
        {
          clan_tag: "#0QC8RCGY",
          view: "all",
          window_days: 7,
          items: current(),
          more: 0,
        },
      ],
      "GET /api/clan/clans/0QC8RCGY/actions": [
        200,
        {
          clan_tag: "#0QC8RCGY",
          as_of: NOW,
          open: [],
          recent: [],
          decline_reasons: [],
          discord: { set: true },
        },
      ],
      "GET /api/clan/clans/0QC8RCGY/week": [
        200,
        {
          clan_tag: "#0QC8RCGY",
          clan_name: "Example Clan",
          as_of: NOW,
          so_far: {
            from: "2026-11-16T10:00:00.000Z",
            areas: [
              { key: "war", total: 13, took_part: 3, points: 2460 },
              { key: "donations", total: 42, took_part: 2 },
              { key: "battles", total: 24, took_part: 3 },
            ],
          },
        },
      ],
      "GET /api/clan/clans/0QC8RCGY/me": [
        200,
        {
          clan_tag: "#0QC8RCGY",
          clan_name: "Example Clan",
          as_of: NOW,
          members: 12,
          min_members: 10,
          policy: { set: true, active: true },
          you: {
            player_tag: "#098R2R0PUL",
            name: "Ada",
            role: "leader",
            trophies: 8927,
            this_week: { ranked_battles: 4, donations: 16, battles: 12 },
          },
          clan: { status: null, minimums: { set: {} }, inactivity: null },
          exceptions: [],
        },
      ],
      "PUT /api/me/cheers": (route) => {
        const body = route.request().postDataJSON();
        sent.push(body);
        cheers.set(body.item_id, body.cheer);
        return [
          200,
          {
            item_id: body.item_id,
            cheers: body.cheer ? { [body.cheer]: 1 } : {},
            my_cheer: body.cheer,
          },
        ];
      },
      "GET /api/me/comments": (route) => {
        const query = new URL(route.request().url()).searchParams;
        const id = query.get("item")!;
        reads.push({
          item: id,
          item_ref: JSON.parse(query.get("item_ref") ?? "null"),
        });
        return [
          200,
          {
            item_id: id,
            comments: replies.get(id) ?? [],
            count: replies.get(id)?.length ?? 0,
            open: true,
            next_before: null,
          },
        ];
      },
      "POST /api/me/comments": (route) => {
        const body = route.request().postDataJSON();
        sent.push(body);
        const comment = {
          id: "201",
          item_id: body.item_id,
          text: body.text,
          at: NOW,
          mine: true,
          can_delete: true,
          can_report: false,
          can_block: false,
          author: {
            account_id: "pp_invented_king",
            player_tag: "#20JJJ2CCRU",
            name: "King Thing",
            verified: true,
          },
        };
        replies.set(body.item_id, [comment]);
        return [201, { comment }];
      },
      "POST /api/me/comment-reports": (route) => {
        const body = route.request().postDataJSON();
        sent.push(body);
        replies.set(ids[2], []);
        return [200, { ok: true }];
      },
    }),
  };
  await mockApi(page, routes);
  await page.goto(surface === "clan" ? "/clan/0QC8RCGY/feed" : "/timeline");
  return { sent, reads };
}

test.use({ reducedMotion: "reduce" });
for (const width of [320, 390, 1280]) {
  for (const surface of ["timeline", "clan"] as const) {
    test(`${surface}: folded Mastery items keep independent cheers and keyboard replies at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.clock.setFixedTime(new Date(NOW));
      const { sent, reads } = await arrange(page, surface);
      const group = page.locator(".kit-feed__group").first();
      const toggle = group.locator(".kit-group__toggle");
      await target(toggle);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(
        group.getByRole("button", { name: /^Cheer(ed)?: / }),
      ).toHaveCount(0);
      await toggle.focus();
      await page.keyboard.press("Enter");
      const lines = group.locator(".kit-feed__item--moment");
      await expect(lines).toHaveCount(2);
      const first = lines.nth(0);
      const second = lines.nth(1);
      await target(first.getByRole("button", { name: "Comment", exact: true }));
      await target(first.getByRole("button", { name: "Share", exact: true }));
      const firstCheer = first.getByRole("button", {
        name: "Cheer: Well played",
        exact: true,
      });
      await target(firstCheer);
      await firstCheer.click();
      await expect(
        first.getByRole("button", {
          name: "Cheered: Well played",
          exact: true,
        }),
      ).toBeVisible();
      await expect(first.locator(".kit-cheer__glyph").first()).toHaveCSS(
        "animation-name",
        "none",
      );
      await expect(
        second.getByRole("button", { name: "Cheer: Well played", exact: true }),
      ).toBeVisible();
      const choose = second.getByRole("button", {
        name: "Choose a cheer",
        exact: true,
      });
      await target(choose);
      await choose.click();
      const royal = second.getByRole("button", { name: "Royal", exact: true });
      await target(royal);
      await royal.click();
      await expect.poll(() => sent.length).toBe(2);
      expect(sent[0]).toMatchObject({
        item_id: ids[0],
        item: ref(ids[0]),
        cheer: "well_played",
      });
      expect(sent[1]).toMatchObject({
        item_id: ids[1],
        item: ref(ids[1]),
        cheer: "royal",
      });
      const reply = first.getByRole("button", { name: "Comment", exact: true });
      await target(reply);
      await reply.focus();
      await page.keyboard.press("Enter");
      const box = first.getByRole("textbox", {
        name: "Your comment",
        exact: true,
      });
      await expect(box).toBeFocused();
      expect(reads.at(-1)).toEqual({ item: ids[0], item_ref: ref(ids[0]) });
      await noSideways(page);
      await capture(page, `${surface}-mastery-reply`, width);
      await box.fill("That Knight level looks good.");
      await box.press("Tab");
      const post = first.getByRole("button", { name: "Post", exact: true });
      await expect(post).toBeFocused();
      await target(post);
      await page.keyboard.press("Enter");
      await expect.poll(() => sent.length).toBe(3);
      expect(sent[2]).toMatchObject({
        item_id: ids[0],
        item: ref(ids[0]),
        text: "That Knight level looks good.",
      });
      await expect(
        page.getByText("That Knight level looks good.", { exact: true }),
      ).toBeVisible();
      const quiet = page
        .locator("article.kit-feed__item")
        .filter({ hasText: "passed 5 days without a recorded battle" });
      const quietCheer = quiet.getByRole("button", {
        name: "Cheer: Well played",
        exact: true,
      });
      await target(quietCheer);
      await quietCheer.click();
      await expect.poll(() => sent.length).toBe(4);
      expect(sent[3]).toMatchObject({
        item_id: ids[2],
        item: ref(ids[2]),
        cheer: "well_played",
      });
      const quietReply = quiet.getByRole("button", {
        name: "See 1 comment",
        exact: true,
      });
      await target(quietReply);
      await quietReply.focus();
      await page.keyboard.press("Enter");
      await expect(
        quiet.getByRole("textbox", { name: "Your comment" }),
      ).toBeFocused();
      expect(reads.at(-1)).toEqual({ item: ids[2], item_ref: ref(ids[2]) });
      const reported = quiet.getByRole("listitem").filter({
        hasText: "Hope we can play together soon.",
      });
      await reported
        .getByRole("button", { name: "Report", exact: true })
        .click();
      await reported.getByRole("radio", { name: "Spam", exact: true }).check();
      const report = reported.getByRole("button", {
        name: "Send report",
        exact: true,
      });
      await target(report);
      await report.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => sent.length).toBe(5);
      expect(sent[4]).toMatchObject({
        id: "200",
        reason: "spam",
        item: ref(ids[2]),
      });
      await noSideways(page);
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      ).toBe(true);
      await capture(page, `${surface}-social-items`, width);
      expect(errors).toEqual([]);
    });
  }
}
