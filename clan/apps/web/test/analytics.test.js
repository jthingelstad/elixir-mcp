import { describe, expect, test } from "vitest";
import { analyticsLocation, routeLabel } from "../src/analytics.js";

describe("analytics", () => {
  test("pages collapse the clan and the item into attributes", () => {
    const o = "https://elixir.poapkings.com";
    expect(analyticsLocation("/clan", o)).toEqual({
      path: "/clan",
      url: `${o}/clan`,
    });
    expect(analyticsLocation("/clan/", o).path).toBe("/clan");
    expect(analyticsLocation("/clan/2PQRJ8LV", o)).toEqual({
      path: "/clan",
      url: `${o}/clan?clan=%232PQRJ8LV`,
    });
    expect(analyticsLocation("/clan/2pqrj8lv/manage/board", o).url).toBe(
      `${o}/clan/manage/board?clan=%232PQRJ8LV`,
    );
    expect(analyticsLocation("/clan/2PQRJ8LV/actions/37", o)).toEqual({
      path: "/clan/actions/detail",
      url: `${o}/clan/actions/detail?clan=%232PQRJ8LV&id=37`,
    });
    expect(analyticsLocation("/clan/2PQRJ8LV/actions", o).path).toBe(
      "/clan/actions",
    );
    expect(analyticsLocation("/clan/feedback/abc123", o)).toEqual({
      path: "/clan/feedback",
      url: `${o}/clan/feedback?id=abc123`,
    });
    expect(analyticsLocation("/clan/maintain/feedback/x", o)).toEqual({
      path: "/clan/maintain/feedback",
      url: `${o}/clan/maintain/feedback?id=x`,
    });
    expect(analyticsLocation("/clan/you/away", o).path).toBe("/clan/you/away");
  });

  test("the app's own pages are never a clan", () => {
    const o = "https://elixir.poapkings.com";
    for (const page of ["clans", "you", "verify", "feedback", "maintain"]) {
      expect(analyticsLocation(`/clan/${page}`, o)).toEqual({
        path: `/clan/${page}`,
        url: `${o}/clan/${page}`,
      });
    }
    expect(analyticsLocation("/clan/refused/no_clan", o).url).toBe(
      `${o}/clan/refused/no_clan`,
    );
  });

  test("route labels mask tags and ids under /api/clan", () => {
    expect(routeLabel("GET", "/api/clan/clans/2PQRJ8LV/manage?refresh=1")).toBe(
      "GET /api/clan/clans/*/manage",
    );
    expect(
      routeLabel("POST", "/api/clan/clans/2PQRJ8LV/actions/abc/decide"),
    ).toBe("POST /api/clan/clans/*/actions/*/decide");
    expect(routeLabel("GET", "/api/clan/feedback/abc")).toBe(
      "GET /api/clan/feedback/*",
    );
    expect(routeLabel("POST", "/api/clan/maintain/feedback/abc")).toBe(
      "POST /api/clan/maintain/feedback/*",
    );
    expect(routeLabel("GET", "/api/clan/roster?clan=%232PQRJ8LV")).toBe(
      "GET /api/clan/roster",
    );
  });
});
