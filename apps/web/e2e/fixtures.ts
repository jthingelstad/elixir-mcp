import type { Page, Route } from "@playwright/test";
import { STATUS } from "./status-fixture.ts";

/** A signed-in person with one claimed player and the signals the rail
 *  reads: a count on Tracking, an unread dot on Activity, two
 *  connections. */
export const ME = {
  authenticated: true,
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
    collections: { used: 1, limit: 3 },
    live_fetch: { used: 3, limit: 40 },
    calls: { used: 120, limit: 2000 },
  },
  signals: { connections: 2, events_unseen: 1, refusals_7d: 0, feedback: 0 },
};

export const SIGNED_OUT = { authenticated: false };

type Answer =
  [status: number, body: unknown] | ((route: Route) => [number, unknown]);

/** Route every /api/* call to a fixture. An unlisted call answers 404
 *  JSON so a page can still say "could not load" rather than hang. */
export async function mockApi(page: Page, routes: Record<string, Answer>) {
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
        days: [{ day: "2026-09-12", calls: 80, errors: 1 }],
        by_connection: [],
        by_tool: [],
      },
    ],
    "GET /api/me/clans": [200, { clans: [], home_clan: null }],
    "GET /api/me/activity": [200, { events: [] }],
    "GET /api/me/events": [200, { events: [], unseen: 1 }],
    "GET /api/me/requests": [200, { requests: [] }],
    "GET /api/me/connections": [200, { connections: [], refusals: [] }],
    "GET /api/me/principals": [200, { agents: [], addable_clans: [] }],
    "GET /api/me/gateways": [200, { gateways: [] }],
    "GET /api/me/collections": [200, { collections: [] }],
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
