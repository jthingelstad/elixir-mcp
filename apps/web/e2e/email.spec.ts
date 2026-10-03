import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

/** Account › Emails from Elixir, the ConsoleEmails board (2026-10-02):
 *  the week by the day each email arrives, the two that come when
 *  something happens, the last few sent, and Every email. */

/** Nothing serious or critical. */
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

const at = (weekday: string) => ({ weekday, time: "9:00 am", zone: "Central" });
const KINDS = (
  [
    ["clan_report", "Clan report", "Clan", at("Monday")],
    ["arena_week", "Your week in the Arena", "Ladder", at("Tuesday")],
    ["tracking_report", "Your friends this week", "Friends", at("Wednesday")],
    ["collector_activity", "Collector activity", "Collectors", at("Sunday")],
    ["milestone", "Milestones", "Ladder", null],
    ["clan_actions_waiting", "Clan actions waiting", "Clan", null],
  ] as const
).map(([kind, label, product, sends]) => ({
  kind,
  label,
  product,
  sends,
  enabled: kind !== "tracking_report",
  changed_at: null,
  applies: kind !== "collector_activity",
  last_send_id:
    kind === "arena_week" ? "3f2a9c1b-0000-4000-8000-000000000001" : null,
}));
const RECENT = [
  {
    send_id: "3f2a9c1b-0000-4000-8000-000000000001",
    kind: "arena_week",
    label: "Your week in the Arena",
    subject: "Your week in the Arena: Trophy Road 4–6, war 3–3",
    period: "2026-W39",
    sent_at: "2026-09-29T14:00:00Z",
    archived: true,
  },
  {
    send_id: "3f2a9c1b-0000-4000-8000-000000000002",
    kind: "clan_report",
    label: "Clan report",
    subject: "POAP KINGS, Sep 21 – 28: 1st in war, 4 left, 2 joined",
    period: "2026-W39",
    sent_at: "2026-09-28T14:00:00Z",
    archived: true,
  },
];

async function open(page: Page) {
  const puts: unknown[] = [];
  await mockApi(
    page,
    signedIn({
      "GET /api/me/email": [200, { kinds: KINDS, recent: RECENT }],
      "PUT /api/me/email": (route) => {
        const body = route.request().postDataJSON();
        puts.push(body);
        return [200, body];
      },
    }),
  );
  await page.goto("/console/account/profile/email");
  await expect(
    page.getByRole("heading", { name: "Emails from Elixir" }),
  ).toBeVisible();
  return puts;
}

test("the week, the two that come when something happens, and a switch that writes", async ({
  page,
}) => {
  const puts = await open(page);
  const week = page.getByRole("region", { name: "Your week in email" });
  await expect(week.getByText("Your week in the Arena")).toBeVisible();
  await expect(week.getByText("nothing")).toHaveCount(3);
  await expect(page.getByRole("switch", { name: "Top 100 email" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("switch", { name: "Card of the Week email" }),
  ).toHaveCount(0);
  const happens = page.getByRole("region", { name: "When something happens" });
  await expect(happens.getByText("Clan actions waiting")).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Collector activity email" }),
  ).toBeDisabled();
  await accessible(page, "emails from elixir");

  await page.getByRole("switch", { name: "Clan report email" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ kind: "clan_report", enabled: false });

  // A sent row opens that email's record.
  await page
    .getByRole("region", { name: "Sent to you" })
    .getByRole("link", { name: /Trophy Road 4–6/ })
    .click();
  await expect(page).toHaveURL(
    /\/console\/account\/activity\/e\/3f2a9c1b-0000-4000-8000-000000000001$/,
  );
});

test("@narrow the week stacks to one column and nothing scrolls sideways", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("switch", { name: "Every email" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await accessible(page, "narrow emails from elixir");
});
