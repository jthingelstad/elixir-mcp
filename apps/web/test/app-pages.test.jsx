// @vitest-environment node
import { test, expect } from "vitest";
import { makeAppPages } from "../../../services/web-api/src/app-pages.mjs";
// The pages load server rendering on the first page, through
// `@elixir-mcp/web/server`: the same module instance as this import
// (measured, #995), so the app's own graph compiles while the file loads.
import "../src/entry-server.jsx";
// The render then awaits router.load, which imports the route's lazy
// chunk: that compile, not the entry's, was the cold cost left inside
// the first rendering test (#995). warm-routes takes it out too.
import "./warm-routes.js";

const request = {
  method: "GET",
  path: "/signin",
  headers: { cookie: "fictional" },
  rawQueryString: "signup",
};
test("native app HTML carries a private, escaped, request-local session bootstrap", async () => {
  const me = {
    authenticated: true,
    email: "</script><script>fictional</script>@example.test",
  };
  const calls = [];
  const dispatch = async (r) => {
    calls.push(r);
    return { statusCode: 200, body: JSON.stringify(me) };
  };
  const page = makeAppPages({
    dispatch,
    shell: async () => '<html><div id="root"></div></html>',
    render: async ({ url }) => `<p>${url}</p>`,
  });
  const response = await page(request, {});
  expect(calls[0]).toMatchObject({
    path: "/api/me",
    method: "GET",
    headers: request.headers,
  });
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.body).toContain("/signin?signup");
  const serialized = response.body.match(
    /id="elixir-bootstrap">(.*?)<\/script>/,
  )[1];
  expect(serialized).not.toContain("<");
  expect(JSON.parse(serialized).me.data).toEqual(me);
});
test("origin refusal and non-app requests never render account HTML", async () => {
  let renders = 0;
  const dispatch = async () => ({
    statusCode: 403,
    body: '{"error":"refused"}',
  });
  const page = makeAppPages({
    dispatch,
    render: () => {
      renders++;
    },
  });
  expect((await page(request, {})).statusCode).toBe(403);
  expect((await page({ ...request, path: "/api/me" }, {})).statusCode).toBe(
    403,
  );
  expect(renders).toBe(0);
});
test("Clan landing has its own context before the browser starts", async () => {
  const page = makeAppPages({
    dispatch: async (r) => ({
      statusCode: 200,
      body: JSON.stringify(
        r.path === "/api/me" ? { authenticated: false } : { signed_in: false },
      ),
    }),
    shell: async () => '<div id="root"></div>',
  });
  const response = await page(
    { ...request, path: "/clan", rawQueryString: "" },
    {},
  );
  expect(response.body).toContain("clan");
  expect(response.body).toContain('"clanMe"');
  expect(response.body).not.toContain("Switched to client rendering");
});

test("a failed server session read keeps the retry page and the 503 status", async () => {
  const page = makeAppPages({
    dispatch: async () => {
      throw new Error("fictional connection failure");
    },
    shell: async () => '<div id="root"></div>',
  });
  const response = await page({ ...request, path: "/settings/profile" }, {});
  expect(response.statusCode).toBe(503);
  expect(response.body).toContain("Try again");
  expect(response.body).not.toContain("Sign in first");
  expect(response.headers["cache-control"]).toBe("private, no-store");
});

test.each(["primary", "clan response", "clan transport"])(
  "a failed %s session read renders the Clan retry page with HTTP 503",
  async (failure) => {
    const calls = [];
    const page = makeAppPages({
      dispatch: async (r) => {
        calls.push(r.path);
        if (r.path === "/api/me" && failure !== "primary")
          return { statusCode: 200, body: '{"authenticated":true}' };
        if (failure === "clan transport")
          throw new Error("fictional Clan connection failure");
        return { statusCode: 503, body: '{"error":"unavailable"}' };
      },
      shell: async () => '<div id="root"></div>',
    });
    const response = await page(
      { ...request, path: "/clan", rawQueryString: "" },
      {},
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    // The app's own unavailable page, which Clan shares.
    expect(response.body).toContain("This page could not be read just now");
    expect(response.body).not.toContain("Sign in first");
    expect(response.body).toContain('"clanMe":{"ok":false,"status":503');
    if (failure === "primary") expect(calls).toEqual(["/api/me"]);
  },
);
