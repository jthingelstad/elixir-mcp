/**
 * Find's Near you and the player map (#768, Jamie 2026-11-14): people on
 * the player map in your region, each with where as a fact and a Follow,
 * never ranked; a reader with no place is asked to set one; a reader on
 * clan maps only is told so and can join. Invented players only.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
import "./warm-routes.js";

configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: false,
  role: "member",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#0GVJ9V",
      name: "Birch Lantern",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  recordings: [],
  signals: {},
};
const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const NEAR = {
  ok: true,
  place: { name: "Austin", region_name: "Texas", on_map: true },
  people: [
    {
      tag: "#0VJLRY",
      name: "Invented austin",
      why: [{ kind: "near", place_name: "Austin" }],
      free: true,
      reason: null,
    },
    {
      tag: "#0VJLR8",
      name: "Invented houston",
      why: [{ kind: "near", place_name: "Houston" }],
      free: false,
      reason: null,
    },
  ],
  truncated: false,
  used: 1,
  limit: 10,
};
const MAP = {
  ok: true,
  entries: [
    {
      player_tag: "#0VJLRY",
      name: "Invented austin",
      you: false,
      place: {
        country: "US",
        country_name: "United States",
        region: "TX",
        region_name: "Texas",
        city: 4671654,
        city_name: "Austin",
        precision: "city",
        lat: 30.27,
        lng: -97.74,
        tz: "America/Chicago",
      },
    },
  ],
  on_map: 1,
  truncated: false,
  attribution: "Places from GeoNames. Map © OpenStreetMap contributors.",
};

let near, calls;
beforeEach(() => {
  cleanup();
  near = NEAR;
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    calls.push([init?.method ?? "GET", p, init?.body ?? null]);
    if (p === "/api/me") return reply(ME);
    if (p === "/api/me/people/near") return reply(near);
    if (p === "/api/me/player-map") return reply(MAP);
    if (p === "/api/clan/me/place/player-map")
      return reply({ place: { player_map: true } });
    return reply({});
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const openNear = async () => {
  window.history.pushState({}, "", "/home/find");
  render(<App />);
  fireEvent.click(await screen.findByRole("tab", { name: "Near you" }));
};

test(
  "Near you lists who plays in your region, each with where and a Follow, then the player map",
  { timeout: 20000 },
  async () => {
    await openNear();
    await screen.findByText("Plays near you, in Austin");
    expect(screen.getByText("Plays near you, in Houston")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Follow/ }).length).toBe(2);
    expect(
      screen.getByText(/People on the player map in Texas\. Your city first/),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Never ranked.");
    // No score, trophies or distance on a row.
    expect(document.body.textContent).not.toMatch(/trophies|km|miles/i);
    await screen.findByText(/1 player is on the player map\./);
    expect(screen.getByText(/Places from GeoNames/)).toBeTruthy();
  },
);

test(
  "a reader with no place is asked to set one",
  { timeout: 20000 },
  async () => {
    near = { ok: true, place: null, people: [] };
    await openNear();
    const set = await screen.findByRole("link", { name: "Set your place" });
    expect(set.getAttribute("href")).toBe("/settings/profile#place");
    expect(screen.queryByText(/Plays near you/)).toBeNull();
  },
);

test(
  "a reader on clan maps only is told so, and can join the player map",
  { timeout: 20000 },
  async () => {
    near = { ...NEAR, place: { ...NEAR.place, on_map: false } };
    await openNear();
    await screen.findByText(/on your clan maps only, so players near you/);
    fireEvent.click(
      screen.getByRole("button", { name: "Join the player map" }),
    );
    await waitFor(() =>
      expect(calls).toContainEqual([
        "PUT",
        "/api/clan/me/place/player-map",
        JSON.stringify({ player_map: true }),
      ]),
    );
  },
);

test("with nobody near, it says so by region", { timeout: 20000 }, async () => {
  near = { ...NEAR, people: [] };
  await openNear();
  await screen.findByText("Nobody in Texas is on the player map yet.");
});
