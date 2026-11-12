/**
 * The search sheet: every name opens the player page. Typing reads only past three letters,
 * a tag finds anyone on record, a failed read is never "no record", and Follow
 * is a click, never a keystroke.
 */
import { test, expect, vi, afterEach, describe } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
    { player_tag: "#2PP0V90Y", is_primary: true, name: "Fixture Main" },
    { player_tag: "#8QY8UV2", relationship: "alt", name: "Fixture Alt" },
    { player_tag: "#9GRJLC", relationship: "friend", nickname: "Pal" },
  ],
  features: { clan_internal: true },
};
const CLANS = {
  home_clan: { clan_tag: "#2PQRJ8LV", name: "Example Clan" },
  clans: [
    { clan_tag: "#2PQRJ8LV", name: "Example Clan" },
    { clan_tag: "#YY8PQ", name: "Other Clan" },
  ],
};
const ROSTER = {
  members: [
    { player_tag: "#2PP0V90Y", name: "Fixture Main", role: "member" },
    { player_tag: "#LUGGQ", name: "Clanmate One", role: "elder" },
    { player_tag: "#9GRJLC", name: "Pal Game Name", role: "member" },
  ],
};
const sources = (over = {}) =>
  searchSources({ me: ME, clans: CLANS, roster: ROSTER, cards: [], ...over });

describe("what counts as a tag, and what is worth a read", () => {
  test("a # needs tag shape; bare text needs the game's alphabet", () => {
    expect(isTagQuery("#2pp0v90y")).toBe(true);
    expect(isTagQuery("2PP0V90Y")).toBe(true);
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
    expect(doorFor("#2PP0V90Y", s)).toMatchObject({
      href: "/home/player/2PP0V90Y",
      d: "You",
    });
    expect(doorFor("#LUGGQ", s).href).toBe("/home/player/LUGGQ");
    expect(doorFor("#CCCC", s).href).toBe("/home/player/CCCC");
  });
  test("with Clan off, a clanmate still opens the player page", () => {
    const s = sources({ me: { ...ME, features: {} } });
    expect(doorFor("#LUGGQ", s).href).toBe("/home/player/LUGGQ");
  });
  test("a searched player's row carries tag, clan and trophies", () => {
    expect(
      playerDetail({
        player_tag: "#CCCC",
        clan_name: "Some Clan",
        trophies: 7123,
      }),
    ).toBe("#CCCC · Some Clan · 7,123 trophies");
    expect(playerDetail({ player_tag: "#CCCC", trophies: null })).toBe(
      "#CCCC · No clan",
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
        { player_tag: "#LUGGQ", label: "Clanmate One" },
        { player_tag: "#CCCC", label: "Clanmate Elsewhere" },
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
      "/settings/admin/requests",
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
        href: "/clan/2PQRJ8LV/war/135",
      });
    },
  );
  test("with no home clan, or no Clan, a week opens nothing", () => {
    expect(typedGroups("S135 W3", sources({ clans: {} }))).toEqual([]);
    expect(
      typedGroups("S135 W3", sources({ me: { ...ME, features: {} } })),
    ).toEqual([]);
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
    const r = await readSearch("#2pqrj8lv", explore, seen);
    expect(explore.mock.calls.map(([t]) => t)).toEqual([
      "players_summary",
      "clans_roster",
    ]);
    expect(r.clans).toEqual([{ clan_tag: "#2PQRJ8LV", name: "A Clan" }]);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  test("a tag on no record is a miss, carrying the tag", async () => {
    const r = await readSearch("#2PP0V90Y", async () => refused);
    expect(r.miss).toBe("#2PP0V90Y");
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
      readSearch("#2PP0V90Y", async () => ({
        ok: false,
        status: 503,
        data: {},
      })),
    ).rejects.toThrow(/did not answer/);
    await expect(
      readSearch("#2PP0V90Y", async () => ({
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
      else if (p.startsWith("/api/explore")) {
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
        player_tag: "#2PP0V90Y",
        relationship: "friend",
        added: true,
      }),
    });
    renderWithProviders(<SearchSheet me={{ claims: [] }} onClose={vi.fn()} />);
    const input = screen.getByRole("searchbox", {
      name: /Search players/,
      hidden: true,
    });
    fireEvent.change(input, { target: { value: "#2PP0V90Y" } });
    const follow = await screen.findByRole(
      "button",
      { name: "Follow #2PP0V90Y", hidden: true },
      { timeout: 3000 },
    );
    // Typing read; it added nothing.
    expect(posts(fetch, "/api/claims")).toEqual([]);
    fireEvent.click(follow);
    await waitFor(() => expect(posts(fetch, "/api/claims")).toHaveLength(1));
    expect(JSON.parse(posts(fetch, "/api/claims")[0][1].body)).toEqual({
      player_tag: "#2PP0V90Y",
      relationship: "friend",
    });
    await screen.findByText("Recording");
  });

  test("a miss says what the Follow costs before the tap (#760)", async () => {
    const fetch = respond({
      cost: () => ({
        player_tag: "#2PP0V90Y",
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
      { target: { value: "#2PP0V90Y" } },
    );
    await screen.findByText(
      "Uses 1 of your 50 player slots · 3 used",
      {},
      { timeout: 3000 },
    );
    // Asking the price is a read; nothing was added.
    expect(posts(fetch, "/api/claims")).toEqual([]);
    expect(
      fetch.mock.calls.some(([p]) =>
        String(p).startsWith("/api/me/follow-cost?player_tag=%232PP0V90Y"),
      ),
    ).toBe(true);
  });

  test("two letters read nothing, however long they sit", async () => {
    const fetch = respond();
    renderWithProviders(<SearchSheet me={{ claims: [] }} onClose={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: /Search players/, hidden: true }),
      { target: { value: "ab" } },
    );
    await new Promise((r) => setTimeout(r, 650));
    // The roster is the one read of opening the sheet; typing added none.
    const reads = fetch.mock.calls
      .filter(([p]) => String(p).startsWith("/api/explore"))
      .map(([, i]) => JSON.parse(i.body).tool);
    expect(reads.filter((t) => t !== "clans_roster")).toEqual([]);
  });
});
