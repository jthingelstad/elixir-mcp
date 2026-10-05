import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn, ME } from "./fixtures.ts";

for (const size of ["wide", "@narrow"])
  for (const role of ["leader", "coLeader"])
    test(`chat-first update: switch, reload, interrupted receipt and mixed history for ${role} ${size}`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const parts = [
        {
          part: 1,
          message: { title: "Season 136", body: "WarChamp: Ada, Bob." },
        },
        {
          part: 2,
          message: { title: "Season 136", body: "IronKing: Cy, Dee." },
        },
      ];
      let card: Record<string, any> = {
        card_id: "delivery",
        number: 51,
        type: "awards_standings",
        label: "Share award standings",
        status: "proposed",
        channel: "clan_chat",
        can_act: true,
        audience: { kind: "leaders" },
        raised_at: "2026-10-05T11:00:00Z",
        draft_context_version: "frozen-context",
        evidence: { scope: "current", season_id: 136, messages: parts },
        log: [],
        delivery: {
          version: 1,
          channel: "clan_chat",
          parts: parts.map((p) => ({
            part: p.part,
            options: {
              clan_chat: { lines: [`${p.message.title}: ${p.message.body}`] },
              leader_message: p.message,
            },
          })),
        },
      };
      const receipts: Record<string, unknown>[] = [];
      const decisions: Record<string, unknown>[] = [];
      const currentClan = { ...ME.clans[0]!, role };
      await mockApi(
        page,
        signedIn({
          "GET /api/clan/me": [
            200,
            { ...ME, clans: [currentClan], selected: currentClan },
          ],
          "GET /api/clan/clans/2PQRJ8LV/actions/51": () => [
            200,
            { clan_tag: "#2PQRJ8LV", action: card, decline_reasons: [] },
          ],
          "GET /api/clan/clans/2PQRJ8LV/actions": () => [
            200,
            {
              open: card.status === "proposed" ? [card] : [],
              recent: card.status === "done" ? [card] : [],
            },
          ],
          ...Object.fromEntries(
            [1, 2].map((part) => [
              `POST /api/clan/clans/2PQRJ8LV/actions/delivery/messages/${part}/sent`,
              (route: any) => {
                const words = route.request().postDataJSON();
                receipts.push(words);
                card.messages_sent = [
                  ...(card.messages_sent ?? []),
                  {
                    part,
                    ...words,
                    shared: true,
                    sent_by_name: "Ada",
                    sent_at: "2026-10-05T12:00:00Z",
                  },
                ];
                return part === 1
                  ? [504, { error: "reply_lost" }]
                  : [200, card];
              },
            ]),
          ),
          "POST /api/clan/clans/2PQRJ8LV/actions/delivery/decide": (route) => {
            decisions.push(route.request().postDataJSON());
            card = {
              ...card,
              status: "done",
              can_act: false,
              channel: null,
              delivery_channels: ["clan_chat", "leader_message"],
              decided_by_name: "Ada",
              decided_at: "2026-10-05T12:01:00Z",
            };
            return [200, card];
          },
        }),
      );
      await page.goto("/clan/2PQRJ8LV/actions/51");
      const chat = page.getByRole("textbox", {
        name: "Chat message",
        exact: true,
      });
      await expect(chat).toHaveCount(2);
      await chat.nth(0).fill("S136 WarChamp: Ada, Bob.");
      await chat.nth(1).fill("Reviewed second chat.");
      await page
        .getByLabel("Delivery channel for message 2")
        .selectOption("leader_message");
      await expect(
        page.getByText(/Reported limit: one Leader Message per day/),
      ).toBeVisible();
      await page
        .getByLabel("Message", { exact: true })
        .fill("Reviewed durable words.");
      await page.reload();
      await expect(chat).toHaveValue("S136 WarChamp: Ada, Bob.");
      await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
        "Reviewed durable words.",
      );
      await page
        .getByLabel("Delivery channel for message 2")
        .selectOption("clan_chat");
      await expect(chat.nth(1)).toHaveValue("Reviewed second chat.");
      await page
        .getByLabel("Delivery channel for message 2")
        .selectOption("leader_message");
      await page
        .getByRole("button", { name: "Copy the chat message", exact: true })
        .click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "S136 WarChamp: Ada, Bob.",
      );
      expect(receipts).toHaveLength(0);
      await page
        .getByRole("button", { name: "Mark message 1 sent", exact: true })
        .click();
      await expect(
        page.getByText("Sent in clan chat", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("S136 WarChamp: Ada, Bob.", { exact: true }),
      ).toBeVisible();
      expect(receipts).toHaveLength(1);
      await expect(
        page.getByRole("button", { name: "Complete update", exact: true }),
      ).toBeDisabled();
      await page.getByLabel("Message", { exact: true }).fill("x".repeat(181));
      await expect(
        page.getByRole("button", { name: "Mark message 2 sent", exact: true }),
      ).toBeDisabled();
      await page
        .getByLabel("Message", { exact: true })
        .fill("Reviewed durable words.");
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        axe.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/elixir-delivery-${role}-${size === "wide" ? "wide" : "narrow"}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Mark message 2 sent", exact: true })
        .click();
      await expect(
        page.getByText("Sent as a Leader Message", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Complete update", exact: true })
        .click();
      await expect(page.getByText("Completed", { exact: true })).toBeVisible();
      await page.reload();
      await expect(
        page.getByText("Sent in clan chat", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Reviewed durable words.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: /Delivery channel/ }),
      ).toHaveCount(0);
      expect(receipts.map((r) => r.channel)).toEqual([
        "clan_chat",
        "leader_message",
      ]);
      expect(decisions).toHaveLength(1);
      expect(errors).toEqual([]);
    });
