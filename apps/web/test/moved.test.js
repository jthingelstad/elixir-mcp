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
  ["/console/account/timeline", "/home/timeline"],
  ["/console/account/activity", "/home/timeline"],
  ["/console/signin", "/signin"],
  ["/console/status", "/data/service"],
  ["/console/status/service", "/data/service"],
  ["/console/admin", "/console/admin/requests"],
  ["/console/explore/player", "/console/explore"],
  ["/console/explore/clan", "/console/explore"],
  ["/ladder/days", "/ladder/battles"],
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
  ["/console/account/timeline", "/home/timeline"],
  ["/console/account/feedback/42", "/settings/feedback/42"],
  ["/console/account/verify", "/settings/players/verify"],
  ["/console/account/connections", "/settings/connections"],
  ["/console/account/usage", "/settings/usage"],
  ["/console/account/profile", "/settings/profile"],
];
const MAIL_STAYS = [
  "/console/explore/player/%232PQRJ8LV",
  "/console/explore/clan/%23Q8G0LVPY",
  "/console/explore/week/2026-W40",
  "/console/status/collectors",
  "/settings/collectors",
  "/settings/emails/s1",
  "/settings/feedback/7",
  "/clan/J2RGCRVG/actions/12",
  "/ladder",
  "/ladder/decks",
  "/ladder/cards",
  "/settings/emails",
  "/settings/players",
  "/home/timeline",
  "/home/friends",
  "/signin",
  "/console/explore/week/J2RGCRVG~136~2",
  "/clan/J2RGCRVG/today",
  "/clan/J2RGCRVG/season",
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

  test("the public fleet stays at Status; your own is Settings'", () => {
    for (const path of [
      "/console/status/collectors",
      "/settings/collectors",
      "/settings/emails/s1",
      "/settings/feedback/7",
      "/console/status/collectors/Knight",
      "/console/status/efficiency",
    ])
      expect(movedTo(path), path).toBeNull();
  });

  test("an address that stays put is not in it", () => {
    for (const path of ["/home", "/signin", "/data/service", ...MAIL_STAYS])
      expect(movedTo(path), path).toBeNull();
  });

  test.each(MAIL_STAYS)("mail's %s still resolves", (path) => {
    expect(legalRoute(path)).toBe(path);
  });

  test("Clan's old list of Actions, in mail from the archive, goes to Today", () => {
    expect(movedTo("/clan/J2RGCRVG/actions")).toBe("/clan/J2RGCRVG/today");
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

  test("a status page that no longer exists goes to the service page", () => {
    expect(legalRoute("/console/status/not-a-page")).toBe("/data/service");
  });

  test("an address that was never a page is the app's missing page", () => {
    for (const path of ["/console/not-a-place", "/home/nope"])
      expect(legalRoute(path)).toBeNull();
  });
});
