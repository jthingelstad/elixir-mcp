import { test, expect } from "@playwright/test";
import { mockApi, signedIn } from "./fixtures.ts";

test("promote, copy the published tribute, and resume an interrupted send @narrow", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const card = {
    card_id: "promote_pip",
    number: 51,
    type: "promotion",
    player_name: "Pip",
    player_tag: "#0QYPJ8G2",
    label: "Promote to Elder",
    status: "proposed",
    can_act: true,
    can_share: false,
    raised_at: "2026-11-19T12:00:00Z",
    audience: { kind: "leaders" },
    evidence: {},
    log: [],
    lifecycle: {
      phase: "decision",
      lines: ["Congratulations, Pip!", "Thanks for playing all 16 war decks."],
      receipts: [] as { part: number; by: string; at: string }[],
    },
  };
  const base = "/api/clan/clans/0QC8RCGY/actions";
  const parts: number[] = [];
  await mockApi(
    page,
    signedIn({
      [`GET ${base}/51`]: () => [
        200,
        { action: card, clan_tag: "#0QC8RCGY", decline_reasons: [] },
      ],
      [`POST ${base}/promote_pip/decide`]: (route) => {
        const body = route.request().postDataJSON();
        expect(body.sent).toBeUndefined();
        card.lifecycle.lines = body.tribute;
        card.status = "done";
        card.can_act = false;
        card.can_share = true;
        card.lifecycle.phase = "sharing";
        return [200, card];
      },
      [`POST ${base}/promote_pip/share`]: (route) => {
        const { part } = route.request().postDataJSON();
        parts.push(part);
        card.lifecycle.receipts.push({
          part,
          by: "#0LCRV2PQ",
          at: "2026-11-19T12:05:00Z",
        });
        if (part === 2) {
          card.lifecycle.phase = "sent";
          card.can_share = false;
        }
        return [part === 1 ? 504 : 200, card];
      },
    }),
  );
  await page.goto("/clan/0QC8RCGY/actions/51");
  await page
    .getByRole("textbox", { name: "Tribute for the clan Timeline" })
    .fill("Congratulations on Elder, Pip!\n\nAll 16 decks. Thanks, Pip!");
  await page.getByRole("button", { name: "I promoted them" }).click();
  await page
    .getByRole("button", { name: "Copy for clan chat" })
    .first()
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Congratulations on Elder, Pip!",
  );
  expect(parts).toEqual([]);
  await page.getByRole("button", { name: "Mark paragraph 1 sent" }).click();
  await page.reload();
  await expect(page.getByText(/Marked sent by/)).toHaveCount(1);
  await page.getByRole("button", { name: "Mark paragraph 2 sent" }).click();
  await expect(page.getByText(/Marked sent by/)).toHaveCount(2);
  expect(parts).toEqual([1, 2]);
  expect(errors).toEqual([]);
});
