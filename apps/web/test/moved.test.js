import { describe, expect, test } from "vitest";
import { movedTo } from "../src/lib/moved.js";
import { legalRoute } from "../src/App.jsx";

// Every address mail and Discord posts carry today: each resolves where it
// is, with no forward. packages/mail, packages/syndication, Clan and
// services/email-relay emit these; one that stops resolving is a dead link.
const SENT = [
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
  "/home/player/20JJJ2CCRU",
  "/signin",
  "/clan/J2RGCRVG/feed",
  "/clan/J2RGCRVG/war",
  "/clan/J2RGCRVG/war/136-2",
  "/clan/J2RGCRVG/members",
  "/clan/J2RGCRVG/members/away",
  "/clan/J2RGCRVG/standings",
];

describe("the addresses that forward", () => {
  test.each([
    ["/clan/J2RGCRVG", "/clan/J2RGCRVG/feed"],
    ["/clan/J2RGCRVG/", "/clan/J2RGCRVG/feed"],
    ["/clan/j2rgcrvg", "/clan/j2rgcrvg/feed"],
    // An Action with no number, as Clan's Discord posts link it.
    ["/clan/J2RGCRVG/actions", "/clan/J2RGCRVG/feed"],
    ["/clan/J2RGCRVG/actions/", "/clan/J2RGCRVG/feed"],
  ])("%s goes to %s", (from, to) => {
    expect(movedTo(from)).toBe(to);
    expect(movedTo(to)).toBeNull();
    expect(legalRoute(to)).toBe(to);
  });

  test.each(SENT)("what Elixir sends, %s, resolves where it is", (path) => {
    expect(movedTo(path)).toBeNull();
    expect(legalRoute(path)).toBe(path);
  });

  test("Clan's own pages and a page that is not a clan stay put", () => {
    for (const path of [
      "/clan",
      "/clan/directory",
      "/clan/verify",
      "/clan/you/away",
      "/clan/J2RGCRVG/run/actions",
    ])
      expect(movedTo(path), path).toBeNull();
  });

  // Jamie, 2026-11-13: "It is fine to break url support." The old Console,
  // Ladder, Explore and Clan tab addresses no longer forward.
  test.each([
    "/console",
    "/console/account/profile",
    "/console/explore/player/20JJJ2CCRU",
    "/console/admin/feedback",
    "/ladder",
    "/ladder/decks",
    "/home/timeline",
    "/home/friends",
    "/clan/feedback",
    "/clan/J2RGCRVG/season",
    "/clan/J2RGCRVG/today",
    "/data/service",
  ])("the old %s no longer forwards", (path) => {
    expect(movedTo(path)).toBeNull();
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
    for (const path of ["/home/nope", "/settings/nope", "/console/account"])
      expect(legalRoute(path)).toBeNull();
  });
});
