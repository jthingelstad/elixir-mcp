import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import { BELL_ME, EMPTY_BELL, NO_NEEDS } from "./bell-fixture.ts";
import { readMemberItemPath } from "@elixir-mcp/ui/item-link";

const ITEM = "tl_0123456789abcdef0099";
const at = "2026-11-18T10:00:00.000Z";
const ref = {
  source: "game",
  item_id: ITEM,
  kind: "card_mastery_step",
  at,
  subject: { kind: "player", tag: "#0PGQ2UYL" },
};
const rows = [
  {
    item_id: ITEM,
    item_ref: ref,
    title: "Birch Lantern took Knight Mastery to level 10.",
    at,
    unread: 2,
    first_unread_comment_id: "42",
    read_at: "2026-11-18T09:00:00Z",
    read_comment_id: "40",
  },
  {
    item_id: "tl_0123456789abcdef0098",
    item_ref: {
      ...ref,
      item_id: "tl_0123456789abcdef0098",
      source: "post",
      kind: "post",
      post_id: "98",
    },
    title: "Which card would you swap in this deck?",
    question: true,
    at,
    unread: 1,
    first_unread_comment_id: "41",
    read_at: "2026-11-18T09:00:00Z",
  },
  {
    item_id: "tl_0123456789abcdef0097",
    item_ref: {
      ...ref,
      item_id: "tl_0123456789abcdef0097",
      kind: "member_joined",
      subject: { kind: "clan", tag: "#0QC8RCGY" },
    },
    title: "Moss Lantern joined Invented Clan.",
    at,
    unread: 0,
    first_unread_comment_id: null,
    read_at: at,
  },
];
for (const width of [320, 390, 1280]) {
  test(`My conversations resumes the first unread reply at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/me/conversations"))
        calls.push(request.method());
    });
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [
          200,
          { ...BELL_ME, features: { comments: true, posts: true } },
        ],
        "GET /api/me/home/needs": [200, { needs: NO_NEEDS }],
        "GET /api/me/bell": [200, EMPTY_BELL],
        "PUT /api/me/bell/seen": [200, { seen_at: at }],
        "GET /api/me/conversations": [200, { items: rows, next_before: null }],
      }),
    );
    await page.goto("/timeline");
    const opener = page
      .locator(".kit-top")
      .getByRole("button", { name: /^Notifications/ });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    const conversations = dialog.getByRole("button", {
      name: "My conversations",
      exact: true,
    });
    expect(calls).toEqual([]);
    await conversations.focus();
    await page.keyboard.press("Enter");
    await expect(conversations).toHaveAttribute("aria-pressed", "true");
    const thread = dialog.getByRole("link", {
      name: /Birch Lantern.*2 new replies/,
    });
    await expect(thread).toBeVisible();
    const url = new URL(
      (await thread.getAttribute("href"))!,
      "https://example.test",
    );
    expect(url.pathname).toBe(`/home/item/${ITEM}`);
    const target = readMemberItemPath(
      ITEM,
      Object.fromEntries(url.searchParams),
    );
    expect(target!.entry.reply).toBe("42");
    expect(target!.entry.afterId).toBe("40");
    expect(target!.ref).toEqual(ref);
    await expect(dialog.getByText(/1 new answer/)).toBeVisible();
    await expect(dialog.getByText(/No new replies/)).toBeVisible();
    for (const element of [
      conversations,
      thread,
      dialog.getByRole("button", { name: "Close", exact: true }),
    ]) {
      const box = await element.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(calls).toEqual(["GET"]);
    if (process.env.CONVERSATIONS_SHOTS)
      await page.screenshot({
        path: `${process.env.CONVERSATIONS_SHOTS}/conversations-${width}.png`,
      });
    await page.keyboard.press("ArrowDown");
    await expect(thread).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
  });
}

test("My conversations distinguishes empty from failed and supports a retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failed = true;
  await mockApi(
    page,
    homeApi({
      "GET /api/me": [200, { ...BELL_ME, features: { comments: true } }],
      "GET /api/me/bell": [200, EMPTY_BELL],
      "PUT /api/me/bell/seen": [200, { seen_at: at }],
      "GET /api/me/conversations": () =>
        failed
          ? [503, { error: "unavailable" }]
          : [200, { items: [], next_before: null }],
    }),
  );
  await page.goto("/timeline?bell");
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog
    .getByRole("button", { name: "My conversations", exact: true })
    .click();
  await expect(
    dialog.getByText("Your conversations could not be read just now"),
  ).toBeVisible();
  await expect(dialog.getByText("No conversations yet")).toHaveCount(0);
  if (process.env.CONVERSATIONS_SHOTS)
    await page.screenshot({
      path: `${process.env.CONVERSATIONS_SHOTS}/conversations-error-390.png`,
    });
  failed = false;
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog.getByText("No conversations yet")).toBeVisible();
  if (process.env.CONVERSATIONS_SHOTS)
    await page.screenshot({
      path: `${process.env.CONVERSATIONS_SHOTS}/conversations-empty-390.png`,
    });
});

test("an entirely filtered conversation page offers its continuation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockApi(
    page,
    homeApi({
      "GET /api/me": [200, { ...BELL_ME, features: { comments: true } }],
      "GET /api/me/bell": [200, EMPTY_BELL],
      "PUT /api/me/bell/seen": [200, { seen_at: at }],
      "GET /api/me/conversations": (route) =>
        new URL(route.request().url()).searchParams.has("before")
          ? [200, { items: [rows[0]], next_before: null }]
          : [200, { items: [], next_before: "sealed-fixture-cursor" }],
    }),
  );
  await page.goto("/timeline?bell");
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog
    .getByRole("button", { name: "My conversations", exact: true })
    .click();
  await expect(
    dialog.getByText("No available conversations here"),
  ).toBeVisible();
  const older = dialog.getByRole("button", {
    name: "Older conversations",
    exact: true,
  });
  await expect(older).toBeVisible();
  await older.focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("link", { name: /Birch Lantern.*2 new replies/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
