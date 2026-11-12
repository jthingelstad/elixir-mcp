import { describe, expect, test } from "vitest";
import { REDIRECTS, movedTo } from "../src/lib/moved.js";
import { legalRoute } from "../src/App.jsx";

const MAP = [
  ["/console", "/home"],
  ["/console/account", "/home"],
  ["/console/account/overview", "/home"],
  ["/console/account/profile", "/settings/profile"],
  ["/console/account/profile/email", "/settings/emails"],
  ["/console/account/profile/devices", "/settings/sign-ins"],
  ["/console/account/activity/events", "/settings/sign-ins"],
  ["/console/account/activity/emails", "/settings/emails/sent"],
  ["/console/account/activity/requests", "/settings/usage/requests"],
  ["/console/account/tracking", "/settings/players"],
  ["/console/account/verify", "/settings/players/verify"],
  ["/console/account/usage", "/settings/usage"],
  ["/console/account/connections", "/settings/connections"],
  ["/console/account/agents", "/settings/connections"],
  ["/console/account/feedback", "/settings/feedback"],
  ["/console/agent", "/settings/connections"],
  ["/console/data", "/data"],
  ["/console/data/dashboard", "/data"],
  ["/console/account/timeline", "/home"],
  ["/console/account/activity", "/home"],
  ["/home/timeline", "/home"],
  ["/home/friends", "/home/find"],
  ["/console/signin", "/signin"],
  ["/data/service", "/data"],
  ["/console/status", "/data"],
  ["/console/status/service", "/data"],
  ["/console/status/collectors", "/data"],
  ["/console/status/efficiency", "/settings/admin/efficiency"],
  ["/console/admin", "/settings/admin/requests"],
];

// Every address mail can carry, today or from the archive. packages/mail,
// services/jobs and services/email-relay emit these; an address here that
// stops resolving is a dead link in somebody's inbox.
const MAIL_MOVED = [
  ["/console/account/profile/email", "/settings/emails"],
  ["/console/account/activity/emails", "/settings/emails/sent"],
  ["/console/account/activity/e/abc123", "/settings/emails/abc123"],
  ["/console/account/activity/c/abc123", "/settings/usage/requests/abc123"],
  ["/console/account/tracking", "/settings/players"],
  ["/console/account/tracking/2PQRJ8LV", "/settings/players/2PQRJ8LV"],
  ["/console/account/timeline", "/home"],
  ["/home/timeline", "/home"],
  ["/home/friends", "/home/find"],
  ["/console/account/feedback/42", "/settings/feedback/42"],
  ["/console/account/verify", "/settings/players/verify"],
  ["/console/account/connections", "/settings/connections"],
  ["/console/account/usage", "/settings/usage"],
  ["/console/account/profile", "/settings/profile"],
  // Ladder became Stats under You (2026-11-12); mail's Ladder links land
  // on the same page there, their ?player= and ?season= riding along.
  ["/ladder", "/home/you/stats"],
  ["/ladder/decks", "/home/you/stats/decks"],
  ["/ladder/cards", "/home/you/stats/cards"],
  ["/ladder/days", "/home/you/stats/battles"],
  // The Console folded (2026-11-12): the fleet is credited on the public
  // status page, one collector is Settings', staff alerts open Admin there.
  ["/console/status/collectors/Knight", "/settings/collectors/Knight"],
  ["/console/admin/feedback", "/settings/admin/feedback"],
  ["/console/admin/feedback/7", "/settings/admin/feedback/7"],
  ["/console/admin/emails/s1", "/settings/admin/emails/s1"],
  // Explore folded (2026-11-12): a player's record is their page, a clan's
  // its own address (Clan, or the directory for anyone not in it), a war
  // week that week of the clan's War tab.
  ["/console/explore/player/%232PQRJ8LV", "/home/player/2PQRJ8LV"],
  ["/console/explore/clan/%23Q8G0LVPY", "/clan/Q8G0LVPY/feed"],
  ["/console/explore/week/2026-W40", "/clan"],
  ["/console/explore/week/J2RGCRVG~136~2", "/clan/J2RGCRVG/war/136-3"],
];
const MAIL_STAYS = [
  "/settings/collectors",
  "/settings/emails/s1",
  "/settings/feedback/7",
  "/clan/J2RGCRVG/actions/12",
  "/home/you/stats",
  "/home/you/stats/decks",
  "/settings/emails",
  "/settings/players",
  "/home/find",
  "/home/you",
  "/signin",
  "/clan/J2RGCRVG/feed",
  "/clan/J2RGCRVG/war",
  "/clan/J2RGCRVG/members",
  "/clan/J2RGCRVG/members/2PQRJ8LV",
];

// An agent's old console, page by page, with what each became.
const AGENT_MOVED = [
  ["/console/agent/a1", "/settings/agents/a1/overview"],
  ["/console/agent/a1/overview", "/settings/agents/a1/overview"],
  ["/console/agent/a1/timeline", "/settings/agents/a1/timeline"],
  ["/console/agent/a1/tracking", "/settings/agents/a1/reads"],
  ["/console/agent/a1/activity", "/settings/agents/a1/usage/requests"],
  ["/console/agent/a1/activity/requests", "/settings/agents/a1/usage/requests"],
  ["/console/agent/a1/activity/events", "/settings/agents/a1/usage/events"],
  ["/console/agent/a1/activity/c/x1", "/settings/agents/a1/usage/requests/x1"],
  ["/console/agent/a1/usage", "/settings/agents/a1/usage"],
  ["/console/agent/a1/connections", "/settings/agents/a1/connections"],
  ["/console/agent/a1/settings", "/settings/agents/a1/settings"],
  ["/console/agent/a1/feedback", "/settings/agents/a1/feedback"],
  ["/console/agent/a1/feedback/7", "/settings/agents/a1/feedback/7"],
];

describe("the map of moved addresses", () => {
  test("is exactly this list", () => {
    expect(Object.entries(REDIRECTS).sort()).toEqual([...MAP].sort());
  });

  test.each(MAP)("%s goes to %s", (from, to) => {
    expect(movedTo(from)).toBe(to);
    expect(movedTo(`${from}/`)).toBe(to);
  });

  test("every target is a page the app resolves, in one hop", () => {
    for (const to of Object.values(REDIRECTS)) {
      expect(movedTo(to), to).toBeNull();
      // The charts moved onto the site: its document, which the app loads.
      if (to !== "/data") expect(legalRoute(to), to).toBe(to);
    }
  });

  test.each(MAIL_MOVED)("mail's %s lands on %s", (from, to) => {
    expect(movedTo(from)).toBe(to);
    expect(movedTo(to)).toBeNull();
    expect(legalRoute(to)).toBe(to);
  });

  test.each(AGENT_MOVED)("an agent's %s goes to %s", (from, to) => {
    expect(movedTo(from)).toBe(to);
    expect(movedTo(to)).toBeNull();
    expect(legalRoute(to)).toBe(to);
  });

  test("the rest of the account's old addresses", () => {
    expect(movedTo("/console/account/agents/acct1")).toBe(
      "/settings/agents/acct1",
    );
    expect(movedTo("/console/status/collectors/new")).toBe(
      "/settings/collectors/new",
    );
    // Discord's two old homes: the hash decides, and only on Connections.
    expect(movedTo("/console/account/connections", "#timeline-discord")).toBe(
      "/settings/connections/discord",
    );
    expect(movedTo("/console/account/connections", "#other")).toBe(
      "/settings/connections",
    );
  });

  test("Settings' own pages stay put, Admin's among them", () => {
    for (const path of [
      "/settings/collectors",
      "/settings/collectors/Knight",
      "/settings/emails/s1",
      "/settings/feedback/7",
      "/settings/admin/requests",
      "/settings/admin/service",
      "/settings/admin/fleet",
      "/settings/admin/efficiency",
    ])
      expect(movedTo(path), path).toBeNull();
  });

  test("every Admin address moved under Settings, its record with it", () => {
    for (const [from, to] of [
      ["/console/admin/requests", "/settings/admin/requests"],
      ["/console/admin/accounts/acct-1", "/settings/admin/accounts/acct-1"],
      ["/console/admin/discord/k1", "/settings/admin/discord/k1"],
      ["/console/admin/service-tokens", "/settings/admin/service-tokens"],
    ]) {
      expect(movedTo(from), from).toBe(to);
      expect(legalRoute(to), to).toBe(to);
    }
    // A page Admin never had lands on its first page.
    expect(legalRoute("/settings/admin/not-a-page")).toBe(
      "/settings/admin/requests",
    );
    expect(legalRoute("/settings/admin")).toBe("/settings/admin/requests");
  });

  test("no old Console address is a dead link", () => {
    for (const path of [
      "/console/status/not-a-page",
      "/console/not-a-place",
      "/console/status/collectors/Knight/extra",
    ]) {
      const to = movedTo(path);
      expect(to, path).not.toBeNull();
      expect(legalRoute(to), path).not.toBeNull();
    }
  });

  test("an address that stays put is not in it", () => {
    for (const path of ["/home", "/signin", ...MAIL_STAYS])
      expect(movedTo(path), path).toBeNull();
  });

  test.each(MAIL_STAYS)("mail's %s still resolves", (path) => {
    expect(legalRoute(path)).toBe(path);
  });

  test("Clan's old list of Actions, in mail from the archive, goes to the Feed", () => {
    expect(movedTo("/clan/J2RGCRVG/actions")).toBe("/clan/J2RGCRVG/feed");
  });

  // Clan as one view (slice 8, #766): the five tabs' addresses, in mail and
  // in Discord posts already sent, each land on the tab that replaced it.
  test.each([
    ["/clan/J2RGCRVG", "/clan/J2RGCRVG/feed"],
    ["/clan/J2RGCRVG/today", "/clan/J2RGCRVG/feed"],
    ["/clan/J2RGCRVG/today/decided", "/clan/J2RGCRVG/run/decided"],
    ["/clan/J2RGCRVG/season", "/clan/J2RGCRVG/war"],
    ["/clan/J2RGCRVG/season/2026-W45", "/clan/J2RGCRVG/war/2026-W45"],
    ["/clan/J2RGCRVG/season/136", "/clan/J2RGCRVG/war/136"],
    ["/clan/J2RGCRVG/awards", "/clan/J2RGCRVG/standings"],
    ["/clan/J2RGCRVG/awards/136", "/clan/J2RGCRVG/standings/136"],
  ])("Clan's %s goes to %s", (from, to) => {
    expect(movedTo(from)).toBe(to);
    expect(legalRoute(to)).toBe(to);
  });

  // Explore, page by page, with where each landed.
  test.each([
    ["/console/explore", "/home/find"],
    ["/console/explore/players", "/home/find"],
    ["/console/explore/clans", "/home/find"],
    ["/console/explore/player", "/home/find"],
    ["/console/explore/player/2PQRJ8LV", "/home/player/2PQRJ8LV"],
    ["/console/explore/profile/%232PQRJ8LV", "/home/player/2PQRJ8LV"],
    ["/console/explore/player/not a tag!", "/home/find"],
    ["/console/explore/clan", "/clan/directory"],
    ["/console/explore/clan/J2RGCRVG", "/clan/J2RGCRVG/feed"],
    ["/console/explore/clan/not a tag!", "/clan/directory"],
    ["/console/explore/week/J2RGCRVG~136", "/clan/J2RGCRVG/war/136"],
    ["/console/explore/weeks", "/clan"],
    ["/console/explore/week/J2RGCRVG~x~2", "/clan/J2RGCRVG/war"],
    ["/console/explore/meta", "/home/you/stats/decks"],
    ["/console/explore/deck/abc123", "/home/you/stats/decks"],
    ["/console/explore/list/battles:2PQRJ8LV", "/home/player/2PQRJ8LV"],
    ["/console/explore/list/decks:2PQRJ8LV", "/home/player/2PQRJ8LV"],
    ["/console/explore/list/deckbattles:abc", "/home/you/stats/decks"],
    ["/console/explore/list/members:J2RGCRVG", "/clan/J2RGCRVG/members"],
    ["/console/explore/list/weeks:J2RGCRVG", "/clan/J2RGCRVG/war"],
    ["/console/explore/not-a-page", "/home/find"],
  ])("Explore's %s goes to %s", (from, to) => {
    expect(movedTo(from)).toBe(to);
    expect(movedTo(to)).toBeNull();
    expect(legalRoute(to)).toBe(to);
  });

  test("a battle's record is its own page", () => {
    expect(movedTo("/console/explore/battle/0123456789abcdef")).toBe(
      "/battle/0123456789abcdef",
    );
    expect(movedTo("/console/explore/battle/nope")).toBe("/home");
  });

  test("an account page that no longer exists goes Home", () => {
    expect(movedTo("/console/account/not-a-page")).toBe("/home");
  });

  test("Settings' partial addresses open their page", () => {
    expect(legalRoute("/settings")).toBe("/settings/profile");
    expect(legalRoute("/settings/agents")).toBe("/settings/connections");
    expect(legalRoute("/settings/agents/a1")).toBe(
      "/settings/agents/a1/overview",
    );
    expect(legalRoute("/settings/not-a-page")).toBeNull();
  });

  test("an address that was never a page is the app's missing page", () => {
    for (const path of ["/home/nope", "/settings/nope"])
      expect(legalRoute(path)).toBeNull();
  });
});
