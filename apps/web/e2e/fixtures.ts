import { expect, type Page, type Route } from "@playwright/test";
import { STATUS } from "./status-fixture.ts";

/** A signed-in person with one claimed player and the signals the rail
 *  reads: a count on Tracking, an unread dot on Timeline (one item
 *  pending, and the fixture timeline's one item past a null read_to),
 *  two connections. */
export const ME = {
  authenticated: true,
  features: { clan_internal: true },
  is_admin: false,
  is_owner: false,
  role: "leader",
  email: "jamie@example.com",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
    },
  ],
  recordings: [
    {
      subject_tag: "#20JJJ2CCRU",
      kind: "player",
      last_success_at: "2026-09-12T14:59:00.000Z",
    },
  ],
  entitlements: {
    activity_clans: { used: 0, limit: 1 },
    comprehensive_clans: { used: 0, limit: 0 },
    live_fetch: { used: 3, limit: 40 },
    calls: { used: 120, limit: 2000 },
  },
  signals: {
    connections: 2,
    timeline_pending: 1,
    refusals_7d: 0,
    feedback: 0,
    // What this account tracks: the rail's Tracking count (2026-09-23).
    tracking: 1,
  },
};

export const SIGNED_OUT = {
  authenticated: false,
  features: { clan_internal: true },
};

type Answer =
  [status: number, body: unknown] | ((route: Route) => [number, unknown]);

/** The token the stand-in Turnstile gives every sign-in form. */
export const TURNSTILE_TOKEN = "e2e-turnstile-token";

/** Cloudflare's Turnstile script, never fetched: a stand-in that renders
 *  nothing and answers every widget with TURNSTILE_TOKEN, then calls the
 *  page's onload as the real one does (src/turnstile.js). */
async function stubTurnstile(page: Page) {
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js*",
    async (route) => {
      const onload = new URL(route.request().url()).searchParams.get("onload");
      await route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: `window.turnstile = {
  render(el, o) { setTimeout(() => o.callback(${JSON.stringify(TURNSTILE_TOKEN)}), 0); return "e2e"; },
  reset() {}, remove() {},
};
${onload ? `window[${JSON.stringify(onload)}]();` : ""}`,
      });
    },
  );
}

/** Route every /api/* call to a fixture. An unlisted call answers 404
 *  JSON so a page can still say "could not load" rather than hang.
 *  Turnstile's script is stubbed with it. */
export async function mockApi(page: Page, routes: Record<string, Answer>) {
  await stubTurnstile(page);
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    const answer =
      routes[key] ?? routes[`${req.method()} ${url.pathname}${url.search}`];
    const [status, body] =
      typeof answer === "function"
        ? answer(route)
        : (answer ?? [404, { error: "unmocked", key }]);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** The console signed in, with every read the rail's pages make. */
export function signedIn(
  overrides: Record<string, Answer> = {},
): Record<string, Answer> {
  return {
    "GET /api/me": [200, ME],
    "GET /api/me/first-answer": [200, {}],
    "GET /api/me/usage": [
      200,
      {
        quota: {
          calls: { used: 120, limit: 2000 },
          live_fetch: { used: 3, limit: 40 },
        },
        resets_at: "2026-09-14T00:00:00Z",
        today_calls: 120,
        quota_max: 2000,
        live_today: 3,
        live_max: 40,
        days: [{ day: "2026-09-12", calls: 80, errors: 1 }],
        by_connection: [],
        by_tool: [],
      },
    ],
    "GET /api/me/clans": [200, { clans: [], home_clan: null }],
    "GET /api/me/activity": [200, { events: [] }],
    "GET /api/me/timeline": [
      200,
      {
        timeline: [
          {
            at: "2026-09-12T15:00:00Z",
            subject_tag: "#20JJJ2CCRU",
            subject_name: "King Thing",
            kind: "battle_session",
            section: "battles",
            text: "Played a battle session.",
            facts: { battles: 3 },
          },
        ],
        read_to: null,
      },
    ],
    "GET /api/me/requests": [200, { requests: [] }],
    "GET /api/me/connections": [200, { connections: [], refusals: [] }],
    "GET /api/me/principals": [200, { agents: [], addable_clans: [] }],
    "GET /api/me/gateways": [200, { gateways: [] }],
    "GET /api/me/feedback": [200, { feedback: [] }],
    "GET /api/me/verify": [200, { players: [] }],
    "GET /api/me/sessions": [
      200,
      { sessions: [{ id: "s1", current: true, from: "here" }] },
    ],
    "GET /api/public/status": [200, STATUS],
    "GET /api/public/stats": [
      200,
      { totals: { battles: 5861, players: 40, clans: 2 } },
    ],
    "GET /api/me/battle-activity/20JJJ2CCRU": [
      200,
      { computed_at: "2026-09-12T15:00:00Z", days: [], rhythm: [] },
    ],
    ...overrides,
  };
}

/** Wide, the rail stays in view as a long page scrolls (2026-10-20): its
 *  contents stick to the top of the window, so the foot is in reach at
 *  the bottom of the page as at the top. */
export async function railStaysInView(page: Page) {
  const foot = page
    .locator(".rail")
    .getByRole("button", { name: "Send feedback", exact: true });
  await expect(foot).toBeInViewport();
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  // The page must be long enough for this to say anything.
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(200);
  await expect(foot).toBeInViewport();
  const top = await page
    .locator(".rail__pin")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThanOrEqual(1);
}
