// @vitest-environment node
import { test, expect } from "vitest";
import { renderApp } from "../src/entry-server.jsx";

test("signed-out deep links and redirect roots render complete documents without window", async () => {
  const me = { ok: true, status: 200, data: { authenticated: false } };
  for (const [url, expected] of [
    ["/ladder", "Your season, read back"],
    ["/console/account/overview", "Sign in first"],
    ["/console", "Sign in first"],
  ]) {
    const html = await renderApp({ url, me });
    expect(html, url).toContain(expected);
    expect(html, url).toContain("not endorsed by Supercell");
    expect(html, url).not.toContain("<!--$!-->");
  }
});

test("sign-in and signup render useful forms on the server", async () => {
  const me = { ok: true, status: 200, data: { authenticated: false } };
  const login = await renderApp({ url: "/console/signin", me });
  const signup = await renderApp({ url: "/console/signin?signup", me });
  expect(login).toContain('type="email"');
  expect(login).toContain("Sign in");
  expect(signup).toContain("player");
  expect(login).toContain("not endorsed by Supercell");
});
test("concurrent server renders never share session query data", async () => {
  const [one, two] = await Promise.all(
    ["FictionalAlpha", "FictionalBeta"].map((name) =>
      renderApp({
        url: "/console/account/overview",
        me: {
          ok: true,
          status: 200,
          data: {
            authenticated: true,
            email: `${name}@example.test`,
            features: { clan_internal: true },
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

test("every Console section can render a signed-in initial document without a browser", async () => {
  const { SECTIONS } = await import("../src/App.jsx");
  const me = {
    ok: true,
    status: 200,
    data: {
      authenticated: true,
      email: "fictional@example.test",
      is_admin: true,
      is_owner: true,
      features: { clan_internal: true },
      claims: [],
      recordings: [],
      signals: {},
    },
  };
  for (const [section, spec] of Object.entries(SECTIONS)) {
    for (const page of spec.pages) {
      const url = `/console/${section}/${page.slug}`;
      const html = await renderApp({
        url,
        me,
        renderedAt: Date.UTC(2026, 9, 13, 12),
      });
      expect(html, url).toContain("not endorsed by Supercell");
    }
  }
  for (const url of [
    "/console/explore",
    "/console/account/activity/requests?tool=players_summary",
    "/console/account/activity/e/fictional?report=1",
    "/console/account/feedback?send_id=fictional",
  ]) {
    const html = await renderApp({ url, me });
    expect(html, url).toContain("not endorsed by Supercell");
  }
});
