/**
 * test/warm-routes.js imports exactly the chunks the route tables load
 * lazily. A route chunk it missed would compile inside a whole-App test's
 * first wait again; one it still names after a route is gone would fail
 * every file that imports it.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");

function lazyRouteChunks(file) {
  const text = readFileSync(path.join(web, file), "utf8");
  return [
    ...text.matchAll(/lazyRouteComponent\(\s*\(\)\s*=>\s*import\("([^"]+)"\)/g),
  ].map((m) => path.resolve(path.dirname(path.join(web, file)), m[1]));
}

test("warm-routes imports every lazy route chunk, and nothing else", () => {
  const routes = new Set([
    ...lazyRouteChunks("src/App.jsx"),
    ...lazyRouteChunks("src/clan/routes.jsx"),
  ]);
  const warm = readFileSync(path.join(web, "test/warm-routes.js"), "utf8");
  const warmed = new Set(
    [...warm.matchAll(/^import "([^"]+)";$/gm)].map((m) =>
      path.resolve(web, "test", m[1]),
    ),
  );
  expect(routes.size).toBeGreaterThan(5);
  expect([...warmed].sort()).toEqual([...routes].sort());
});
