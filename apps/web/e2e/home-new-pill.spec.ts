import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * Home's "N new" pill (2026-11-14). An open feed is never read again under
 * the reader: a cheap count, once a minute while the tab is visible, says
 * when new items have arrived, and a pill floats at the feed's top without
 * moving anything. A hidden tab asks nothing. The tap reads the first page
 * again and brings the feed's top into view. At 320, 390 and 1280, with axe
 * and nothing scrolling sideways. Invented players only.
 *
 * NEW_PILL_SHOTS=<dir> also saves a capture with the pill showing.
 */
const shots = process.env.NEW_PILL_SHOTS;
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const WEEK = { from: AGO(10_080), to: AGO(0) };
const TOTAL = 40;
const PAGE = 30;

function item(i: number, name = `Invented ${i}`) {
  return {
    id: `tl_${String(i).padStart(20, "0")}`,
    kind: "pol_league",
    at: AGO(10 + i * 60),
    observed_at: AGO(9 + i * 60),
    subject_tag: "#00J8VCYU",
    subject_name: name,
    subjects: [{ tag: "#00J8VCYU", kind: "player", name }],
    groups: ["friends"],
    text: `${name} reached Path of Legends.`,
    facts: {},
  };
}

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

/** The tab hidden or shown, as the browser tells the page. */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (h ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

for (const width of [320, 390, 1280]) {
  test(`${width}px: new items wait behind the pill, a hidden tab asks nothing, the tap shows them`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install();
    let arrived = false;
    const feedReads: (string | null)[] = [];
    const counts: string[] = [];
    await mockApi(
      page,
      homeApi({
        "GET /api/me/home/feed": (route) => {
          const cursor = new URL(route.request().url()).searchParams.get(
            "cursor",
          );
          feedReads.push(cursor);
          const all = arrived ? [newcomer, ...items] : items;
          const offset = cursor ? Number(cursor) : 0;
          const end = Math.min(offset + PAGE, all.length);
          return [
            200,
            {
              window: WEEK,
              seen_to: AGO(120),
              timeline: all.slice(offset, end),
              total: all.length,
              next: end < all.length ? String(end) : null,
              timeline_more: 0,
            },
          ];
        },
        "GET /api/me/home/feed/new": (route) => {
          const since =
            new URL(route.request().url()).searchParams.get("since") ?? "";
          counts.push(since);
          // The newcomer, once learned, is new to a feed that lacks it.
          const fresh =
            arrived && Date.parse(since) < Date.parse(newcomer.observed_at);
          return [200, { new: fresh ? 1 : 0, built_at: AGO(1) }];
        },
      }),
    );
    const items = Array.from({ length: TOTAL }, (_, i) => item(i + 1));
    const newcomer = item(0, "Invented Newcomer");

    await page.goto("/home");
    const feed = page.locator(".kit-feed");
    await expect(feed.getByText("Invented 1 reached Path")).toBeVisible();
    await expect.poll(() => counts.length).toBeGreaterThan(0);
    expect(counts[0]).toBe(items[0]!.observed_at);

    // Read on to the second page and stay down there.
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(feed.getByText("Invented 40 reached Path")).toBeVisible();
    const anchor = feed.getByText("Invented 35 reached Path");
    await anchor.scrollIntoViewIfNeeded();
    const before = await anchor.boundingBox();
    const reads = feedReads.length;

    // Something new is learned; the next minute's count finds it.
    arrived = true;
    await page.clock.fastForward(61_000);
    const pill = page.getByRole("button", { name: "Show 1 new item" });
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText("1 new");
    expect(await anchor.boundingBox(), "nothing moved").toEqual(before);
    expect(feedReads.length, "the feed is not read again").toBe(reads);
    const box = await pill.boundingBox();
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await noSideways(page);
    // The pill fades in (160ms); axe reads a half-faded pill as low
    // contrast, so check it once the fade has finished.
    await pill.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    await accessible(page, "the pill");
    if (shots)
      await page.screenshot({ path: `${shots}/new-pill-${width}.png` });

    // Hidden, the tab asks nothing, however long it waits.
    await setHidden(page, true);
    const asked = counts.length;
    await page.clock.fastForward(5 * 60_000);
    expect(counts.length, "no count while hidden").toBe(asked);
    await setHidden(page, false);

    // The tap reads the first page alone and shows the newcomer at the top.
    await pill.click();
    await expect(
      feed.getByText("Invented Newcomer reached Path"),
    ).toBeVisible();
    expect(feedReads.slice(reads)).toEqual([null]);
    await expect(pill).toBeHidden();
    await expect(feed).toBeFocused();
    await expect(feed.getByText("Invented 40 reached Path")).toBeHidden();
    await noSideways(page);
  });
}
