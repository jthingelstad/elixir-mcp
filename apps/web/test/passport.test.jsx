/**
 * Passport pages (#1015): yours with progress and where to earn, anyone
 * else's with what was earned and when and nothing private, ?stamp= opening
 * one Stamp, loading and a failed read never shown as an empty passport,
 * and the ways in (account menu, You, Profile, a verified player's page).
 * Invented players and passport ids only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  configure,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { App, barArea, titleFor } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
import "../src/pages/SettingsPage.jsx";
import { barAccount } from "../src/shell/Shell.jsx";
import {
  destinationHref,
  earnedMap,
  isPassportPath,
  passportHref,
  passportIdOf,
  RECONCILE_PASSES,
  reconcilePassport,
  summaryOf,
  unitWord,
} from "../src/lib/passport.js";

configure({ asyncUtilTimeout: 5000 });

const MINE = "abcdefghjkmn";
const THEIRS = "pqrstuvwxyz2";

const ME = {
  authenticated: true,
  is_admin: false,
  role: "member",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#0GVJ9V",
      name: "Birch Lantern",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  recordings: [],
};

const progress = (
  stamp_id,
  earned_level,
  count,
  next,
  top,
  unknown = false,
) => ({
  stamp_id,
  earned_level,
  progress: { count, next, top, unknown },
});

const OWN = {
  passport: {
    id: MINE,
    display_name: "Birch Lantern",
    player: {
      tag: "#0GVJ9V",
      name: "Birch Lantern",
      verified: true,
      avatar_card_id: null,
    },
    earned: [
      {
        stamp_id: "player_verified",
        level: 1,
        earned_on: "2026-11-01",
        earned_before: null,
      },
      {
        stamp_id: "looking_good",
        level: 1,
        earned_on: null,
        earned_before: "2026-10-01",
      },
      {
        stamp_id: "cheerleader",
        level: 1,
        earned_on: "2026-11-05",
        earned_before: null,
      },
    ],
  },
  catalog_version: 1,
  owner: {
    profile: { version: 1, complete: false, steps: [] },
    stamps: [
      progress("player_verified", 1, 1, null, 1),
      progress("looking_good", 1, 1, null, 1),
      progress("on_the_map", 0, 0, 1, 1),
      progress("inner_circle", 0, 3, 5, 5, true),
      progress("cheerleader", 1, 7, 15, 50),
    ],
  },
};

const OTHER = {
  passport: {
    id: THEIRS,
    display_name: "Copper Fern",
    player: {
      tag: "#0VJ2QV",
      name: "Copper Fern",
      verified: true,
      avatar_card_id: null,
    },
    earned: [
      {
        stamp_id: "on_the_map",
        level: 1,
        earned_on: "2026-11-03",
        earned_before: null,
      },
    ],
  },
  catalog_version: 1,
};

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let routes;
let asked;
beforeEach(() => {
  cleanup();
  asked = [];
  routes = {
    "/api/me": () => reply(ME),
    "/api/me/passport": () => reply(OWN),
    [`/api/passports/${THEIRS}`]: () => reply(OTHER),
    "/api/me/clans": () =>
      reply({ clans: [], home_clan: { clan_tag: "#0LL2", name: "Grove" } }),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const p = String(path).split("?")[0];
    asked.push(p);
    const route = routes[p];
    return route ? route() : reply({ error: "not_found" }, 404);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

const at = (path) => {
  window.history.pushState({}, "", path);
  render(<App />);
};

test("addresses: yours, anyone's by a well-formed id, and one Stamp's", () => {
  expect(isPassportPath("/home/passport")).toBe(true);
  expect(isPassportPath("/home/passport/")).toBe(true);
  expect(isPassportPath(`/home/account/${MINE}/passport`)).toBe(true);
  expect(isPassportPath("/home/account/not-an-id/passport")).toBe(false);
  expect(isPassportPath("/home/account/abcdefghijkl/passport")).toBe(false); // i, l
  expect(passportIdOf(`/home/account/${THEIRS}/passport`)).toBe(THEIRS);
  expect(passportIdOf("/home/passport")).toBeNull();
  expect(passportHref()).toBe("/home/passport");
  expect(passportHref(null, "cheerleader")).toBe(
    "/home/passport?stamp=cheerleader",
  );
  expect(passportHref(THEIRS)).toBe(`/home/account/${THEIRS}/passport`);
  expect(titleFor("/home/passport")).toBe("Passport - Home - Elixir");
  expect(barArea("/home/passport")).toBe("you");
  expect(barArea(`/home/account/${THEIRS}/passport`)).toBe("find");
});

test("helpers: the highest level each, two latest marks, and where to earn", () => {
  const map = earnedMap([
    { stamp_id: "cheerleader", level: 1, earned_on: "2026-11-01" },
    { stamp_id: "cheerleader", level: 2, earned_on: "2026-11-09" },
    { stamp_id: "no_such_stamp", level: 1, earned_on: "2026-11-09" },
  ]);
  expect([...map.keys()]).toEqual(["cheerleader"]);
  expect(map.get("cheerleader").level).toBe(2);
  expect(summaryOf(OWN.passport)).toEqual({
    id: MINE,
    count: 3,
    marks: [
      { stamp_id: "cheerleader", level: 1 },
      { stamp_id: "player_verified", level: 1 },
    ],
  });
  // The place is the person's: Profile's Your place, picker open.
  expect(destinationHref("map-view")).toBe("/settings/profile#place");
  expect(destinationHref("verification")).toBe("/settings/players/verify");
  expect(unitWord("cheerleader", 1)).toBe("day");
  expect(unitWord("storyteller", 5)).toBe("highlighted battles");
});

test("every account's menu has a Passport link, with or without a player", () => {
  for (const me of [ME, { claims: [] }]) {
    const link = barAccount(me, () => {}).links.find(
      (l) => l.key === "passport",
    );
    expect(link).toMatchObject({ label: "Passport", href: "/home/passport" });
  }
});

test(
  "your passport: groups, earned and unearned in words, and a legacy day",
  { timeout: 20000 },
  async () => {
    at("/home/passport");
    await screen.findByRole("heading", { level: 1, name: "Your passport" });
    await screen.findByText("3 Stamps");
    for (const g of ["Getting started", "Your circle", "Playing together"])
      expect(screen.getByRole("heading", { level: 2, name: g })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Player verified. Earned 1 November 2026.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Looking Good. Earned before 1 October 2026.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Cheerleader I. Earned 5 November 2026.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "On the Map. Optional. Not earned yet.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mutual. Not earned yet." }),
    ).toBeTruthy();
    expect(screen.getByText("3 Stamps")).toBeTruthy();
    const who = document.querySelector(".kit-passport__who");
    expect(
      within(who).getByRole("img", { name: "Verified player" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy passport link" }),
    ).toBeTruthy();
  },
);

test(
  "a Stamp's sheet: the owner's count and where to earn, then focus returns",
  { timeout: 20000 },
  async () => {
    at("/home/passport");
    const tile = await screen.findByRole("button", {
      name: "Cheerleader I. Earned 5 November 2026.",
    });
    tile.focus();
    fireEvent.click(tile);
    const sheet = await screen.findByRole("dialog", {
      name: "Cheerleader I",
      hidden: true,
    });
    expect(window.location.search).toBe("?stamp=cheerleader");
    expect(
      within(sheet).getByText("Your progress: 7 of 15 days."),
    ).toBeTruthy();
    expect(within(sheet).getByText("Level II")).toBeTruthy();
    expect(
      within(sheet).getByText(
        "Totals, not streaks. Earned levels stay earned.",
      ),
    ).toBeTruthy();
    expect(
      within(sheet)
        .getByRole("link", { name: "Open Home", hidden: true })
        .getAttribute("href"),
    ).toBe("/home");
    fireEvent(sheet, new Event("cancel", { cancelable: true }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull(),
    );
    expect(window.location.search).toBe("");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-stamp")).toBe(
        "cheerleader",
      ),
    );
  },
);

test(
  "?stamp= opens one Stamp; On the Map's action opens Your place on Profile",
  { timeout: 20000 },
  async () => {
    at("/home/passport?stamp=on_the_map");
    const sheet = await screen.findByRole("dialog", {
      name: "On the Map",
      hidden: true,
    });
    const action = within(sheet).getByRole("link", { hidden: true });
    await waitFor(() =>
      expect(action.getAttribute("href")).toBe("/settings/profile#place"),
    );
    expect(action.textContent).toBe("Set your place");
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Close", hidden: true }),
    );
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-stamp")).toBe(
        "on_the_map",
      ),
    );
  },
);

test("an unknown ?stamp= opens nothing", { timeout: 20000 }, async () => {
  at("/home/passport?stamp=gold_trophy");
  await screen.findByRole("heading", { level: 1, name: "Your passport" });
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
});

test(
  "another member's passport: dates and rules, no progress, no action, no map",
  { timeout: 20000 },
  async () => {
    at(`/home/account/${THEIRS}/passport?stamp=on_the_map`);
    await screen.findByRole("heading", {
      level: 1,
      name: "Copper Fern’s passport",
    });
    const sheet = await screen.findByRole("dialog", {
      name: "On the Map",
      hidden: true,
    });
    expect(within(sheet).getByText("Earned 3 November 2026.")).toBeTruthy();
    expect(within(sheet).queryByText(/Your progress/)).toBeNull();
    expect(within(sheet).queryByRole("link", { hidden: true })).toBeNull();
    expect(sheet.textContent).toContain("The place is never shown here");
    expect(
      screen.queryByRole("button", { name: "Copy passport link" }),
    ).toBeNull();
    // Reading theirs never reads (and so never makes) the viewer's own.
    expect(asked).not.toContain("/api/me/passport");
  },
);

test(
  "an unverified claim shows no gold, and says so; no player is New player",
  { timeout: 20000 },
  async () => {
    routes[`/api/passports/${THEIRS}`] = () =>
      reply({
        ...OTHER,
        passport: {
          ...OTHER.passport,
          player: { ...OTHER.passport.player, verified: false },
          // Player verified stays earned after the proof lapsed.
          earned: [
            {
              stamp_id: "player_verified",
              level: 1,
              earned_on: "2026-10-20",
              earned_before: null,
            },
          ],
        },
      });
    at(`/home/account/${THEIRS}/passport`);
    await screen.findByText("Player not verified");
    const who = () => document.querySelector(".kit-passport__who");
    expect(
      within(who()).queryByRole("img", { name: "Verified player" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Player verified. Earned 20 October 2026.",
      }),
    ).toBeTruthy();
    cleanup();
    routes[`/api/passports/${THEIRS}`] = () =>
      reply({
        ...OTHER,
        passport: {
          id: THEIRS,
          display_name: "New player",
          player: null,
          earned: [],
        },
      });
    at(`/home/account/${THEIRS}/passport`);
    await screen.findByText("No Stamps earned yet.");
    expect(screen.getByText("New player")).toBeTruthy();
    expect(screen.getByText("Elixir account")).toBeTruthy();
    expect(
      within(who()).queryByRole("img", { name: "Verified player" }),
    ).toBeNull();
  },
);

test(
  "loading is not an empty passport, and a failed read offers Try again",
  { timeout: 20000 },
  async () => {
    let fail = true;
    let release;
    const held = new Promise((r) => (release = r));
    routes["/api/me/passport"] = async () => {
      await held;
      return fail ? reply({ error: "unavailable" }, 503) : reply(OWN);
    };
    at("/home/passport");
    await screen.findByText("Reading the passport…");
    expect(screen.queryByText(/0 Stamps|No Stamps/)).toBeNull();
    release();
    await screen.findByText("This passport could not be read just now");
    expect(screen.queryByText(/0 Stamps|No Stamps/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("3 Stamps");
  },
);

test(
  "a verified player's page shows its owner's passport in one row",
  { timeout: 20000 },
  async () => {
    routes["/api/player"] = () =>
      reply({
        player: {
          tag: "#0VJ2QV",
          name: "Copper Fern",
          clan_tag: null,
          clan_name: null,
          trophies: 7400,
          recorded: true,
        },
        you: {
          own: false,
          following: false,
          relationship: null,
          clanmate: null,
        },
        badges: { verified_player: true, discord: false },
        follows: { count: 0, players: [] },
        followers: { count: 0, players: [] },
        window_days: 30,
        timeline: [],
        timeline_more: 0,
        moments: [],
        highlights: [],
        passport: {
          id: THEIRS,
          count: 4,
          marks: [{ stamp_id: "mutual", level: 1 }],
        },
      });
    at("/home/player/0VJ2QV");
    const open = await screen.findByRole("link", { name: "Open passport" });
    expect(open.getAttribute("href")).toBe(`/home/account/${THEIRS}/passport`);
    expect(screen.getByText("4 Stamps")).toBeTruthy();
  },
);

test(
  "Profile leads with your player and your passport, before the account",
  { timeout: 20000 },
  async () => {
    at("/settings/profile");
    const you = await screen.findByRole("heading", {
      level: 2,
      name: "You in Elixir",
    });
    const account = screen.getByRole("heading", { level: 2, name: "Account" });
    expect(
      you.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const open = await screen.findByRole("link", { name: "Open passport" });
    expect(open.getAttribute("href")).toBe("/home/passport");
    expect(screen.getByText("3 Stamps")).toBeTruthy();
    // The main player fact wears the canonical name and mark.
    const facts = screen
      .getAllByRole("link", { name: /Birch Lantern/ })
      .map((l) => within(l).queryByRole("img", { name: "Verified player" }));
    expect(facts.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  },
);

test(
  "Profile with no player: New player, and a way to add one",
  { timeout: 20000 },
  async () => {
    routes["/api/me"] = () => reply({ ...ME, claims: [] });
    routes["/api/me/passport"] = () =>
      reply({
        ...OWN,
        passport: {
          id: MINE,
          display_name: "New player",
          player: null,
          earned: [],
        },
      });
    at("/settings/profile");
    await screen.findByRole("heading", { level: 2, name: "You in Elixir" });
    expect(screen.getByText("New player")).toBeTruthy();
    await screen.findByText("No Stamps yet");
    expect(
      screen.getAllByRole("link", { name: "Add your player" }).length,
    ).toBeGreaterThan(0);
  },
);

/** The passport header's count, once the header is there. */
const whoSays = async (text) => {
  const who = await waitFor(() => {
    const el = document.querySelector(".kit-passport__who");
    if (!el) throw new Error("no header yet");
    return el;
  });
  return within(who).findByText(text);
};

test("the reconciliation: again while more, three passes at most, quiet on failure", async () => {
  const pass = (granted, more) => ({
    ok: true,
    status: 200,
    data: { ...OWN, granted, more },
  });
  const calls = (answers) => {
    let i = 0;
    const call = vi.fn(async () => {
      const a = answers[Math.min(i, answers.length - 1)];
      i += 1;
      if (a instanceof Error) throw a;
      return a;
    });
    return call;
  };
  const busy = calls([pass([{ stamp_id: "mutual" }], true)]);
  expect(await reconcilePassport(busy)).toEqual({
    read: 3,
    granted: 3,
    done: false,
  });
  expect(busy).toHaveBeenCalledTimes(RECONCILE_PASSES);
  const done = calls([pass([], true), pass([], false)]);
  expect(await reconcilePassport(done)).toEqual({
    read: 2,
    granted: 0,
    done: true,
  });
  expect(done).toHaveBeenCalledTimes(2);
  const refused = calls([{ ok: false, status: 429, data: null }]);
  expect(await reconcilePassport(refused)).toEqual({
    read: 0,
    granted: 0,
    done: false,
  });
  expect(refused).toHaveBeenCalledTimes(1);
  const thrown = calls([new Error("offline")]);
  expect(await reconcilePassport(thrown)).toEqual({
    read: 0,
    granted: 0,
    done: false,
  });
});

test("opening your passport reconciles after it shows, and reads again when a Stamp is granted", async () => {
  let reads = 0;
  const granted = {
    ...OWN,
    passport: {
      ...OWN.passport,
      earned: [
        ...OWN.passport.earned,
        {
          stamp_id: "mutual",
          level: 1,
          earned_on: "2026-11-14",
          earned_before: null,
        },
      ],
    },
  };
  let release;
  const held = new Promise((r) => (release = r));
  routes["/api/me/passport"] = () => {
    reads += 1;
    return reply(reads === 1 ? OWN : granted);
  };
  routes["/api/me/passport/reconcile"] = async () => {
    await held;
    return reply({
      ...granted,
      granted: [{ stamp_id: "mutual" }],
      more: false,
    });
  };
  at("/home/passport");
  // The passport shows before the reconciliation answers.
  expect(await whoSays("3 Stamps")).toBeTruthy();
  expect(asked).toContain("/api/me/passport/reconcile");
  release();
  expect(await whoSays("4 Stamps")).toBeTruthy();
  expect(asked.filter((p) => p === "/api/me/passport/reconcile")).toHaveLength(
    1,
  );
});

test("a reconciliation that grants nothing still reads your progress again", async () => {
  let reads = 0;
  const moved = {
    ...OWN,
    owner: {
      ...OWN.owner,
      stamps: OWN.owner.stamps.map((s) =>
        s.stamp_id === "cheerleader"
          ? progress("cheerleader", 1, 8, 15, 50)
          : s,
      ),
    },
  };
  let release;
  const held = new Promise((r) => (release = r));
  routes["/api/me/passport"] = () => {
    reads += 1;
    return reply(reads === 1 ? OWN : moved);
  };
  routes["/api/me/passport/reconcile"] = async () => {
    await held;
    return reply({ ...moved, granted: [], more: false });
  };
  at("/home/passport?stamp=cheerleader");
  const sheet = await screen.findByRole("dialog", {
    name: "Cheerleader I",
    hidden: true,
  });
  expect(within(sheet).getByText("Your progress: 7 of 15 days.")).toBeTruthy();
  release();
  await waitFor(() =>
    expect(
      within(sheet).getByText("Your progress: 8 of 15 days."),
    ).toBeTruthy(),
  );
  // The bell reads once, with the shell; no grant, so not again.
  expect(asked.filter((p) => p === "/api/me/bell").length).toBeLessThanOrEqual(
    1,
  );
});

test("a failed reconciliation changes nothing on screen, and nobody else's passport reconciles", async () => {
  routes["/api/me/passport/reconcile"] = () =>
    reply({ error: "unavailable" }, 503);
  at("/home/passport");
  expect(await whoSays("3 Stamps")).toBeTruthy();
  await waitFor(() => expect(asked).toContain("/api/me/passport/reconcile"));
  expect(screen.queryByText(/could not be read/)).toBeNull();
  cleanup();
  asked = [];
  at(`/home/account/${THEIRS}/passport`);
  expect(await screen.findByText("1 Stamp")).toBeTruthy();
  expect(asked).not.toContain("/api/me/passport/reconcile");
});

test("a finished reconciliation is not asked again on the next open, until a write that could earn", async () => {
  routes["/api/me/passport/reconcile"] = () =>
    reply({ ...OWN, granted: [], more: false });
  routes["/api/me/cheers"] = () => reply({ ok: true });
  const reconciles = () =>
    asked.filter((p) => p === "/api/me/passport/reconcile").length;
  at("/home/passport");
  expect(await whoSays("3 Stamps")).toBeTruthy();
  await waitFor(() => expect(reconciles()).toBe(1));
  // A second open inside the minute: the passport reads, no new pass.
  cleanup();
  at("/home/passport");
  expect(await whoSays("3 Stamps")).toBeTruthy();
  await new Promise((r) => setTimeout(r, 50));
  expect(reconciles()).toBe(1);
  // A cheer that landed lifts the gate: the next open reconciles.
  const { api } = await import("../src/api.js");
  expect(
    (await api.cheer({ item_id: "item-1", cheer: "fire", subjects: [] })).ok,
  ).toBe(true);
  cleanup();
  at("/home/passport");
  expect(await whoSays("3 Stamps")).toBeTruthy();
  await waitFor(() => expect(reconciles()).toBe(2));
});
