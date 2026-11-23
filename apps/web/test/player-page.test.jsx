/**
 * The player page and Follow me links (slice 6, #764): every name opens one
 * page, the page shows game names and tags only, Follow asks first and says
 * what it costs, and a Follow me link names players and nothing else.
 * Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  configure,
  fireEvent,
  within,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
import { followPlanLine } from "../src/home/follow.jsx";
import {
  followMeHref,
  isPlayerPath,
  playerHref,
  tagsFromFollowPath,
} from "../src/lib/player.js";

configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: false,
  is_owner: false,
  role: "member",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#0GVJ9V",
      name: "Birch Lantern",
      nickname: "Private Owl",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  recordings: [],
};

const PAGE = {
  player: {
    tag: "#0VJ2QV",
    name: "Copper Fern",
    clan_tag: "#0LL2",
    clan_name: "Grove",
    trophies: 7400,
    recorded: true,
  },
  you: { own: false, following: false, relationship: null, clanmate: null },
  badges: { verified_player: true, discord: true },
  follows: { count: 1, players: [{ tag: "#00L0", name: "Umber" }] },
  followers: {
    count: 4,
    players: [
      { tag: "#0GVJ9V", name: "Birch Lantern", verified: true },
      { tag: "#0PYLQ2", name: "Cedar Moss", verified: false },
    ],
    no_player: 2,
    unnamed: 2,
  },
  window_days: 7,
  timeline: [
    {
      id: "t1",
      kind: "battle_streak",
      at: "2026-11-10T14:00:00.000Z",
      text: "Copper Fern won five in a row",
    },
  ],
  timeline_more: 0,
  moments: [],
};

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let page;
let plan;
let posted;
let pageCheers;
// The player's posts, as GET /api/me/posts?player= answers.
let pagePosts;
// Replies for the session page, in turn, when a test sets them.
let sessionReplies;
beforeEach(() => {
  cleanup();
  page = PAGE;
  pagePosts = [];
  sessionReplies = null;
  pageCheers = {};
  posted = [];
  plan = {
    clan_tag: null,
    players: [
      {
        player_tag: "#0VJ2QV",
        name: "Copper Fern",
        following: false,
        free: true,
        reason: "followed_by_others",
      },
      {
        player_tag: "#00L0",
        name: "Umber",
        following: false,
        free: false,
        reason: null,
      },
    ],
    yours: [],
    to_follow: 2,
    free: 1,
    slots: 1,
    following: 0,
    used: 3,
    limit: 50,
    fits: true,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    if (p === "/api/me") return reply(ME);
    if (p.startsWith("/api/player?")) return reply(page);
    if (p.startsWith("/api/player/session?")) {
      posted.push([p, null]);
      if (sessionReplies?.length) return sessionReplies.shift();
      const item = page.timeline[0];
      return reply({
        player: { tag: "#0VJ2QV", name: "Copper Fern" },
        you: { own: false, can_post: false },
        item,
        games: {
          item_id: item.id,
          kind: "session",
          version: "ev_1",
          count: 2,
          completeness: "recorded_sitting",
          open: false,
          order: "newest_first",
          decks: [],
          offset: 0,
          limit: 25,
          next_offset: null,
          battles: [
            {
              battle_id: "b2",
              at: "2026-11-10T14:40:00.000Z",
              mode_group: "ladder",
              outcome: "loss",
              crowns: 0,
              trophy_change: -26,
              opponents: [{ player_tag: "#00L0", name: "Umber", crowns: 1 }],
              url: "https://elixir.example/battle/aaaaaaaaaaa2",
            },
            {
              battle_id: "b1",
              at: "2026-11-10T14:00:00.000Z",
              mode_group: "ladder",
              outcome: "win",
              crowns: 3,
              trophy_change: 30,
              opponents: [{ player_tag: "#00L0", name: "Umber", crowns: 0 }],
              url: "https://elixir.example/battle/aaaaaaaaaaa1",
            },
          ],
        },
        marks: [],
      });
    }
    if (p.startsWith("/api/player/evidence?")) {
      posted.push([p, null]);
      return reply({
        kind: "session",
        observed_at: "2026-11-10T15:00:00.000Z",
        observed_at_basis: "recorded_capture",
        count: 2,
        from: "2026-11-10T14:00:00.000Z",
        through: "2026-11-10T14:40:00.000Z",
        open: false,
        completeness: "recorded_sitting",
        battles: [],
      });
    }
    if (p.startsWith("/api/me/cheers?")) return reply(pageCheers);
    if (p.startsWith("/api/me/posts?")) return reply({ posts: pagePosts });
    if (p === "/api/me/cheers" && init?.method === "PUT") {
      const body = JSON.parse(init.body);
      posted.push([p, body]);
      return reply({
        item_id: body.item_id,
        cheers: { on_fire: 2 },
        my_cheer: body.cheer,
      });
    }
    if (p.startsWith("/api/me/follow-cost"))
      return reply({
        player_tag: "#0VJ2QV",
        following: false,
        free: false,
        reason: null,
        used: 3,
        limit: 50,
      });
    if (p.startsWith("/api/me/follow-plan")) return reply(plan);
    if (p === "/api/me/tool") {
      const { tool, args } = JSON.parse(init.body);
      posted.push([p, { tool, args }]);
      if (tool === "players_summary")
        return reply({
          body: {
            player_tag: "#0VJ2QV",
            name: "Copper Fern",
            nickname: "Hidden Moss",
            last_30_days: {
              battles: 42,
              wins: 25,
              losses: 16,
              draws: 1,
              net_trophies: 118,
              capture: { captured_battles: 42, expected_battles: 44 },
            },
            top_deck: { battles: 20, archetype: { label: "Hog Rider cycle" } },
          },
        });
      if (tool === "players_profile")
        return reply({
          body: {
            player_tag: "#0VJ2QV",
            attributes: { best_trophies: 7600 },
            snapshot: {
              date: "2026-11-09",
              trophies: 7400,
              lifetime: {
                battle_count: 3100,
                wins: 1700,
                three_crown_wins: 640,
              },
            },
          },
        });
    }
    if (p === "/api/me/follow-all" || p === "/api/claims") {
      posted.push([p, JSON.parse(init.body)]);
      return reply({ ok: true, followed: [] });
    }
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());

test("one address per player, and a Follow me link carries tags only", () => {
  expect(playerHref("#0VJ2QV")).toBe("/home/player/0VJ2QV");
  expect(followMeHref(["#0VJ2QV", "#00L0"])).toBe("/home/follow/0VJ2QV,00L0");
  expect(tagsFromFollowPath("0VJ2QV,00l0,0VJ2QV")).toEqual([
    "#0VJ2QV",
    "#00L0",
  ]);
  expect(tagsFromFollowPath("0VJ2QV,<b>")).toBeNull();
  expect(tagsFromFollowPath("")).toBeNull();
  expect(isPlayerPath("/home/player/0VJ2QV")).toBe(true);
  expect(isPlayerPath("/home/follow/0VJ2QV,00L0")).toBe(true);
  expect(isPlayerPath("/home/friends")).toBe(false);
});

test("a plan in words: free, slots, and a refusal that says why", () => {
  expect(followPlanLine(plan)).toBe("2 players · uses 1 of your 50 follows");
  expect(followPlanLine({ ...plan, slots: 2, used: 49, fits: false })).toMatch(
    /Only 1 of your 50 player slots are left, so nobody would be followed\./,
  );
  expect(followPlanLine({ ...plan, to_follow: 0, following: 2 })).toBe(
    "You already follow every one of them.",
  );
});

test(
  "the page: name, badges, counts, follows and followers by game name, no nickname",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    // The first render waits on the lazy route chunk, which under a full
    // parallel test run takes longer than findBy's 1 s default.
    await screen.findByRole(
      "heading",
      { level: 1, name: /Copper Fern\s*Verified player/ },
      { timeout: 10_000 },
    );
    expect(screen.getByText("Verified player")).toBeTruthy();
    expect(screen.getByText("Verified in Discord")).toBeTruthy();
    // The counts are buttons to their tabs (canvas .statrow).
    expect(screen.getByRole("button", { name: "Following 1" })).toBeTruthy();
    // A post about a battle is a post (0292): no Highlights count or tab.
    expect(screen.queryByRole("button", { name: /^Highlights/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Highlights/ })).toBeNull();
    expect(screen.getByText("Copper Fern won five in a row")).toBeTruthy();
    // Explore folded into the page (2026-11-12): no link out to it.
    expect(screen.queryByRole("link", { name: "Full record" })).toBeNull();
    expect(document.querySelector('a[href^="/console"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Followers 4" }));
    expect(
      screen
        .getByRole("tab", { name: /Follows/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    const follower = await screen.findByRole("link", {
      name: /Birch Lantern/,
    });
    expect(follower.getAttribute("href")).toBe("/home/player/0GVJ9V");
    // An unverified follower is the player they claim, said plainly as not
    // verified, with no gold mark and no profile image.
    const claimed = await screen.findByRole("link", { name: /Cedar Moss/ });
    expect(claimed.getAttribute("href")).toBe("/home/player/0PYLQ2");
    expect(claimed.textContent).toContain("Not verified");
    expect(claimed.querySelector(".kit-verified")).toBeNull();
    expect(claimed.querySelector(".kit-av--verified")).toBeNull();
    // Accounts with no player are Elixir accounts, nothing more, no link.
    const accounts = screen.getByText("2 Elixir accounts");
    expect(accounts.closest("a")).toBeNull();
    expect(screen.getByText("No player added yet")).toBeTruthy();
    expect(screen.queryByText(/counted, not named/)).toBeNull();
    // The top bar names the reader as they named themselves; the page never.
    expect(document.querySelector("main").textContent).not.toContain(
      "Private Owl",
    );
  },
);

test(
  "a sitting draws as Home draws it, and its line opens the session's own page",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      timeline: [
        {
          id: "s1",
          kind: "battle_session",
          at: "2026-11-10T14:00:00.000Z",
          text: "Copper Fern played two battles",
          subjects: [{ kind: "player", tag: "#0VJ2QV", name: "Copper Fern" }],
          facts: {
            battles: 2,
            won: 1,
            lost: 1,
            trophy_net: 4,
            by_mode: { ladder: 2 },
            decks: [{ label: "Hog Rider cycle", battles: 2 }],
            started_at: "2026-11-10T14:00:00.000Z",
            ended_at: "2026-11-10T14:40:00.000Z",
          },
          spark: [
            { r: "w", m: 3 },
            { r: "l", m: 1 },
          ],
          evidence: { kind: "session", version: "ev_1", count: 2 },
        },
      ],
    };
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    // Drawn by the Timeline's own rows (2026-11-23): two battles on Trophy
    // Road is a short session, one line whose words are its facts; the
    // timeline's sentence is not repeated on it.
    const card = await screen.findByRole("link", {
      name: "Open Copper Fern’s session: Won 1 of 2 on Trophy Road, lost 1, +4 trophies",
    });
    expect(screen.queryByText("Copper Fern played two battles")).toBeNull();
    expect(card.getAttribute("href")).toBe(
      "/home/player/0VJ2QV/session/s1?at=2026-11-10T14%3A00%3A00.000Z",
    );
    // The result and its trophies on one line, no figures and no strip.
    expect(card.querySelector(".kit-sfacts, .kit-spark")).toBeNull();
    expect(card.textContent).toContain("Won 1 of 2 on Trophy Road +4 trophies");
    expect(screen.queryByRole("button", { name: "Open session" })).toBeNull();

    fireEvent.click(card);
    await screen.findByRole("heading", {
      level: 1,
      name: "Won 1 of 2 on Trophy Road",
    });
    expect(posted[0][0]).toBe(
      "/api/player/session?tag=%230VJ2QV&id=s1&at=2026-11-10T14%3A00%3A00.000Z",
    );
    // Each game: its result, score, opponent's page, and its battle page.
    const rows = document.querySelectorAll(".kit-sgame");
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain("Three crowns");
    expect(
      within(rows[0]).getByRole("link", { name: "Umber" }).getAttribute("href"),
    ).toBe("/home/player/00L0");
    expect(
      within(rows[0])
        .getByRole("link", { name: /^Battle/ })
        .getAttribute("href"),
    ).toBe("/battle/aaaaaaaaaaa2");
    // Not the reader's own player: no Highlight.
    expect(screen.queryByRole("link", { name: /^Highlight/ })).toBeNull();
    expect(document.title).toBe("Session - Timeline - Elixir");
  },
);

test(
  "a session page reads again after its games changed, and counts two decks of one archetype apart",
  { timeout: 20000 },
  async () => {
    const card = (key) => ({ key, name: `Card ${key}`, cost: 3 });
    const hogA = {
      label: "Hog Rider cycle",
      cards: [1, 2, 3, 4, 5, 6, 7, 8].map(card),
    };
    const hogB = {
      label: "Hog Rider cycle",
      cards: [1, 2, 3, 4, 5, 6, 7, 9].map(card),
    };
    const item = {
      id: "s3",
      kind: "battle_session",
      at: "2026-11-10T14:00:00.000Z",
      text: "Copper Fern played three battles",
      facts: {
        battles: 3,
        won: 3,
        lost: 0,
        by_mode: { ladder: 3 },
        decks: [{ label: "Hog Rider cycle", battles: 3 }],
        started_at: "2026-11-10T14:00:00.000Z",
        ended_at: "2026-11-10T14:40:00.000Z",
      },
      evidence: { kind: "session", version: "ev_2", count: 3 },
    };
    const battle = (n, deck) => ({
      battle_id: `b${n}`,
      at: `2026-11-10T14:${10 * n}:00.000Z`,
      mode_group: "ladder",
      outcome: "win",
      crowns: 1,
      trophy_change: 30,
      opponents: [{ player_tag: "#00L0", name: "Umber", crowns: 0 }],
      deck,
    });
    sessionReplies = [
      // A battle landed after the page was read.
      reply({ error: "evidence_changed" }, 409),
      reply({
        player: { tag: "#0VJ2QV", name: "Copper Fern" },
        you: { own: false, can_post: false },
        item,
        games: {
          item_id: "s3",
          kind: "session",
          version: "ev_2",
          count: 3,
          completeness: "recorded_sitting",
          open: false,
          order: "newest_first",
          decks: [hogA, hogB],
          offset: 0,
          limit: 25,
          next_offset: null,
          battles: [battle(3, 0), battle(2, 0), battle(1, 1)],
        },
        marks: [],
      }),
    ];
    window.history.pushState({}, "", "/home/player/0VJ2QV/session/s3");
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Read them again" }),
    );
    // The first page is read again, not served from the cache.
    await screen.findByRole("heading", {
      level: 1,
      name: "Won 3 of 3 on Trophy Road",
    });
    expect(
      posted.filter(([q]) => q.startsWith("/api/player/session?")),
    ).toHaveLength(2);
    // The update's 3 is the archetype's; each deck says its own.
    const decks = [
      ...document.querySelectorAll(".kit-session__deck .kit-decklabel"),
    ].map((d) => d.textContent);
    expect(decks).toEqual([
      "Hog Rider cycle · 2 battles",
      "Hog Rider cycle · 1 battle",
    ]);
  },
);

test(
  "Follow asks first and says what it costs",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByRole("heading", {
      level: 1,
      name: /Copper Fern\s*Verified player/,
    });
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Follow Copper Fern?",
      hidden: true,
    });
    await within(dialog).findByText("Uses 1 of your 50 follows · 3 used");
    expect(posted).toEqual([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Follow", hidden: true }),
    );
    await waitFor(() =>
      expect(posted).toEqual([
        ["/api/claims", { player_tag: "#0VJ2QV", relationship: "friend" }],
      ]),
    );
  },
);

test(
  "Following leads the head and offers Unfollow, asked first; Their stats is second",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      you: {
        own: false,
        following: true,
        relationship: "friend",
        connection: "friend",
        clanmate: null,
      },
    };
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByRole("heading", {
      level: 1,
      name: /Copper Fern\s*Verified player/,
    });
    const head = screen.getByRole("navigation", {
      name: "More about this player",
    });
    // Two actions at most: Following, then Their stats. Follow everyone
    // in their clan is on the Follows tab. The close-friend star beside
    // Following (2026-11-16) is a mark, not an action, and only yours.
    expect(
      [...head.querySelectorAll("a, button")]
        .filter((b) => !b.classList.contains("kit-close"))
        .map((b) => b.textContent.trim()),
    ).toEqual(["Following", "Their stats"]);
    expect(
      within(head)
        .getByRole("button", {
          name: "Mark Copper Fern a close friend",
        })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(within(head).getByRole("button", { name: "Following" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Unfollow Copper Fern?",
      hidden: true,
    });
    expect(posted).toEqual([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Unfollow", hidden: true }),
    );
    await waitFor(() =>
      expect(posted).toEqual([
        ["/api/claims", { player_tag: "#0VJ2QV", action: "remove" }],
      ]),
    );
  },
);

test(
  "Follow everyone in their clan is on the Follows tab, not the head",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/0VJ2QV?tab=follows");
    render(<App />);
    await screen.findByRole("heading", {
      level: 1,
      name: /Copper Fern\s*Verified player/,
    });
    const head = screen.getByRole("navigation", {
      name: "More about this player",
    });
    expect(within(head).queryByRole("button", { name: /everyone/ })).toBeNull();
    expect(await screen.findByText("Everyone in Grove")).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", { name: "Follow everyone" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Follow everyone in Grove?",
        hidden: true,
      }),
    ).toBeTruthy();
  },
);

test(
  "a clanmate can become and stop being a friend without removing the clan connection",
  { timeout: 20000 },
  async () => {
    const clanmate = {
      own: false,
      following: false,
      relationship: null,
      connection: "clanmate",
      clanmate: "#0LL2",
      shared_clan: { clan_tag: "#0LL2", name: "Grove" },
      pair: false,
      close: false,
    };
    page = { ...PAGE, you: clanmate };
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (path, init) => {
      if (String(path) === "/api/claims" && init?.body) {
        const body = JSON.parse(init.body);
        const friend = body.action !== "remove";
        page = {
          ...page,
          you: {
            ...clanmate,
            following: friend,
            relationship: friend ? "friend" : null,
            connection: friend ? "friend" : "clanmate",
            pair: friend,
          },
        };
      }
      return originalFetch(path, init);
    });
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByRole("heading", {
      name: /Copper Fern\s*Verified player/,
    });
    const head = screen.getByRole("navigation", {
      name: "More about this player",
    });
    expect(screen.getByText("Clanmate", { exact: true })).toBeTruthy();
    expect(screen.getByText(/Clanmates connect automatically/)).toBeTruthy();
    expect(
      within(head).queryByRole("button", { name: /close friend/ }),
    ).toBeNull();
    expect(
      within(head).queryByRole("link", { name: "Their stats" }),
    ).toBeNull();
    fireEvent.click(
      within(head).getByRole("button", { name: "Friend", exact: true }),
    );
    const add = await screen.findByRole("dialog", {
      name: "Friend Copper Fern?",
      hidden: true,
    });
    fireEvent.click(
      within(add).getByRole("button", {
        name: "Friend",
        exact: true,
        hidden: true,
      }),
    );
    await within(head).findByRole("button", {
      name: "Mark Copper Fern a close friend",
    });
    expect(
      document
        .querySelector(".kit-clanmate-connection .kit-badge")
        .textContent.trim(),
    ).toBe("Friend");
    expect(
      within(head).getByRole("link", { name: "Their stats" }),
    ).toBeTruthy();
    fireEvent.click(
      within(head).getByRole("button", { name: "Friend", exact: true }),
    );
    const remove = await screen.findByRole("dialog", {
      name: "Unfriend Copper Fern?",
      hidden: true,
    });
    expect(remove.textContent).toContain("clanmate connection stays");
    fireEvent.click(
      within(remove).getByRole("button", {
        name: "Unfriend",
        exact: true,
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(
        within(head).queryByRole("button", { name: /close friend/ }),
      ).toBeNull(),
    );
    expect(screen.getByText("Clanmate", { exact: true })).toBeTruthy();
    expect(
      document
        .querySelector(".kit-clanmate-connection .kit-badge")
        .textContent.trim(),
    ).toBe("Clanmate");
    expect(
      within(head).getByRole("button", { name: "Friend", exact: true }),
    ).toBeTruthy();
    expect(posted).toEqual([
      ["/api/claims", { player_tag: "#0VJ2QV", relationship: "friend" }],
      ["/api/claims", { player_tag: "#0VJ2QV", action: "remove" }],
    ]);
  },
);

test.each([
  ["stale identity", "#0LL2", "Stale Clan"],
  ["no identity clan", null, null],
])(
  "the shared-clan door uses canonical membership with %s",
  async (_, tag, name) => {
    page = {
      ...PAGE,
      player: { ...PAGE.player, clan_tag: tag, clan_name: name },
      you: {
        ...PAGE.you,
        connection: "clanmate",
        clanmate: "#0U082URG",
        shared_clan: { clan_tag: "#0U082URG", name: "Willow Guild" },
      },
    };
    window.history.pushState({}, "", "/home/player/0VJ2QV?tab=follows");
    render(<App />);
    const open = await screen.findByRole("link", { name: "Open your clan" });
    expect(open.getAttribute("href")).toBe("/clan/0U082URG");
    expect(open.closest(".kit-pfollows__clan").textContent).toContain(
      "Willow Guild",
    );
    expect(document.querySelector(".kit-phead__line").textContent).toContain(
      "Willow Guild",
    );
    expect(document.querySelector(".kit-phead__line").textContent).not.toMatch(
      /No clan|Stale Clan/,
    );
    expect(screen.queryByRole("tab", { name: "Clan", exact: true })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Follow everyone" }),
    ).toBeNull();
  },
);

test(
  "a player no account verified has no follows to show",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      badges: { verified_player: false, discord: false },
      follows: null,
      followers: null,
    };
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByRole("heading", {
      level: 1,
      name: "Copper Fern",
    });
    expect(screen.queryByText("Verified player")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Follows/ }));
    expect(
      await screen.findByText(/No account has verified this player/),
    ).toBeTruthy();
  },
);

test(
  "a Follow me link signed in: each player, its cost, and one Follow for all",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/follow/0VJ2QV,00L0");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Follow in Elixir" });
    expect(
      screen.getByRole("link", { name: "Copper Fern" }).getAttribute("href"),
    ).toBe("/home/player/0VJ2QV");
    expect(screen.getByText("Uses 1 of your 50 follows · 3 used")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Follow all 2" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Follow all 2 players?",
      hidden: true,
    });
    expect(
      within(dialog).getByText("2 players · uses 1 of your 50 follows"),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Follow everyone",
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(posted).toEqual([
        ["/api/me/follow-all", { player_tags: ["#0VJ2QV", "#00L0"] }],
      ]),
    );
  },
);

test(
  "cheers on the page: only on an item in your own feed, sent with its follows",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      timeline: [
        ...PAGE.timeline,
        {
          id: "t2",
          kind: "pol_league_up",
          at: "2026-10-20T14:00:00.000Z",
          text: "Copper Fern reached Path of Legends",
        },
      ],
    };
    pageCheers = {
      items: [{ id: "t1", cheers: { on_fire: 1 }, my_cheer: null }],
      subjects: ["#0LL2"],
    };
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByText("Copper Fern reached Path of Legends");
    const cheer = await screen.findByRole("button", { name: /^Cheer(ed)?: / });
    // One item in your feed, one Cheer: the older item has none, and no
    // counts.
    expect(
      screen.getAllByRole("button", { name: /^Cheer(ed)?: / }),
    ).toHaveLength(1);
    // Counts only, in the button's description (never who, and no words
    // beside the glyph).
    expect(
      document.getElementById(cheer.getAttribute("aria-describedby"))
        .textContent,
    ).toMatch(/\b1 person\./);
    expect(cheer.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Choose a cheer" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Cheer with" })).getByRole(
        "button",
        { name: "Royal" },
      ),
    );
    await waitFor(() =>
      expect(posted).toContainEqual([
        "/api/me/cheers",
        { item_id: "t1", cheer: "royal", subjects: ["#0LL2"] },
      ]),
    );
  },
);

test(
  "no cheers on the page when nothing on it is in your feed",
  { timeout: 20000 },
  async () => {
    pageCheers = { items: [], subjects: [] };
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByText("Copper Fern won five in a row");
    expect(screen.queryByRole("button", { name: /^Cheer(ed)?: / })).toBeNull();
  },
);

test(
  "the Record tab: the last 30 days and the profile, read only when opened, no nickname",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    await screen.findByText("Copper Fern won five in a row");
    expect(posted.some(([p]) => p === "/api/me/tool")).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: /Record/ }));
    await screen.findByText("Hog Rider cycle");
    expect(screen.getByText("25 won, 16 lost, 1 drawn")).toBeTruthy();
    expect(screen.getByText("+118")).toBeTruthy();
    expect(screen.getByText("7,600")).toBeTruthy();
    expect(screen.getByText("3,100")).toBeTruthy();
    expect(screen.getByText(/42 of about 44 battles/)).toBeTruthy();
    expect(
      posted
        .filter(([p]) => p === "/api/me/tool")
        .map(([, b]) => b.tool)
        .sort(),
    ).toEqual(["players_profile", "players_summary"]);
    expect(posted.find(([p]) => p === "/api/me/tool")[1].args.player_tag).toBe(
      "#0VJ2QV",
    );
    expect(document.body.textContent).not.toContain("Hidden Moss");
  },
);

test("?tab=record opens the Record tab", { timeout: 20000 }, async () => {
  window.history.pushState({}, "", "/home/player/0VJ2QV?tab=record");
  render(<App />);
  await screen.findByText("Hog Rider cycle");
  expect(
    screen.getByRole("tab", { name: /Record/ }).getAttribute("aria-selected"),
  ).toBe("true");
});

test(
  "?tab=together opens your games with a player you do not follow, its tab counting them",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      you: { ...PAGE.you, pair: true, pair_games: 3 },
    };
    const real = global.fetch;
    global.fetch = vi.fn(async (path, init) => {
      if (String(path).startsWith("/api/me/player-pair?"))
        return reply(
          new URL(String(path), "https://elixir.test").searchParams.has("side")
            ? { battles: [], next_before: null }
            : {
                state: "ready",
                selected_player: "#0GVJ9V",
                own_players: [{ tag: "#0GVJ9V", name: "Birch Lantern" }],
                modes: [
                  {
                    key: "ladder",
                    teamed: 0,
                    against: 3,
                    against_record: { wins: 2, losses: 1 },
                  },
                ],
              },
        );
      return real(path, init);
    });
    window.history.pushState({}, "", "/home/player/0VJ2QV?tab=together");
    render(<App />);
    const tab = await screen.findByRole("tab", { name: /Together/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.textContent).toBe("Together 3 games");
    const panel = (await screen.findByText("Your games together")).closest(
      ".kit-panel",
    );
    expect(panel.textContent).toContain("You played each other 3 times");
    expect(panel.textContent).not.toMatch(/friend|follow/i);
    // Not followed: Follow is still offered beside it.
    expect(
      within(
        screen.getByRole("navigation", { name: "More about this player" }),
      ).getByRole("button", { name: /Follow/ }),
    ).toBeTruthy();
  },
);

test(
  "no games and no follow: no Together tab, and ?tab=together opens the Timeline",
  { timeout: 20000 },
  async () => {
    page = { ...PAGE, you: { ...PAGE.you, pair: false, pair_games: 0 } };
    window.history.pushState({}, "", "/home/player/0VJ2QV?tab=together");
    render(<App />);
    const timeline = await screen.findByRole("tab", { name: /Timeline/ });
    expect(timeline.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: /Together/ })).toBeNull();
  },
);

test(
  "a followed friend with no games yet keeps a Together tab, with no count",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      you: {
        ...PAGE.you,
        following: true,
        relationship: "friend",
        pair: true,
        pair_games: 0,
      },
    };
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    const tab = await screen.findByRole("tab", { name: /Together/ });
    expect(tab.textContent).toBe("Together");
  },
);

test(
  "the Record tab: not recorded is an absent half, a failed read is an error with a retry",
  { timeout: 20000 },
  async () => {
    const real = global.fetch;
    let fail = "query_timeout";
    global.fetch = vi.fn(async (path, init) => {
      if (String(path) === "/api/me/tool") {
        const { tool } = JSON.parse(init.body);
        if (tool === "players_summary")
          return reply({ is_error: true, body: { error: { code: fail } } });
      }
      return real(path, init);
    });
    window.history.pushState({}, "", "/home/player/0VJ2QV?tab=record");
    render(<App />);
    await screen.findByText("This record could not be read just now");
    expect(screen.queryByText(/No battles recorded/)).toBeNull();
    fail = "not_recorded";
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await screen.findByText("No battles recorded in the last 30 days.");
    expect(screen.getByText("7,600")).toBeTruthy();
  },
);

test(
  "a player's posts about battles are on the Timeline tab, and an old Highlights address opens it",
  { timeout: 20000 },
  async () => {
    pagePosts = [
      {
        id: "tl_00000000000000000071",
        kind: "post",
        at: "2026-11-10T14:05:00.000Z",
        sort_at: "2026-11-10T14:05:00.000Z",
        subject_tag: "#0VJ2QV",
        subjects: [{ kind: "player", tag: "#0VJ2QV", name: "Copper Fern" }],
        text: "Copper Fern posted.",
        comments: { count: 0, latest: [], open: false },
        post: {
          id: "71",
          text: "Three crowns at last",
          author: { player_tag: "#0VJ2QV", name: "Copper Fern" },
          battle: {
            battle_id: "aaaaaaaaaaa1",
            url: "https://elixir.example/battle/aaaaaaaaaaa1",
            mode_group: "ladder",
            outcome: "win",
            crowns: 3,
            crowns_against: 0,
            opponents: [{ name: "Umber" }],
          },
        },
      },
    ];
    window.history.pushState({}, "", "/home/player/0VJ2QV?tab=highlights");
    render(<App />);
    const list = await screen.findByRole("region", { name: "Posts" });
    expect(within(list).getByText("Three crowns at last")).toBeTruthy();
    expect(
      within(list).getByText("A 3-0 win against Umber (Trophy Road)"),
    ).toBeTruthy();
    expect(
      within(list)
        .getByRole("link", { name: "Open battle" })
        .getAttribute("href"),
    ).toBe("/battle/aaaaaaaaaaa1");
    expect(
      screen
        .getByRole("tab", { name: /Timeline/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  },
);

test(
  "a player whose owner you blocked offers Unblock alone (Codex on #1081)",
  { timeout: 20000 },
  async () => {
    page = {
      ...PAGE,
      you: { ...PAGE.you, blocked: true },
      claimants: [
        {
          id: "pp_invented_fern",
          verified: true,
          relationship: "primary",
          player: null,
        },
      ],
    };
    const served = global.fetch;
    global.fetch = vi.fn(async (path, init) =>
      String(path) === "/api/me"
        ? reply({ ...ME, features: { comments: true } })
        : served(path, init),
    );
    window.history.pushState({}, "", "/home/player/0VJ2QV");
    render(<App />);
    const actions = await screen.findByRole(
      "navigation",
      { name: "More about this player" },
      { timeout: 10_000 },
    );
    expect(
      await within(actions).findByRole("button", { name: "Unblock" }),
    ).toBeTruthy();
    expect(
      within(actions).queryByRole("button", { name: /^Follow/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Block" })).toBeNull();
  },
);
