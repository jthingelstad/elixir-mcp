/**
 * What a page view is allowed to say.
 *
 * Two rules, and they pull in opposite directions. /signin never reports at
 * all, because the magic sign-in token rides that URL. Everything else DOES
 * report the record it is about — CR tags are public game identifiers, not
 * personal data, and an earlier version of this file threw them away as if
 * they were. The record belongs in the query string, not the path: it is an
 * attribute of the /explore/player page, not a page of its own.
 */
import { describe, test, expect } from "vitest";
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
