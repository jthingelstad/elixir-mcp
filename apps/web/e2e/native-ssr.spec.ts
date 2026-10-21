import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LAMBDAS,
  esbuildOptions,
  repoRoot,
} from "../../../infra/scripts/build.mjs";
import { ME, SIGNED_OUT, signedIn, mockApi } from "./fixtures.ts";

let server: Server;
let dir: string;
let origin: string;
test.beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "elixir-native-ssr-"));
  // The web-api Lambda's own options (split, lucide-react's ES modules),
  // with app-pages.mjs as the entry, so the journeys render what ships.
  const webApi = LAMBDAS.find((l) => l.name === "web-api")!;
  await build(
    esbuildOptions(
      { ...webApi, entry: "services/web-api/src/app-pages.mjs" },
      dir,
    ),
  );
  const outfile = path.join(dir, "index.mjs");
  const { makeAppPages } = await import(pathToFileURL(outfile).href);
  const pages = makeAppPages({
    shell: () => readFile(path.join(repoRoot, "dist/site/app.html"), "utf8"),
    dispatch: async (request: {
      path: string;
      headers: Record<string, string>;
    }) => ({
      statusCode: request.path === "/api/clan/me" ? 401 : 200,
      body: JSON.stringify(
        request.path === "/api/clan/me"
          ? { error: "signed_out" }
          : request.headers["x-fixture-out"] === "1"
            ? SIGNED_OUT
            : { ...ME, timezone: null },
      ),
    }),
  });
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://fixture.test");
      if (url.pathname.startsWith("/assets/")) {
        const body = await readFile(
          path.join(repoRoot, "dist/site", url.pathname),
        );
        res.setHeader(
          "content-type",
          url.pathname.endsWith(".js")
            ? "application/javascript"
            : url.pathname.endsWith(".css")
              ? "text/css"
              : "application/octet-stream",
        );
        res.end(body);
        return;
      }
      const signedOut =
        url.pathname.includes("signin") ||
        url.pathname.startsWith("/clan") ||
        url.pathname.startsWith("/ladder") ||
        url.pathname === "/console";
      const response = await pages(
        {
          method: "GET",
          path: url.pathname,
          rawQueryString: url.search.slice(1),
          headers: { "x-fixture-out": signedOut ? "1" : "0" },
        },
        {},
      );
      res.writeHead(response.statusCode, response.headers);
      res.end(response.body);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing fixture listener");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

test("@narrow native production HTML hydrates with session, clock and browser preferences intact", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://tinylytics.app/**", (route) =>
    route.fulfill({ body: "" }),
  );
  await mockApi(
    page,
    signedIn({ "GET /api/me": [200, { ...ME, timezone: null }] }),
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      "elixir-recent",
      JSON.stringify([
        {
          href: "/console/explore/player/20JJJ2CCRU",
          tag: "#20JJJ2CCRU",
          name: "Fictional recent player",
          kind: "player",
        },
      ]),
    ),
  );
  const meRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/me") meRequests.push(r.url());
  });
  for (const route of [
    "/ladder",
    "/console",
    "/console/account/overview",
    "/console/account/tracking",
    "/console/account/connections",
    "/console/account/activity/requests?tool=players_summary",
    "/console/explore",
    "/console/signin?signup",
    "/clan",
  ]) {
    const document = await request.get(origin + route);
    expect(document.status(), route).toBe(200);
    expect(document.headers()["cache-control"]).toBe("private, no-store");
    const html = await document.text();
    expect(html, route).toContain('id="elixir-bootstrap"');
    expect(html, route).toContain("not endorsed by Supercell");
    expect(html, route).not.toContain("<!--$!-->");
    await page.goto(origin + route);
    await expect(page.locator("#elixir-bootstrap")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("failed to render");
    if (route === "/console/explore")
      await expect(page.getByText("Fictional recent player")).toBeVisible();
    if (route.includes("signin"))
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    if (route === "/clan")
      await expect(
        page.getByRole("link", { name: "Sign in with Elixir", exact: true }),
      ).toBeVisible();
    if (route === "/ladder")
      await expect(
        page.getByRole("heading", { name: "Your season, read back" }),
      ).toBeVisible();
    expect(errors, route).toEqual([]);
  }
  expect(meRequests).toEqual([]);
});
