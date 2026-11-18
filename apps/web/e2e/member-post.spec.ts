import { expect, test } from "@playwright/test";
import { mockApi, signedIn, SIGNED_OUT } from "./fixtures.ts";

const ITEM = {
  id: "tl_0123456789abcdef0041",
  kind: "post",
  at: "2026-11-17T12:00:00.000Z",
  subject_tag: "#0PGQ2UYL",
  subjects: [{ kind: "player", tag: "#0PGQ2UYL", name: "Invented Ada" }],
  cheers: {},
  my_cheer: null,
  post: {
    id: "41",
    text: "Which card fits this deck?",
    question: true,
    cards: [],
    deck: null,
    mine: false,
    author: { player_tag: "#0PGQ2UYL", name: "Invented Ada" },
  },
};

test("a member post updates its count and selected cheer without refetching, then takes it back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let reads = 0;
  const sent: (string | null)[] = [];
  await mockApi(
    page,
    signedIn({
      "GET /api/me/post/41": () => {
        reads++;
        return [200, { item: ITEM }];
      },
      "PUT /api/me/cheers": (route) => {
        const cheer = route.request().postDataJSON().cheer;
        sent.push(cheer);
        return [200, { cheers: cheer ? { [cheer]: 1 } : {}, my_cheer: cheer }];
      },
    }),
  );
  await page.goto("/home/post/41");
  await expect(
    page.getByRole("heading", { level: 1, name: "Question" }),
  ).toBeVisible();
  await expect(page.getByText(ITEM.post.text, { exact: true })).toBeVisible();
  const cheer = page.getByRole("button", { name: /^Cheer(ed)?: / });
  await expect(cheer).toHaveAttribute("aria-pressed", "false");
  await cheer.focus();
  await page.keyboard.press("Enter");
  await expect(cheer).toHaveAttribute("aria-pressed", "true");
  await expect(cheer.locator(".kit-cheer__n")).toHaveText("1");
  await expect.poll(() => sent).toEqual(["well_played"]);
  const picker = page.getByRole("button", { name: "Choose a cheer" });
  await picker.click();
  await expect(
    page.getByRole("group", { name: "Cheer with", exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(0);
    await expect(picker).toBeFocused();
    await expect(cheer).toHaveAttribute("aria-pressed", "true");
    const box = await cheer.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: `/tmp/elixir-member-post-cheer-${width}.png`,
      fullPage: true,
    });
  }
  await page.keyboard.press("Escape");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await expect(picker).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cheer).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => sent).toEqual(["well_played", null]);
  await expect(cheer).toHaveAttribute("aria-pressed", "false");
  await expect(cheer.locator(".kit-cheer__n")).toHaveText("");
  expect(reads).toBe(1);
});

test("a member post outside the viewer's audience has no cheer action", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && new URL(r.url()).pathname === "/api/me/cheers")
      writes.push(r.url());
  });
  await mockApi(
    page,
    signedIn({ "GET /api/me/post/41": [404, { error: "not_found" }] }),
  );
  await page.goto("/home/post/41");
  await expect(
    page.getByRole("heading", { name: "No post at this link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Cheer(ed)?: |Choose a cheer/ }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("a signed-out member destination asks for sign-in before reading its post or cheers", async ({
  page,
}) => {
  const memberReads: string[] = [];
  page.on("request", (r) => {
    if (/^\/api\/me\/(post\/|cheers)/.test(new URL(r.url()).pathname))
      memberReads.push(r.url());
  });
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
  await page.goto("/home/post/41");
  await expect(
    page.getByRole("heading", { name: "Sign in first" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Cheer(ed)?: |Choose a cheer/ }),
  ).toHaveCount(0);
  expect(memberReads).toEqual([]);
});
