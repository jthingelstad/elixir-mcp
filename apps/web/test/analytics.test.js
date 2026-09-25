/**
 * What a page view is allowed to say.
 *
 * Two rules, and they pull in opposite directions. /signin never reports at
 * all, because the magic sign-in token rides that URL. Everything else DOES
 * report the record it is about — CR tags are public game identifiers, not
 * personal data, and an earlier version of this file threw them away as if
 * they were. The record belongs in the query string, not the path: it is an
 * attribute of the /explore/player page, not a page of its own.
 *
 * The loading half needs a real origin: on localhost this module deliberately
 * does nothing, so a default jsdom URL would make every assertion below pass
 * for the wrong reason.
 *
 * @vitest-environment-options { "url": "https://elixir.poapkings.com/" }
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { analyticsLocation } from "../src/analytics.js";

const ORIGIN = "https://elixir.poapkings.com";
const at = (p) => analyticsLocation(p, ORIGIN);

describe("analyticsLocation", () => {
  test("the sign-in page reports nothing at all", () => {
    expect(at("/signin")).toBeNull();
    expect(at("/signin/code")).toBeNull();
  });

  test("a plain section reports itself", () => {
    expect(at("/account")).toEqual({
      path: "/account",
      url: `${ORIGIN}/account`,
    });
    expect(at("/")).toEqual({ path: "/", url: `${ORIGIN}/` });
  });

  test("a two-segment page keeps both segments", () => {
    expect(at("/data/status")).toEqual({
      path: "/data/status",
      url: `${ORIGIN}/data/status`,
    });
  });

  test("a record id becomes a query parameter, never a page", () => {
    const seen = at("/explore/player/2ABC");
    expect(seen.path).toBe("/explore/player");
    expect(new URL(seen.url).searchParams.get("id")).toBe("2ABC");
  });

  test("a private record (a call, a sent email) reports its kind of page and never its id", () => {
    // Report hygiene: one row per kind of record page, never one per
    // record (docs/ENGINEERING.md, "Product identifiers versus measurement").
    const id = "5c1c5dbf-b0d0-4843-b751-8d6a60e535c7";
    expect(at(`/account/activity/e/${id}`)).toEqual({
      path: "/account/activity/e",
      url: `${ORIGIN}/account/activity/e`,
    });
    expect(at(`/account/activity/c/${id}`)).toEqual({
      path: "/account/activity/c",
      url: `${ORIGIN}/account/activity/c`,
    });
    expect(at(`/admin/emails/${id}`)).toEqual({
      path: "/admin/emails",
      url: `${ORIGIN}/admin/emails`,
    });
    // The lists themselves are ordinary pages.
    expect(at("/account/activity/emails").path).toBe("/account/activity");
    expect(at("/admin/emails").path).toBe("/admin/emails");
  });

  test("an agent's console never reports which agent, and its records report their kind (2026-09-25)", () => {
    const id = "5c1c5dbf-b0d0-4843-b751-8d6a60e535c7";
    expect(at("/agent/a1b2c3d4e5f6/overview")).toEqual({
      path: "/agent/overview",
      url: `${ORIGIN}/agent/overview`,
    });
    expect(at(`/agent/a1b2c3d4e5f6/activity/c/${id}`)).toEqual({
      path: "/agent/activity/c",
      url: `${ORIGIN}/agent/activity/c`,
    });
    expect(at("/agent/a1b2c3d4e5f6").path).toBe("/agent");
  });

  test("feedback, tracked subjects and admin accounts report their page, never the record", () => {
    for (const [path, kind] of [
      ["/account/feedback/812", "/account/feedback"],
      ["/account/tracking/2ABC", "/account/tracking"],
      ["/admin/accounts/42", "/admin/accounts"],
    ]) {
      const seen = at(path);
      expect(seen.path).toBe(kind);
      expect(new URL(seen.url).search).toBe("");
    }
  });

  test("an encoded tag is reported decoded", () => {
    // Explore strips the leading '#' when it builds hrefs, but a bookmark
    // or a hand-typed URL can still carry %23.
    const seen = at("/explore/player/%232ABC");
    expect(new URL(seen.url).searchParams.get("id")).toBe("#2ABC");
  });

  test("a compound record id survives whole", () => {
    const seen = at("/explore/week/2ABC~135~4");
    expect(seen.path).toBe("/explore/week");
    expect(new URL(seen.url).searchParams.get("id")).toBe("2ABC~135~4");
  });

  test("two different records are two different views", () => {
    expect(at("/explore/player/2ABC").url).not.toBe(
      at("/explore/player/9XYZ").url,
    );
  });
});

/**
 * Loading, which is a separate question from what a view SAYS.
 *
 * The embed and the route bridge do different jobs — one records the document
 * load, the other records pushState navigation — and /signin only has a reason
 * to skip the first. When it skipped both, a magic-link session reported
 * nothing at all: the app lands on /signin and pushStates into the console
 * without ever loading another document.
 */
describe("loadTinylytics", () => {
  const SITE_ID = "Yzx8dUUvUPn9AEJpTMeU";
  let pushState;
  let beacons;

  beforeEach(async () => {
    vi.resetModules();
    pushState = window.history.pushState;
    beacons = [];
    Object.defineProperty(window.navigator, "sendBeacon", {
      value: (url) => (beacons.push(url), true),
      configurable: true,
      writable: true,
    });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.history.pushState = pushState;
  });

  const embeds = () =>
    [...document.body.querySelectorAll("script")].map((s) => s.src);

  const load = async (path) => {
    window.history.replaceState({}, "", path);
    const { loadTinylytics } = await import("../src/analytics.js");
    loadTinylytics();
  };

  test("a session that starts on /signin reports every page AFTER it", async () => {
    await load("/signin");
    // The embed reads the address bar as it runs, and the magic token is in it.
    expect(embeds()).toEqual([]);

    window.history.pushState({}, "", "/account/overview");

    expect(beacons).toHaveLength(1);
    const sent = new URL(beacons[0]);
    expect(sent.host).toBe("tinylytics.app");
    expect(sent.pathname).toBe(`/collector/${SITE_ID}`);
    expect(sent.searchParams.get("path")).toBe("/account/overview");
  });

  test("the beacon carries the route, never the address bar", async () => {
    await load("/signin");
    window.history.pushState({}, "", "/account/overview?login_token=secret");
    expect(beacons[0]).not.toContain("secret");
  });

  test("an ordinary start loads the embed and bridges as well", async () => {
    await load("/account/overview");
    expect(embeds()).toEqual([
      `https://tinylytics.app/embed/${SITE_ID}/min.js?hits&countries&events&beacon`,
    ]);

    // The embed already recorded this document; only the NEXT page beacons.
    window.history.pushState({}, "", "/account/usage");
    expect(beacons).toHaveLength(1);
    expect(new URL(beacons[0]).searchParams.get("path")).toBe("/account/usage");
  });

  test("signing out and back in counts the landing page again", async () => {
    await load("/account/overview");
    window.history.pushState({}, "", "/signin");
    expect(beacons).toHaveLength(0);
    window.history.pushState({}, "", "/account/overview");
    expect(beacons).toHaveLength(1);
  });
});

describe("failure events", async () => {
  const { trackEvent } = await import("../src/analytics.js");
  // The label is the family's now (@elixir-mcp/client), pinned there;
  // this checks the console still gets that behaviour through it.
  const { routeLabel } = await import("@elixir-mcp/client");

  test("a route label collapses the id, never the route", () => {
    expect(routeLabel("GET", "/api/admin/calls/abc-123")).toBe(
      "GET /api/admin/calls/*",
    );
    expect(routeLabel("GET", "/api/me/gateways")).toBe("GET /api/me/gateways");
    expect(routeLabel("POST", "/api/explore")).toBe("POST /api/explore");
    // Which agent is never reported (2026-09-25).
    expect(routeLabel("GET", "/api/agent/a1b2c3d4e5f6/usage")).toBe(
      "GET /api/agent/*/*",
    );
  });

  test("an event is one click on a hidden collector node, then gone", () => {
    const clicks = [];
    const onClick = (ev) => {
      const node = ev.target.closest?.("[data-tinylytics-event]");
      if (node)
        clicks.push([
          node.getAttribute("data-tinylytics-event"),
          node.getAttribute("data-tinylytics-event-value"),
        ]);
    };
    document.addEventListener("click", onClick);
    try {
      trackEvent("web.api_timeout", "GET /api/me");
    } finally {
      document.removeEventListener("click", onClick);
    }
    expect(clicks).toEqual([["web.api_timeout", "GET /api/me"]]);
    expect(document.querySelector("[data-tinylytics-event]")).toBeNull();
  });
});
