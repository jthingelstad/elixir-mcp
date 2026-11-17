import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";
import { FEED_NOW, rhythmApi } from "./feed-rhythm-fixture.ts";
import {
  SHARED_ID,
  SHARED_MEMBER,
  SHARED_TAG,
  sessionDayApi,
} from "./session-fixture.ts";

/**
 * A cheer is one tap (2026-11-17): Cheer gives Well played at once and a
 * second tap takes it back; the smile beside it opens the six inline, by
 * pointer or keyboard. And every icon-only control on the pages the glyph
 * pass touched has a name. Invented players only.
 */
async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

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

/** Every button and link whose only content is a glyph carries a name of
 *  its own: an aria-label, aria-labelledby or a title. */
async function namedIcons(page: Page, where: string) {
  const nameless = await page.evaluate(() =>
    [...document.querySelectorAll("button, a[href], [role='button']")]
      .filter((el) => {
        const box = (el as HTMLElement).getBoundingClientRect();
        if (!box.width || !box.height) return false;
        if (!el.querySelector("svg")) return false;
        const text = [...el.childNodes]
          .map((n) =>
            n.nodeType === Node.TEXT_NODE
              ? n.textContent
              : (n as Element).getAttribute?.("aria-hidden") === "true" ||
                  (n as Element).tagName === "svg"
                ? ""
                : n.textContent,
          )
          .join("")
          .trim();
        return (
          !text &&
          !el.getAttribute("aria-label") &&
          !el.getAttribute("aria-labelledby") &&
          !el.getAttribute("title")
        );
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  );
  expect(nameless, `${where}: icon-only controls without a name`).toEqual([]);
}

/** The first full card that holds a Cheer not yet yours, pinned by its
 *  place so it stays the same card once the cheer lands. */
async function freshCard(page: Page) {
  const cards = page.locator(".kit-feed__item:not(.kit-feed__item--line)");
  await expect(cards.first()).toBeVisible();
  const at = await cards.evaluateAll((els) =>
    els.findIndex((el) =>
      el.querySelector(":scope .kit-cheer:not(.kit-cheer--mine)"),
    ),
  );
  expect(at).toBeGreaterThanOrEqual(0);
  return cards.nth(at);
}

function cheersApi(sent: { item_id: string; cheer: string | null }[]) {
  return rhythmApi({
    "PUT /api/me/cheers": (route) => {
      const body = route.request().postDataJSON();
      sent.push({ item_id: body.item_id, cheer: body.cheer });
      return [
        200,
        {
          item_id: body.item_id,
          cheers: body.cheer ? { [body.cheer]: 1 } : {},
          my_cheer: body.cheer,
        },
      ];
    },
  });
}

for (const width of [390, 1280]) {
  test(`one tap cheers and a second takes it back, at ${width}`, async ({
    page,
  }) => {
    const sent: { item_id: string; cheer: string | null }[] = [];
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date(FEED_NOW));
    await mockApi(page, cheersApi(sent));
    await page.goto("/timeline");
    const card = await freshCard(page);
    const cheer = card.getByRole("button", { name: "Cheer", exact: true });
    await expect(cheer).toHaveAttribute("aria-pressed", "false");
    const before = await card.boundingBox();
    const size = await cheer.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(size!.width).toBeGreaterThanOrEqual(44);
    await cheer.click();
    await expect(cheer).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.cheer).toBe("well_played");
    // No layout shift: the card keeps its height when the cheer lands.
    const after = await card.boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
    await cheer.click();
    await expect(cheer).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ item_id: sent[0]?.item_id, cheer: null });
    await noSideways(page);
    await accessible(page, `Timeline at ${width}, cheered and taken back`);
  });

  test(`another kind from the keyboard, at ${width}`, async ({ page }) => {
    const sent: { item_id: string; cheer: string | null }[] = [];
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date(FEED_NOW));
    await mockApi(page, cheersApi(sent));
    await page.goto("/timeline");
    const card = await freshCard(page);
    const more = card.getByRole("button", { name: "Choose a cheer" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const kinds = card.getByRole("group", { name: "Cheer with" });
    await expect(kinds.getByRole("button")).toHaveCount(6);
    await expect(
      kinds.getByRole("button", { name: "Well played" }),
    ).toBeFocused();
    await accessible(page, `Timeline at ${width}, kinds open`);
    await noSideways(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(kinds.getByRole("button", { name: "Royal" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.cheer).toBe("royal");
    await expect(kinds).toHaveCount(0);
    const cheer = card.getByRole("button", { name: "Cheer", exact: true });
    await expect(cheer).toBeFocused();
    await expect(cheer).toHaveAttribute("aria-pressed", "true");
    await expect(cheer.locator("svg.lucide-crown")).toHaveCount(1);
    // Escape closes the kinds without a write.
    await more.focus();
    await page.keyboard.press("Enter");
    // Focus lands on yours.
    await expect(kinds.getByRole("button", { name: "Royal" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect(sent).toHaveLength(1);
  });

  test(`icon-only controls have names, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date(FEED_NOW));
    await mockApi(page, rhythmApi());
    await page.goto("/timeline");
    await expect(page.locator(".kit-feed__item").first()).toBeVisible();
    await namedIcons(page, "Timeline");
    await page.locator(".kit-feed__group .kit-group__toggle").first().click();
    await namedIcons(page, "Timeline, a group open");

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockApi(page, signedIn({}));
    await page.goto("/settings/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await namedIcons(page, "Settings");
    await noSideways(page);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockApi(
      page,
      sessionDayApi({ "GET /api/player/session": [200, SHARED_MEMBER] }),
    );
    await page.goto(`/home/player/${SHARED_TAG.slice(1)}/session/${SHARED_ID}`);
    await expect(
      page.getByRole("region", { name: "Share this session" }),
    ).toBeVisible();
    await namedIcons(page, "a session page");
    await noSideways(page);
  });
}

test("no sideways scroll at 320 with the kinds open", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.clock.setFixedTime(new Date(FEED_NOW));
  await mockApi(page, rhythmApi());
  await page.goto("/timeline");
  const card = page
    .locator(".kit-feed__item:not(.kit-feed__item--line)")
    .filter({ has: page.locator(".kit-cheers") })
    .first();
  await card.getByRole("button", { name: "Choose a cheer" }).click();
  await expect(card.getByRole("group", { name: "Cheer with" })).toBeVisible();
  await noSideways(page);
  const group = page.locator(".kit-feed__group").first();
  await group.locator(".kit-group__toggle").click();
  await group
    .locator(".kit-feed__item--line")
    .first()
    .getByRole("button", { name: "Choose a cheer" })
    .click();
  await noSideways(page);
});
