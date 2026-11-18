/**
 * The search sheet: every name opens the player page. Typing reads only past three letters,
 * a tag finds anyone on record, a failed read is never "no record", and Follow
 * is a click, never a keystroke.
 */
import { test, expect, vi, afterEach, describe } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { SearchSheet } from "../src/shell/SearchSheet.jsx";
import {
  beforeTyping,
  doorFor,
  playerDetail,
  isTagQuery,
  readSearch,
  readable,
  searchSources,
  typedGroups,
} from "../src/shell/search-logic.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ME = {
  claims: [
    { player_tag: "#09CV8UVL", is_primary: true, name: "Fixture Main" },
    { player_tag: "#020PJ8L", relationship: "alt", name: "Fixture Alt" },
    { player_tag: "#02PQCV", relationship: "friend", nickname: "Pal" },
  ],
};
const CLANS = {
  home_clan: { clan_tag: "#0QC8RCGY", name: "Example Clan" },
  clans: [
    { clan_tag: "#0QC8RCGY", name: "Example Clan" },
    { clan_tag: "#08L20", name: "Other Clan" },
  ],
};
const ROSTER = {
  members: [
    { player_tag: "#09CV8UVL", name: "Fixture Main", role: "member" },
    { player_tag: "#09G9U", name: "Clanmate One", role: "elder" },
    { player_tag: "#02PQCV", name: "Pal Game Name", role: "member" },
  ],
};
const CLANMATES = {
  players: ROSTER.members.map((p) => ({
    ...p,
    connection:
      p.player_tag === "#09CV8UVL"
        ? "self"
        : p.player_tag === "#02PQCV"
          ? "friend"
          : "clanmate",
    clanmate: CLANS.home_clan.clan_tag,
    shared_clan: CLANS.home_clan,
    close: false,
  })),
};
const sources = (over = {}) =>
  searchSources({
    me: ME,
    clans: CLANS,
    clanmates: CLANMATES,
    cards: [],
    ...over,
  });

const CONNECTED = {
  player_tag: "#0PLUG2V9",
  name: "Willow & <Birch>",
  role: "elder",
  connection: "clanmate",
  clanmate: "#0L8P9LLJ",
  shared_clan: { clan_tag: "#0L8P9LLJ", name: "Alt's Grove" },
  close: false,
};

describe("automatic connections in global search", () => {
  test("a retained claim with no visible connection is not a local friend association", () => {
    const source = searchSources({
      me: {
        claims: [
          {
            player_tag: CONNECTED.player_tag,
            name: CONNECTED.name,
            relationship: "friend",
            connection: null,
          },
        ],
      },
    });
    expect(beforeTyping(source).some((g) => g.h === "People you follow")).toBe(
      false,
    );
  });
  test("only canonical current clanmates establish a connection, including an alt's clan", () => {
    const source = searchSources({
      me: { claims: [] },
      clans: CLANS,
      roster: ROSTER,
      clanmates: { players: [CONNECTED] },
    });
    expect(doorFor(CONNECTED.player_tag, source, CONNECTED.name)).toMatchObject(
      {
        connection: "clanmate",
        clanmate: CONNECTED.clanmate,
        d: "Alt's Grove",
      },
    );
    expect(
      beforeTyping(source)
        .find((g) => g.h === "Clanmates")
        .rows.map((r) => r.t),
    ).toEqual([CONNECTED.name]);
    const incidental = searchSources({
      me: { claims: [] },
      clans: CLANS,
      roster: ROSTER,
    });
    expect(beforeTyping(incidental).some((g) => g.h === "Clanmates")).toBe(
      false,
    );
  });
  test("a current remote result removes a stale cached Clanmate association", () => {
    const source = searchSources({
      me: { claims: [] },
      clanmates: { players: [CONNECTED] },
    });
    const groups = typedGroups("willow", source, {
      players: [
        { ...CONNECTED, connection: null, clanmate: null, shared_clan: null },
      ],
    });
    expect(groups.some((g) => g.h === "Clanmates")).toBe(false);
    expect(groups.find((g) => g.h === "Players").rows[0].connection).not.toBe(
      "clanmate",
    );
  });
  test.each([
    [false, "Friend"],
    [true, "Close friend"],
  ])(
    "the sheet renders the canonical friend state, close=%s",
    async (close, label) => {
      const fetch = vi.fn(async (path) => {
        const body =
          String(path) === "/api/me/people/clan"
            ? { players: [{ ...CONNECTED, connection: "friend", close }] }
            : {};
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      });
      vi.stubGlobal("fetch", fetch);
      const closeSheet = vi.fn();
      renderWithProviders(
        <SearchSheet me={{ claims: [] }} onClose={closeSheet} />,
      );
      const name = await screen.findByText(CONNECTED.name);
      const row = name.closest("a");
      expect(within(row).getByText(label)).toBeTruthy();
      expect(within(row).getByText("Clanmate")).toBeTruthy();
      expect(within(row).getByText("Alt's Grove")).toBeTruthy();
      expect(row.getAttribute("href")).toBe(
        `/home/player/${CONNECTED.player_tag.slice(1)}`,
      );
      expect(row.querySelector("birch")).toBeNull();
      expect(
        fetch.mock.calls.some(
          ([path, init]) =>
            String(path) === "/api/me/tool" && init?.method === "POST",
        ),
      ).toBe(false);
      fireEvent.click(row);
      expect(closeSheet).toHaveBeenCalledTimes(1);
    },
  );
  test("account-search rows carry the shared connection without losing the handle or main player's name", () => {
    const source = searchSources({ me: { claims: [] } });
    const row = typedGroups("willow", source, {
      accounts: [
        {
          id: "abcdefghjkmn",
          handle: "willow",
          player: { name: "Willow" },
          ...CONNECTED,
          connection: "friend",
          close: true,
        },
      ],
    }).find((g) => g.h === "Accounts").rows[0];
    expect(row).toMatchObject({
      t: "@willow",
      d: "Willow",
      connection: "friend",
      close: true,
      clanmate: CONNECTED.clanmate,
      href: "/home/account/abcdefghjkmn",
    });
  });
});

describe("what counts as a tag, and what is worth a read", () => {
  test("a # needs tag shape; bare text needs the game's alphabet", () => {
    expect(isTagQuery("#09cv8uvl")).toBe(true);
    expect(isTagQuery("09CV8UVL")).toBe(true);
    expect(isTagQuery("Clanmate")).toBe(false);
    expect(isTagQuery("#a b")).toBe(false);
  });
  test("two letters cost no read", () => {
    expect(readable("ab")).toBe(false);
    expect(readable("abc")).toBe(true);
    expect(readable("a".repeat(51))).toBe(false);
  });
});

describe("every name opens the player page (#764)", () => {
  test("yours, a clanmate and anyone else open the one page; the row says who they are to you", () => {
    const s = sources();
    expect(doorFor("#09CV8UVL", s)).toMatchObject({
      href: "/home/player/09CV8UVL",
      d: "You",
    });
    expect(doorFor("#09G9U", s).href).toBe("/home/player/09G9U");
    expect(doorFor("#0U0G", s).href).toBe("/home/player/0U0G");
  });
  test("a searched player's row carries tag, clan and trophies", () => {
    expect(
      playerDetail({
        player_tag: "#0U0G",
        clan_name: "Some Clan",
        trophies: 7123,
      }),
    ).toBe("#0U0G · Some Clan · 7,123 trophies");
    expect(playerDetail({ player_tag: "#0U0G", trophies: null })).toBe(
      "#0U0G · No clan",
    );
  });
  test("before typing: You, Clanmates, People you follow, Clans, each once", () => {
    const groups = beforeTyping(sources());
    expect(groups.map((g) => g.h)).toEqual([
      "You",
      "Clanmates",
      "Clans",
      "Look up",
    ]);
    // A friend who is also a clanmate is a clanmate.
    expect(groups[1].rows.map((r) => r.t)).toEqual([
      "Clanmate One",
      "Pal Game Name",
    ]);
  });
  test("what was read merges by door, so a name is never drawn twice", () => {
    const groups = typedGroups("clanmate", sources(), {
      players: [
        { player_tag: "#09G9U", label: "Clanmate One" },
        { player_tag: "#0U0G", label: "Clanmate Elsewhere" },
      ],
      clans: [],
    });
    expect(groups.map((g) => g.h)).toEqual(["Clanmates", "Players"]);
    expect(groups[1].rows.map((r) => r.t)).toEqual(["Clanmate Elsewhere"]);
  });
  test("the clan directory is a door before typing and by name (#768)", () => {
    const look = beforeTyping(sources()).find((g) => g.h === "Look up");
    expect(look.rows.map((r) => r.href)).toEqual(["/clan/directory"]);
    for (const q of ["directory", "find a clan", "join"])
      expect(
        typedGroups(q, sources())
          .flatMap((g) => g.rows)
          .map((r) => r.href),
      ).toContain("/clan/directory");
    expect(
      typedGroups("clanmate", sources())
        .flatMap((g) => g.rows)
        .map((r) => r.href),
    ).not.toContain("/clan/directory");
  });
  test("Settings pages and docs titles are found by name", () => {
    const groups = typedGroups("emails", sources());
    expect(
      groups.find((g) => g.h === "Settings").rows.map((r) => r.href),
    ).toEqual(["/settings/emails"]);
  });
  test("Admin is found by staff only, as on Settings' rail", () => {
    const settings = (me) =>
      (
        typedGroups("admin", sources({ me })).find((g) => g.h === "Settings")
          ?.rows ?? []
      ).map((r) => r.href);
    expect(settings(ME)).toEqual([]);
    expect(settings({ ...ME, is_admin: false })).toEqual([]);
    expect(settings({ ...ME, is_admin: true })).toEqual([
      "/settings/admin/accounts",
    ]);
  });
});

describe("a deck hash or a war week", () => {
  const first = (q, over) => typedGroups(q, sources(over))[0];
  test("a hash opens nothing: the deck record retired (2026-11-12)", () => {
    const hash = "ABCDEF0123456789abcdef";
    expect(readable(hash)).toBe(false);
    expect(typedGroups(`deck:${hash}`, sources())).toEqual([]);
  });
  test.each(["S135 W3", "s135w3", "135-3"])(
    "%s is the home clan's War tab on its season, for no read",
    (q) => {
      expect(readable(q)).toBe(false);
      expect(first(q).rows[0]).toMatchObject({
        t: "Season 135, week 3",
        d: "Example Clan, War",
        href: "/clan/0QC8RCGY/war/135",
      });
    },
  );
  test("with no home clan, a week opens nothing", () => {
    expect(typedGroups("S135 W3", sources({ clans: {} }))).toEqual([]);
  });
  test("a plain miss stays a miss", () => {
    expect(typedGroups("zzzz", sources())).toEqual([]);
  });
});

describe("the read", () => {
  const ok = (body) => ({ ok: true, data: { body } });
  const refused = { ok: true, data: { is_error: true, body: { error: {} } } };
  test("a tag asks the player, then the clan; the first answer ends it", async () => {
    const explore = vi.fn(async (tool) =>
      tool === "players_summary" ? refused : ok({ name: "A Clan" }),
    );
    const seen = vi.fn();
    const r = await readSearch("#0qc8rcgy", explore, seen);
    expect(explore.mock.calls.map(([t]) => t)).toEqual([
      "players_summary",
      "clans_roster",
    ]);
    expect(r.clans).toEqual([{ clan_tag: "#0QC8RCGY", name: "A Clan" }]);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  test("a tag on no record is a miss, carrying the tag", async () => {
    const r = await readSearch("#09CV8UVL", async () => refused);
    expect(r.miss).toBe("#09CV8UVL");
  });
  test("a word asks names only, one read", async () => {
    const explore = vi.fn(async () => ok({ matches: [] }));
    const r = await readSearch("nobody", explore);
    expect(explore.mock.calls).toEqual([
      ["players_search", { query: "nobody", limit: 8 }],
    ]);
    expect(r.miss).toBe(null);
  });
  test("a failed read throws: it is never reported as no record", async () => {
    await expect(
      readSearch("#09CV8UVL", async () => ({
        ok: false,
        status: 503,
        data: {},
      })),
    ).rejects.toThrow(/did not answer/);
    await expect(
      readSearch("#09CV8UVL", async () => ({
        ok: true,
        data: {
          is_error: true,
          body: { error: { code: "rate_limited", message: "Slow down." } },
        },
      })),
    ).rejects.toThrow("Slow down.");
  });
});

describe("the sheet", () => {
  const respond = (handlers = {}) => {
    const fetch = vi.fn(async (path, init = {}) => {
      const p = String(path);
      let body = {};
      if (p === "/api/me/clans") body = CLANS;
      else if (p.startsWith("/api/me/tool")) {
        const sent = init.body ? JSON.parse(init.body) : {};
        body = handlers.explore?.(sent) ?? { is_error: true, body: {} };
      } else if (p === "/api/claims") body = handlers.claim?.(init) ?? {};
      else if (p.startsWith("/api/me/follow-cost"))
        body = handlers.cost?.(p) ?? {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  const posts = (fetch, to) =>
    fetch.mock.calls.filter(
      ([p, i]) => String(p) === to && i?.method === "POST",
    );

  test("a miss offers Follow; only the click adds the friend", async () => {
    const fetch = respond({
      claim: () => ({
        player_tag: "#09CV8UVL",
        relationship: "friend",
        added: true,
      }),
    });
    renderWithProviders(<SearchSheet me={{ claims: [] }} onClose={vi.fn()} />);
    const input = screen.getByRole("searchbox", {
      name: /Search players/,
      hidden: true,
    });
    fireEvent.change(input, { target: { value: "#09CV8UVL" } });
    const follow = await screen.findByRole(
      "button",
      { name: "Follow #09CV8UVL", hidden: true },
      { timeout: 3000 },
    );
    // Typing read; it added nothing.
    expect(posts(fetch, "/api/claims")).toEqual([]);
    fireEvent.click(follow);
    await waitFor(() => expect(posts(fetch, "/api/claims")).toHaveLength(1));
    expect(JSON.parse(posts(fetch, "/api/claims")[0][1].body)).toEqual({
      player_tag: "#09CV8UVL",
      relationship: "friend",
    });
    await screen.findByText("Recording");
  });

  test("a miss says what the Follow costs before the tap (#760)", async () => {
    const fetch = respond({
      cost: () => ({
        player_tag: "#09CV8UVL",
        following: false,
        free: false,
        reason: null,
        used: 3,
        limit: 50,
      }),
    });
    renderWithProviders(<SearchSheet me={{ claims: [] }} onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: /Search players/, hidden: true }),
      { target: { value: "#09CV8UVL" } },
    );
    await screen.findByText(
      "Uses 1 of your 50 follows · 3 used",
      {},
      { timeout: 3000 },
    );
    // Asking the price is a read; nothing was added.
    expect(posts(fetch, "/api/claims")).toEqual([]);
    expect(
      fetch.mock.calls.some(([p]) =>
        String(p).startsWith("/api/me/follow-cost?player_tag=%2309CV8UVL"),
      ),
    ).toBe(true);
  });

  test("an @handle shows even when the player search fails (Codex on #1065)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => {
        const p = String(path);
        const answer = (status, body) => ({
          ok: status < 400,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        });
        if (p === "/api/accounts?q=rubyk")
          return answer(200, {
            accounts: [
              {
                id: "abcdefghjkmn",
                handle: "rubyk",
                player: { tag: "#0VRGQ2YC", name: "Ruby" },
              },
            ],
          });
        if (p.startsWith("/api/me/tool"))
          return answer(500, { message: "Elixir did not answer." });
        return answer(200, {});
      }),
    );
    renderWithProviders(<SearchSheet me={{ claims: [] }} onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: /Search players/, hidden: true }),
      { target: { value: "@rubyk" } },
    );
    const row = await screen.findByText("@rubyk", {}, { timeout: 3000 });
    expect(row.closest("a")?.getAttribute("href")).toBe(
      "/home/account/abcdefghjkmn",
    );
  });

  test("two letters read nothing, however long they sit", async () => {
    // The debounce on a faked clock: "however long" is a minute of it,
    // not a real 650 ms a loaded host could stretch or squeeze.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetch = respond();
    renderWithProviders(<SearchSheet me={{ claims: [] }} onClose={vi.fn()} />);
    const box = screen.getByRole("searchbox", {
      name: /Search players/,
      hidden: true,
    });
    // The roster is the one read of opening the sheet; typing adds none.
    const typed = () =>
      fetch.mock.calls
        .filter(([p]) => String(p).startsWith("/api/me/tool"))
        .map(([, i]) => JSON.parse(i.body).tool)
        .filter((t) => t !== "clans_roster");
    fireEvent.change(box, { target: { value: "ab" } });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(typed()).toEqual([]);
    // The same clock does carry a third letter past the debounce, so the
    // quiet above is the two-letter rule, not a clock that never moved.
    fireEvent.change(box, { target: { value: "abc" } });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(typed().length).toBeGreaterThan(0);
  });
});
