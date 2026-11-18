import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { memberItemPath, readMemberItemPath } from "@elixir-mcp/ui/item-link";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";

const ID = "tl_0123456789abcdef0041";
const SHARE = "abcdefghijklmnopqrstuvwx";
const REF = {
  item_id: ID,
  kind: "badge_earned",
  source: "game",
  subject: { kind: "player", tag: "#0PGQ2UYL" },
  at: "2026-11-17T12:00:00.000Z",
};
const ITEM = {
  id: ID,
  kind: "badge_earned",
  section: "badges",
  at: REF.at,
  subject_tag: REF.subject.tag,
  subjects: [{ ...REF.subject, name: "Invented Ada" }],
  facts: { badge: "MasteryKnight", level: 5 },
  text: "Invented Ada reached Card Mastery level 5",
  item_ref: REF,
  cheers: {},
  my_cheer: null,
  can_cheer: true,
  comments: { count: 1, latest: [], open: true },
};
const PATH = memberItemPath(REF, { commentId: "42", after: "all" })!;
const ON_ME = {
  ...ME,
  features: { comments: true },
  claims: [
    {
      player_tag: "#0RJ29CVY",
      name: "Invented Reader",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
    },
  ],
};

for (const width of [320, 390, 1280]) {
  test(`a shared update opens its exact member thread and unread reply at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let reads = 0;
    const sent: (string | null)[] = [];
    await mockApi(
      page,
      signedIn({
        "GET /api/me": [200, ON_ME],
        [`GET /api/public/shared-items/${SHARE}`]: [
          200,
          { item: ITEM, member_url: PATH },
        ],
        [`GET /api/me/timeline-items/${ID}`]: (route) => {
          reads++;
          expect(
            JSON.parse(
              new URL(route.request().url()).searchParams.get("item_ref")!,
            ),
          ).toEqual(REF);
          return [200, { item: ITEM }];
        },
        "GET /api/me/comments": (route) => {
          const query = new URL(route.request().url()).searchParams;
          expect(query.get("around")).toBe("42");
          expect(query.get("item")).toBe(ID);
          return [
            200,
            {
              item_id: ID,
              count: 1,
              open: true,
              anchored: true,
              comments: [
                {
                  id: "42",
                  text: "A reply on this exact update",
                  at: "2026-11-17T12:01:00Z",
                  author: { name: "Invented Birch" },
                  mine: false,
                },
              ],
            },
          ];
        },
        "PUT /api/me/cheers": (route) => {
          const cheer = route.request().postDataJSON().cheer;
          sent.push(cheer);
          return [
            200,
            { cheers: cheer ? { [cheer]: 1 } : {}, my_cheer: cheer },
          ];
        },
      }),
    );
    await page.goto(`/share/${SHARE}`);
    await page.getByRole("link", { name: "Open item and comments" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Timeline update" }),
    ).toBeVisible();
    await expect(page.getByText(ITEM.text, { exact: true })).toBeVisible();
    const reply = page
      .getByRole("listitem")
      .filter({ hasText: "A reply on this exact update" });
    await expect(reply).toBeFocused();
    await expect(reply).toContainText("New comment");
    await expect(
      page.getByRole("textbox", { name: "Your comment" }),
    ).toBeVisible();
    const cheer = page.getByRole("button", { name: /^Cheer(ed)?: / });
    await cheer.focus();
    await page.keyboard.press("Enter");
    await expect(cheer).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect.poll(() => sent).toEqual(["well_played", null]);
    await expect(cheer).toHaveAttribute("aria-pressed", "false");
    const box = await cheer.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      a11y.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
    await page.getByRole("textbox", { name: "Your comment" }).focus();
    if (process.env.ITEM_SHOTS)
      await page.screenshot({
        path: `${process.env.ITEM_SHOTS}/member-item-${width}.png`,
        fullPage: true,
      });
    expect(reads).toBe(1);
    expect(errors).toEqual([]);
  });
}

test("a shared destination survives code sign-in and access denial reveals no item or thread", async ({
  page,
}) => {
  let authed = false;
  let reads = 0;
  await mockApi(
    page,
    signedIn({
      "GET /api/me": () => [200, authed ? ON_ME : SIGNED_OUT],
      [`GET /api/public/shared-items/${SHARE}`]: [
        200,
        { item: ITEM, member_url: PATH },
      ],
      "POST /api/auth": [200, { ok: true }],
      "POST /api/auth/code": () => {
        authed = true;
        return [200, { authenticated: true }];
      },
      [`GET /api/me/timeline-items/${ID}`]: () => {
        reads++;
        return [404, { error: "not_found" }];
      },
    }),
  );
  await page.goto(`/share/${SHARE}`);
  await page
    .getByRole("region", { name: "See more on Elixir" })
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  expect(reads).toBe(0);
  await page.getByLabel("Email", { exact: true }).fill("reader@example.test");
  await page.getByRole("button", { name: "Send sign-in email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/home/item/${ID}\\?`));
  expect(JSON.parse(new URL(page.url()).searchParams.get("ref")!)).toEqual(REF);
  expect(
    readMemberItemPath(ID, Object.fromEntries(new URL(page.url()).searchParams))
      ?.entry.reply,
  ).toBe("42");
  await expect(
    page.getByRole("heading", { name: "This item isn't available to you" }),
  ).toBeVisible();
  await expect(page.getByText(ITEM.text, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your comment" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /^Cheer(ed)?: / })).toHaveCount(
    0,
  );
  expect(reads).toBe(1);
});
test("deleting a post on its exact destination refreshes the item and removes its stale controls", async ({
  page,
}) => {
  const ref = {
    item_id: ID,
    source: "post",
    kind: "post",
    post_id: "41",
    at: REF.at,
  };
  let visible = true;
  let reads = 0;
  const item = {
    ...ITEM,
    kind: "post",
    section: "posts",
    item_ref: ref,
    post: {
      id: "41",
      text: "My post to remove",
      question: false,
      cards: [],
      deck: null,
      mine: true,
      can_delete: true,
      author: { player_tag: "#0RJ29CVY", name: "Invented Reader" },
    },
  };
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, ON_ME],
      [`GET /api/me/timeline-items/${ID}`]: () => {
        reads++;
        return visible ? [200, { item }] : [404, { error: "not_found" }];
      },
      "DELETE /api/me/posts/41": () => {
        visible = false;
        return [200, { ok: true }];
      },
      "GET /api/me/comments": [200, { comments: [], open: true }],
    }),
  );
  await page.goto(memberItemPath(ref)!);
  await expect(
    page.getByText("My post to remove", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "This item isn't available to you" }),
  ).toBeVisible();
  await expect(
    page.getByText("My post to remove", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your comment" })).toHaveCount(
    0,
  );
  expect(reads).toBeGreaterThanOrEqual(2);
});
