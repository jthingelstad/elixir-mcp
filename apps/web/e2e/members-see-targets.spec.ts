import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { BATTLE } from "./battle-fixture.ts";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/**
 * Two polish fixes of 2026-11-12, at phone width. G8: on Settings › What
 * members see every control, the lens's battle included, is at least 44 px
 * tall, and a follow slot's row is one target that opens the player. G9:
 * the battle page's posted highlight leads with its words, Share and Edit
 * words are ordinary buttons rather than full-width ones, and Delete is a
 * quiet link. Invented players; local mocks only.
 */

const SLOTS = {
  used: 1,
  free: 1,
  limit: 50,
  players: [
    {
      player_tag: "#0VJ2QV",
      name: "Copper Fern",
      slot: "used",
      reason: null,
      yours: "friend",
      agents: [],
    },
    {
      player_tag: "#09PR",
      name: "Violet Reed",
      slot: "free",
      reason: "followed_by_others",
      yours: "friend",
      agents: [],
    },
  ],
};

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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test("What members see: every control is a 44 px target, and a slot's row opens its player", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/me/follow-slots": [200, SLOTS],
      "GET /api/clan/me/place": [200, { place: null }],
      "POST /api/explore": [
        200,
        { body: { battles: [{ url: BATTLE.battle.url }] } },
      ],
      [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    }),
  );
  await page.goto("/settings/what-members-see");
  const slots = page.getByRole("region", { name: "Your follow slots" });
  await expect(slots.getByText("Copper Fern")).toBeVisible();
  // The lens has drawn its battle.
  await expect(
    page.getByRole("link", { name: "Open your player’s page" }),
  ).toBeVisible();
  await expect(page.locator(".st-seen .battle__name").first()).toBeVisible();
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".st-seen a, .st-seen button, .st-seen input, .st-seen select, .st-seen summary",
      ),
    ]
      .map((el) => ({
        // A row that is one target: its name's link covers the whole row.
        h: (el.matches(".kit-row--target .kit-row__link")
          ? el.closest(".kit-row")!
          : el
        ).getBoundingClientRect().height,
        what: `${el.tagName} ${(el.textContent ?? "").trim().slice(0, 30)}`,
      }))
      // Hidden controls (a closed dialog's) take no space.
      .filter((x) => x.h > 0 && x.h < 44)
      .map((x) => `${x.what}: ${Math.round(x.h)} px`),
  );
  expect(small).toEqual([]);
  await accessible(page, "what members see, phone");

  // The row, not only the name, opens the player: tap its detail line.
  const using = slots.getByLabel("Players using a slot");
  const line = using.getByText("You follow them");
  await line.scrollIntoViewIfNeeded();
  const detail = (await line.boundingBox())!;
  await page.mouse.click(detail.x + 4, detail.y + detail.height / 2);
  await expect(page).toHaveURL(/\/home\/player\/0VJ2QV$/);
});

test("the battle page: a highlight's words lead, its buttons are ordinary, Delete is quiet", async ({
  page,
}) => {
  const tag = BATTLE.sides[0]!.players[0]!.player_tag as string;
  const name = BATTLE.sides[0]!.players[0]!.name as string;
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [
        200,
        {
          ...ME,
          claims: [
            {
              player_tag: tag,
              name,
              is_primary: true,
              relationship: "primary",
              status: "verified",
            },
          ],
        },
      ],
      [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
      "GET /api/me/highlights": [
        200,
        {
          battle_id: BATTLE.battle.id,
          can_highlight_as: [tag],
          highlights: [
            {
              highlight_id: "11111111-1111-4111-8111-111111111111",
              player_tag: tag,
              words: "Held the bridge at the last second",
              share_url: null,
            },
          ],
        },
      ],
    }),
  );
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  const panel = page.getByRole("region", { name: "Highlight this battle" });
  const words = panel.getByText("“Held the bridge at the last second”");
  const where = panel.getByText(`On ${name}’s timeline`);
  await expect(words).toBeVisible();
  const [w, o] = [await words.boundingBox(), await where.boundingBox()];
  expect(w!.y).toBeLessThan(o!.y);
  // Ordinary buttons: neither stretches across the panel.
  const box = (await panel.boundingBox())!;
  for (const label of ["Share", "Edit words"]) {
    const b = (await panel.getByRole("button", { name: label }).boundingBox())!;
    expect(b.width).toBeLessThan(box.width / 2);
  }
  const del = panel.getByRole("button", { name: "Delete" });
  await expect(del).toHaveClass(/\blink\b/);
  await accessible(page, "battle highlight, phone");
  // Delete still asks first.
  await del.click();
  await expect(
    page.getByRole("dialog", { name: "Delete this highlight?" }),
  ).toBeVisible();
});
