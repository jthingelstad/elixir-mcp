/**
 * The bar's Help: what the page is, where to read more, and a note that
 * carries the page. Stored `console` is what reads as Elixir.
 */
import { test, expect, afterEach, vi } from "vitest";
import { helpFor } from "../src/shell/help.js";
import { DOC_LINKS } from "../src/shell/doc-links.js";
import { SETTINGS_RAIL } from "../src/lib/settings.js";

afterEach(() => vi.unstubAllGlobals());

test("every place has its own words and a read-more that exists", () => {
  const places = [
    "/home",
    "/home/friends",
    "/ladder",
    "/ladder/battles",
    "/clan",
    "/console/explore",
    "/console/status",
    "/console/admin/accounts",
    "/data/service",
    ...SETTINGS_RAIL.map((r) => r.to),
  ];
  for (const path of places) {
    const help = helpFor(path);
    expect(help.lines.length, path).toBeGreaterThan(0);
    expect(DOC_LINKS[help.docs], `${path} ${help.docs}`).toBeTruthy();
  }
});

test("a note files under its product; the rest stay under the stored console", () => {
  expect(helpFor("/ladder").area).toBe("ladder");
  expect(helpFor("/clan").area).toBe("clan");
  expect(helpFor("/settings/profile").area).toBe("console");
  expect(helpFor("/home").area).toBe("console");
});
