// @vitest-environment node
import { test, expect } from "vitest";
import { renderApp } from "../src/entry-server.jsx";
// #995: the first renderApp awaits router.load, which imports the route's
// lazy chunk. Cold, that chunk compiled inside the first test (1 to 5 s at
// load 35 to 50, measured; past 20 s in a crowded verify). Imported here
// the chunks compile while the file loads, and every render is warm.
import "./warm-routes.js";

test("signed-out deep links and redirect roots render complete documents without window", async () => {
  const me = { ok: true, status: 200, data: { authenticated: false } };
  for (const [url, expected] of [
    ["/home/you/stats", "Your season, read back"],
    ["/settings/profile", "Sign in first"],
    ["/settings", "Sign in first"],
  ]) {
    const html = await renderApp({ url, me });
    expect(html, url).toContain(expected);
    expect(html, url).toContain("not endorsed by Supercell");
    expect(html, url).not.toContain("<!--$!-->");
  }
});

// #759, DECISIONS "Everyone signs in; shared posts stay public": a
// signed-out visit to any page of the record is the sign-in-or-join wall
// (Stats says what it is first, then the same way in), never the page.
test("every record page signed out renders the sign-in wall, never the page", async () => {
  const me = { ok: true, status: 200, data: { authenticated: false } };
  const urls = [
    "/home",
    "/settings",
    "/settings/admin/accounts",
    "/home/find",
    "/home/player/0QC8RCGY",
    "/home/player/0QC8RCGY?tab=record",
    // Clan's pages are the app's: the same wall, not a page of their own.
    "/clan",
    "/clan/directory",
    "/clan/0QC8RCGY/feed",
  ];
  for (const url of urls) {
    const html = await renderApp({ url, me });
    expect(html, url).toContain("Sign in first");
    expect(html, url).toContain("create an account");
    expect(html, url).not.toContain("Nothing at this address");
  }
  const stats = await renderApp({ url: "/home/you/stats/battles", me });
  expect(stats).toContain("Your season, read back");
});

test("sign-in and signup render useful forms on the server", async () => {
  const me = { ok: true, status: 200, data: { authenticated: false } };
  const login = await renderApp({ url: "/signin", me });
  const signup = await renderApp({ url: "/signin?signup", me });
  expect(login).toContain('type="email"');
  expect(login).toContain("Sign in");
  expect(signup).toContain("player");
  expect(login).toContain("not endorsed by Supercell");
});
test("concurrent server renders never share session query data", async () => {
  const [one, two] = await Promise.all(
    ["FictionalAlpha", "FictionalBeta"].map((name) =>
      renderApp({
        url: "/settings/profile",
        me: {
          ok: true,
          status: 200,
          data: {
            authenticated: true,
            email: `${name}@example.test`,
            features: {},
            signals: {},
          },
        },
      }),
    ),
  );
  expect(one).toContain("FictionalAlpha");
  expect(one).not.toContain("FictionalBeta");
  expect(two).toContain("FictionalBeta");
  expect(two).not.toContain("FictionalAlpha");
});

test("Find, the player page and Settings render a signed-in initial document without a browser", async () => {
  const me = {
    ok: true,
    status: 200,
    data: {
      authenticated: true,
      email: "fictional@example.test",
      is_admin: true,
      is_owner: true,
      features: {},
      claims: [],
      recordings: [],
      signals: {},
    },
  };
  for (const url of [
    "/home/find",
    "/home/player/0QC8RCGY?tab=record",
    "/settings/usage/requests?tool=players_summary",
    "/settings/emails/fictional?report=1",
    "/settings/feedback?send_id=fictional",
  ]) {
    const html = await renderApp({ url, me });
    expect(html, url).toContain("not endorsed by Supercell");
  }
});

// The clan map loads Leaflet, which needs a browser, as a lazy view. A lazy
// view in renderToString aborts its boundary, and the browser then reports
// React #419 on every visit. The server draws the map's waiting line instead.
test("the clan map renders on the server without aborting a boundary", async () => {
  const me = {
    ok: true,
    status: 200,
    data: {
      authenticated: true,
      email: "fictional@example.test",
      features: {},
      claims: [],
      recordings: [],
      signals: {},
    },
  };
  const clan = { clan_tag: "#0QC8RCGY", name: "Example Clan", role: "member" };
  const clanMe = {
    ok: true,
    status: 200,
    data: { ok: true, clans: [clan], selected: clan },
  };
  const html = await renderApp({
    url: "/clan/0QC8RCGY/members/map",
    me,
    clanMe,
  });
  expect(html).toContain("not endorsed by Supercell");
  expect(html).toContain("Reading");
  expect(html).not.toContain("<!--$!-->");
});
