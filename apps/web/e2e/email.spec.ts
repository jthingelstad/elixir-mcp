import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

/** Account › Emails from Elixir, the emails board (2026-10-02):
 *  each kind with its local schedule, the kinds that come when
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
    ["tracking_report", "Your digest", "Home", at("Wednesday")],
    ["collector_activity", "Collector activity", "Collectors", at("Sunday")],
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
    kind === "tracking_report" ? "3f2a9c1b-0000-4000-8000-000000000001" : null,
}));
const RECENT = [
  {
    send_id: "3f2a9c1b-0000-4000-8000-000000000001",
    kind: "tracking_report",
    label: "Your digest",
    subject: "Your week: 4 people you follow played",
    period: "2026-W39",
    sent_at: "2026-09-30T14:00:00Z",
    archived: true,
  },
  {
    send_id: "3f2a9c1b-0000-4000-8000-000000000002",
    kind: "collector_activity",
    label: "Collector activity",
    subject: "Collector activity: 1,204 battles recorded",
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
  await page.goto("/settings/emails");
  await expect(
    page.getByRole("heading", { name: "Emails", exact: true }),
  ).toBeVisible();
  return puts;
}

test("scheduled and event-driven mail, with a switch that writes", async ({
  page,
}) => {
  const puts = await open(page);
  const week = page.getByRole("region", { name: "Scheduled" });
  await expect(week.getByText("Your digest")).toBeVisible();
  await expect(week.getByRole("listitem")).toHaveCount(2);
  // The clan report, Arena week and milestones ended (2026-11-12).
  await expect(
    page.getByRole("switch", { name: "Clan report email" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Milestones email" }),
  ).toHaveCount(0);
  await expect(week.getByText("nothing")).toHaveCount(0);
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

  await page
    .getByRole("switch", { name: "Clan actions waiting email" })
    .click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ kind: "clan_actions_waiting", enabled: false });

  // A sent row opens that email's record.
  await page
    .getByRole("region", { name: "Sent to you" })
    .getByRole("link", { name: /4 people you follow played/ })
    .click();
  await expect(page).toHaveURL(
    /\/settings\/emails\/3f2a9c1b-0000-4000-8000-000000000001$/,
  );
});

test("@narrow mail rows stack without horizontal scrolling", async ({
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
