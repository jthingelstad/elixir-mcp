import { test, expect } from "@playwright/test";
import { renderMail } from "@elixir-mcp/mail";
import { memberItemPath } from "@elixir-mcp/ui/item-link";
import { mailPreviewCases } from "../../../packages/mail/scripts/preview-cases.mjs";

for (const width of [320, 390, 1280]) {
  test(`digest posts and game updates keep local dates and exact conversation links at ${width}px`, async ({
    page,
  }) => {
    const base = mailPreviewCases().find(
      (c) => c.name === "tracking_report-posts",
    )!.facts;
    const tag = "#0PGQ2UYL";
    const postAt = "2026-11-18T10:15:00.000Z";
    const updateAt = "2026-11-17T14:30:00.000Z";
    const postPath = memberItemPath({
      item_id: "tl_0123456789abcdef0041",
      kind: "post",
      source: "post",
      post_id: "41",
      at: postAt,
    });
    const updatePath = memberItemPath({
      item_id: "tl_0123456789abcdef0042",
      kind: "career_wins_step",
      source: "game",
      subject: { kind: "player", tag },
      at: updateAt,
    });
    const facts = {
      ...base,
      window: { from: "2026-11-17T10:00:00Z", to: "2026-11-18T11:00:00Z" },
      followed_activity: { posters: 1, posts: 1, players: 1, battles: 2 },
      people: [
        {
          ...base.people[0],
          tag,
          name: "Invented Ada",
          nickname: null,
          battles: 2,
          wins: 1,
          losses: 1,
          sessions: 1,
          post_count: 1,
          sittings: [],
          more_sittings: 0,
          more_items: 0,
          items: [
            {
              kind: "post",
              at: postAt,
              member_path: postPath,
              text: "Asked a question",
              words: "Which card fits this deck?",
              post: { id: "41", question: true, cards: [], deck: null },
            },
            {
              kind: "career_wins_step",
              at: updateAt,
              member_path: updatePath,
              text: "Reached 5,000 career wins",
            },
          ],
        },
      ],
      clans: [],
      you: null,
      more_people: 0,
    };
    const mail = renderMail("digest_daily", facts, {
      timezone: "America/Chicago",
      now: Date.parse("2026-12-01T12:00:00Z"),
      unsubscribe: "https://elixir.test/off",
      manage: "https://elixir.test/settings/emails",
      pixel: false,
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(mail.html);
    await expect(
      page.getByText("Wed Nov 18, 4:15 am", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Tue Nov 17, 8:30 am", { exact: true }),
    ).toBeVisible();
    const actions = page.getByRole("link", {
      name: /^(Read and reply|Open item and comments)$/,
    });
    await expect(actions).toHaveCount(2);
    for (const link of await actions.all()) {
      await expect(link).toHaveAttribute(
        "href",
        /^https:\/\/elixir\.poapkings\.com\/home\/item\/tl_/,
      );
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    if (process.env.ITEM_SHOTS)
      await page.screenshot({
        path: `${process.env.ITEM_SHOTS}/digest-dates-${width}.png`,
        fullPage: true,
      });
  });
}
