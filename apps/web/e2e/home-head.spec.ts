import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * The Timeline's head on a phone (2026-11-17): the battle log's freshness
 * note sat over the title at 320px. Where there is room it stays on the
 * title's row, right; under 375px it takes its own line under the title.
 * The width decides, never the note's words, so a note that changes length
 * moves nothing and is never drawn over the title.
 */
type Box = { left: number; right: number; top: number; bottom: number };

/** The title's words (not the h1's full-width block) and the note's chip. */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const rect = (r: DOMRect) => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    });
    const h1 = document.querySelector(".kit-head--home .kit-head__title")!;
    const words = document.createRange();
    words.selectNodeContents(h1);
    const note = document.querySelector(
      ".kit-head--home .kit-fresh > summary",
    )!;
    const text = document.querySelector(".kit-head--home .kit-fresh__text")!;
    const chips = document.querySelector(".kit-head--home .kit-home__filters");
    return {
      title: rect(words.getBoundingClientRect()),
      note: rect(note.getBoundingClientRect()),
      textHeight: text.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(text).lineHeight) || 18,
      chipsTop: chips ? chips.getBoundingClientRect().top : null,
      over: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

const meet = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const width of [320, 360, 374, 375, 390, 420]) {
  test(`@narrow the freshness note never covers the Timeline title at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockApi(page, homeApi());
    await page.goto("/timeline");
    await expect(
      page.getByRole("heading", { level: 1, name: "Timeline" }),
    ).toBeVisible();
    const summary = page.locator(".kit-head--home .kit-fresh > summary");
    await expect(summary).toHaveText(/^Battle log read /);
    await page.evaluate(() => document.fonts.ready);

    const first = await boxes(page);
    expect(meet(first.title, first.note), JSON.stringify(first)).toBe(false);
    expect(first.over).toBeLessThanOrEqual(0);
    // One line of words, never wrapped.
    expect(first.textHeight).toBeLessThan(first.lineHeight * 1.5);
    if (width < 375) {
      // Its own line, under the title and above the chips.
      expect(first.note.top).toBeGreaterThanOrEqual(first.title.bottom - 12);
      if (first.chipsTop != null)
        expect(first.note.bottom).toBeLessThanOrEqual(first.chipsTop + 1);
    } else {
      // Beside the title, on its row.
      const mid = (first.note.top + first.note.bottom) / 2;
      expect(mid).toBeGreaterThan(first.title.top);
      expect(mid).toBeLessThan(first.title.bottom);
    }

    // The note's words change length (a check starts, a read ages): the
    // chips stay where they were and the title stays clear.
    for (const words of [
      "Checking for new battles…",
      "Battle log read: never",
      "Battle log read 30 days ago",
    ]) {
      await page.evaluate((w) => {
        document.querySelector(
          ".kit-head--home .kit-fresh__text",
        )!.textContent = w;
      }, words);
      const next = await boxes(page);
      expect(
        meet(next.title, next.note),
        `${words}: ${JSON.stringify(next)}`,
      ).toBe(false);
      expect(next.chipsTop).toBe(first.chipsTop);
      expect(next.textHeight).toBeLessThan(next.lineHeight * 1.5);
      expect(next.over).toBeLessThanOrEqual(0);
    }
  });
}
