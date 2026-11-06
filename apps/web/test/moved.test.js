import { describe, expect, test } from "vitest";
import { REDIRECTS, movedTo } from "../src/lib/moved.js";
import { legalRoute } from "../src/App.jsx";

const MAP = [
  ["/console", "/home"],
  ["/console/account", "/home"],
  ["/console/account/overview", "/home"],
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
const MAIL_STAYS = [
  "/console/account/profile/email",
  "/console/explore/player/%232PQRJ8LV",
  "/console/explore/clan/%23Q8G0LVPY",
  "/console/explore/week/2026-W40",
  "/console/account/activity/emails",
  "/console/account/activity/e/abc123",
  "/console/account/tracking",
  "/console/status/collectors",
  "/console/account/feedback/42",
  "/clan/J2RGCRVG/actions",
  "/ladder",
  "/ladder/decks",
  "/ladder/cards",
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
      expect(legalRoute(to), to).toBe(to);
    }
  });

  test("an address that stays put is not in it", () => {
    for (const path of ["/home", "/signin", "/data/service", ...MAIL_STAYS])
      expect(movedTo(path), path).toBeNull();
  });

  test.each(MAIL_STAYS)("mail's %s still resolves", (path) => {
    expect(legalRoute(path)).toBe(path);
  });

  test("an account page that no longer exists goes Home", () => {
    expect(legalRoute("/console/account/not-a-page")).toBe("/home");
  });

  test("a status page that no longer exists goes to the service page", () => {
    expect(legalRoute("/console/status/not-a-page")).toBe("/data/service");
  });

  test("an address that was never a page is the app's missing page", () => {
    for (const path of ["/console/not-a-place", "/home/nope"])
      expect(legalRoute(path)).toBeNull();
  });
});
