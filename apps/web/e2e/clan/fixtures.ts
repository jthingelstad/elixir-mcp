import { ME as ACCOUNT, signedIn as consoleSignedIn } from "../fixtures.ts";
import type { Page, Route } from "@playwright/test";

const FIRST = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role: "leader",
  role_label: "Leader",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  player_name: "Ada",
  verified: true,
  your_tags: ["#20QQL8CCRU"],
};
const SECOND = {
  clan_tag: "#GQ08RJPL",
  name: "Second Clan",
  role: "member",
  role_label: "Member",
  acting_as: "#VLQV8C8RP",
  acting_as_name: "Ada's alt",
  player_name: "Ada's alt",
  verified: true,
  your_tags: ["#VLQV8C8RP"],
};

/** A signed-in leader of Example Clan who also holds a player in Elixir
 *  Kings, with nothing selected yet - the chooser's case. */
export const ME = {
  signed_in: true,
  ok: true,
  // A sign-in since 2026-09-25 holds clans:attest; without it every page
  // asks the person to sign in again (App.jsx canShare).
  scope: "cr:read clans:attest",
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#20QQL8CCRU", name: "Ada" },
  },
  primary: { player_tag: "#20QQL8CCRU", name: "Ada" },
  identities: [
    {
      player_tag: "#20QQL8CCRU",
      name: "Ada",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
      clan_tag: "#2PQRJ8LV",
      role: "leader",
      role_label: "Leader",
    },
  ],
  clans: [FIRST, SECOND],
  selected: null as typeof FIRST | null,
  open_actions: 2,
  // The selected clan's policy: saved, ranking Elder, tracking inactivity.
  policy: {
    set: true,
    active: true,
    members: 12,
    min_members: 10,
    version: 1,
    ranks_elder: true,
    removal: true,
    away: true,
    members_see_standing: true,
  },
};

const ROSTER = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  member_count: 3,
  type: "inviteOnly",
  required_trophies: 5000,
  clan_war_trophies: 1220,
  donations_per_week: 52,
  role_counts: { leader: 1, coLeader: 1, member: 1 },
  comings: [
    {
      type: "member_joined",
      at: "2026-09-11T11:28:00Z",
      player_tag: "#M1",
      name: "Zed",
    },
    {
      type: "week_resolved",
      at: "2026-09-07T09:38:00Z",
      season_id: 135,
      section_index: 4,
      is_colosseum: true,
      rank: 1,
      fame: 10305,
      trophy_change: 100,
    },
    {
      type: "member_left",
      at: "2026-09-05T22:13:00Z",
      player_tag: "#L",
      name: "Lu",
    },
  ],
  cached_at: "2026-09-12T17:55:00Z",
  meta: {
    freshness_seconds: 300,
    as_of: "2026-09-12T17:55:00Z",
    timezone_applied: "America/Chicago",
  },
  notes: [],
  members: [
    {
      player_tag: "#20QQL8CCRU",
      name: "Ada",
      role: "leader",
      role_label: "Leader",
      trophies: 8000,
      donations_this_week: 40,
      last_seen_in_game: "2026-09-12T17:00:00Z",
      last_recorded_battle: "2026-09-12T16:40:00Z",
      you: true,
    },
    {
      player_tag: "#UQ8LP2R9C",
      name: "Ben",
      role: "coLeader",
      role_label: "Co-leader",
      trophies: 7600,
      donations_this_week: 12,
      last_seen_in_game: "2026-09-12T15:00:00Z",
      last_recorded_battle: null,
      you: false,
    },
    {
      player_tag: "#M1",
      name: "Zed",
      role: "member",
      role_label: "Member",
      trophies: 5000,
      donations_this_week: 0,
      last_seen_in_game: "2026-09-10T15:00:00Z",
      last_recorded_battle: null,
      you: false,
    },
  ],
};

/** One of Clan's tabs: Feed, Standings, War, Members, Policy and Run. */
export const clanTab = (page: Page, name: string | RegExp) =>
  page
    .getByRole("tablist", { name: "Clan" })
    .getByRole("tab", { name, exact: typeof name === "string" });

type Answer =
  [status: number, body: unknown] | ((route: Route) => [number, unknown]);

/** Route every /api/* call (Clan's are /api/clan/*, sign-in included)
 *  to a fixture. An unlisted call answers 404 JSON so a page can say
 *  "could not load" rather than hang. */
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

/** The clan's last seven days, as the Feed reads them. */
const FEED = {
  clan_tag: "#2PQRJ8LV",
  window_days: 7,
  more: 0,
  items: [
    {
      id: "hl-1",
      kind: "battle_highlight",
      at: "2026-09-12T15:00:00Z",
      text: "Zed posted a highlight",
      words: "Three crowns with seconds left",
      battle_url: "https://elixir.test/battle/example-1",
    },
    {
      id: "join-1",
      kind: "clan_member_joined",
      at: "2026-09-11T09:00:00Z",
      text: "Dee joined Example Clan",
    },
  ],
};

/** Signed in, with the reads the tabs' pages make. `select` is stateful:
 *  picking a clan changes what /api/clan/me answers, as the Lambda does. */
export function signedIn(
  overrides: Record<string, Answer> = {},
  { policy = ME.policy }: { policy?: Record<string, unknown> } = {},
): Record<string, Answer> {
  let me = { ...ME, policy };
  return {
    ...consoleSignedIn(),
    "GET /api/me": [
      200,
      {
        ...ACCOUNT,
        claims: [
          { ...ACCOUNT.claims[0], player_tag: "#20QQL8CCRU", name: "Ada" },
        ],
      },
    ],
    "GET /api/clan/me": () => [200, me],
    "POST /api/clan/select": (route) => {
      const { clan_tag } = route.request().postDataJSON();
      me = {
        ...me,
        selected: me.clans.find((c) => c.clan_tag === clan_tag) ?? null,
      };
      return [200, me];
    },
    "GET /api/clan/roster": [200, ROSTER],
    "GET /api/clan/clans/2PQRJ8LV/standing": [
      200,
      {
        as_of: "2026-09-12T17:55:00Z",
        freshness_seconds: 300,
        policy_version: 1,
        ranks_elder: true,
        weights: [
          { key: "war", label: "Clan Wars", share: 0.55 },
          { key: "donations", label: "Donations", share: 0.3 },
          { key: "ranked", label: "Ranked play", share: 0.15 },
        ],
        how: [
          {
            key: "elder",
            title: "Elder",
            lines: [
              "Elder is earned by participation, compared across the clan's members and Elders: Clan Wars 55%, Donations 30% and Ranked play 15%.",
            ],
          },
        ],
        rows: [
          {
            player_tag: "#C1",
            name: "Cy",
            role: "elder",
            status: "holding",
            evidence: "100% war decks over 3 war weeks",
            war: [
              { season_id: 135, section_index: 4, decks: 16, decks_asked: 16 },
              { season_id: 136, section_index: 0, decks: 12, decks_asked: 12 },
              { season_id: 136, section_index: 1, decks: 16, decks_asked: 16 },
            ],
          },
          {
            player_tag: "#M1",
            name: "Zed",
            role: "member",
            status: "rising",
            evidence: "90% war decks over 3 war weeks",
            war: [
              { season_id: 135, section_index: 4, decks: 12, decks_asked: 16 },
              { season_id: 136, section_index: 0, decks: 12, decks_asked: 12 },
              { season_id: 136, section_index: 1, decks: 16, decks_asked: 16 },
            ],
          },
          {
            player_tag: "#D1",
            name: "Dee",
            role: "member",
            status: "quiet",
            evidence: "",
            war: [
              { season_id: 135, section_index: 4, decks: 0, decks_asked: 16 },
              { season_id: 136, section_index: 0, decks: 4, decks_asked: 12 },
              { season_id: 136, section_index: 1, decks: 0, decks_asked: 16 },
            ],
          },
        ],
        you: {
          status: null,
          evidence: "100% war decks over 3 war weeks",
          war: [
            { season_id: 135, section_index: 4, decks: 16, decks_asked: 16 },
            { season_id: 136, section_index: 0, decks: 12, decks_asked: 12 },
            { season_id: 136, section_index: 1, decks: 16, decks_asked: 16 },
          ],
          next: [],
          inactivity: null,
        },
      },
    ],
    // Feedback is Elixir's one record (2026-10-08): Clan files through
    // the shared door, with the shared session.
    "POST /api/feedback": [200, { ok: true, feedback_id: 41 }],
    "GET /api/clan/clans/2PQRJ8LV/me/away": [200, { away: null }],
    // The Feed's timeline and Run's one question (slice 8, #766).
    "GET /api/clan/clans/2PQRJ8LV/feed": [200, FEED],
    "GET /api/clan/clans/2PQRJ8LV/run": [
      200,
      { clan_tag: "#2PQRJ8LV", run: true },
    ],
    ...overrides,
  };
}
