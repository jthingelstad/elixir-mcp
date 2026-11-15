import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { api, manageApi } from "../../src/clan/api.js";

// Leaflet draws on a laid-out page; the test's document has no layout.
// Everything it is asked to do is recorded instead.
const drawn = [];
vi.mock("leaflet", () => {
  const chain = (kind, args) => {
    const self = {
      addTo: () => (drawn.push([kind, ...args]), self),
      bindPopup: () => self,
      setView: () => self,
      clearLayers: () =>
        drawn.splice(0, drawn.length, ...drawn.filter(([k]) => k !== "pin")),
      fitBounds: () => self,
      remove: () => {},
    };
    return self;
  };
  const L = {
    map: () => chain("map", []),
    tileLayer: (url) => chain("tiles", [url]),
    layerGroup: () => chain("group", []),
    circleMarker: (at) => chain("pin", [at]),
    latLngBounds: (points) => points,
  };
  return { default: L };
});
vi.mock("leaflet/dist/leaflet.css", () => ({}));

const { ClanMap } = await import("../../src/clan/views/ClanMap.jsx");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  drawn.splice(0);
});

const clan = { clan_tag: "#0QC8RCGY", name: "Example Clan", role: "member" };
const austin = {
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
};
const mapBody = (entries) => ({
  clan_tag: "#0QC8RCGY",
  members: 12,
  on_map: entries.length,
  entries,
  yours: null,
  attribution:
    "Places from GeoNames (geonames.org, CC BY 4.0). Map © OpenStreetMap contributors.",
});

describe("clan map", () => {
  test("members on the map by country, with local time; you are asked to add yourself", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: mapBody([
        {
          player_tag: "#0RJL",
          name: "Ben",
          role: "member",
          role_label: "Member",
          you: false,
          place: austin,
        },
      ]),
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    renderWithProviders(<ClanMap clan={clan} />);
    await screen.findByText(/1 of 12 members on the map/);
    expect(screen.getByText(/United States · 1/)).toBeTruthy();
    expect(screen.getByText(/Ben · Member · Austin, Texas ·/)).toBeTruthy();
    await screen.findByText("Add yourself to the map");
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeTruthy();
    await waitFor(() =>
      expect(drawn.some(([kind]) => kind === "pin")).toBe(true),
    );
    expect(drawn.find(([kind]) => kind === "tiles")?.[1]).toMatch(
      /tile\.openstreetmap\.org/,
    );
  });

  test("the picker offers the country's regions, then its cities, and saves the ids", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: mapBody([]),
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    const saved = vi
      .spyOn(api, "setMyPlace")
      .mockResolvedValue({ ok: true, status: 200, data: { place: austin } });
    renderWithProviders(<ClanMap clan={clan} />);
    const country = await screen.findByLabelText("Country");
    await waitFor(() =>
      expect(country.querySelectorAll("option").length).toBeGreaterThan(200),
    );
    fireEvent.change(country, { target: { value: "US" } });
    const region = await screen.findByLabelText("State or region");
    fireEvent.change(region, { target: { value: "TX" } });
    const city = await screen.findByLabelText(/City/);
    fireEvent.change(city, { target: { value: "4671654" } });
    fireEvent.click(screen.getByText("Add me"));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        country: "US",
        region: "TX",
        city: 4671654,
        player_map: true,
      }),
    );
  });

  test("a new place says who sees it and can stay on clan maps only (#768)", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: { members: 1, on_map: 0, entries: [], attribution: "" },
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    const saved = vi.spyOn(api, "setMyPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        place: { country: "AW", country_name: "Aruba", player_map: false },
      },
    });
    renderWithProviders(<ClanMap clan={clan} />);
    const wide = await screen.findByRole("radio", {
      name: /My clan maps, the player map and Near you/,
    });
    expect(wide.checked).toBe(true);
    expect(
      screen.getByText(
        /anyone signed in to\s+Elixir looking for players near them/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /My clan maps only/ }));
    const country = await screen.findByLabelText("Country");
    await waitFor(() =>
      expect(country.querySelectorAll("option").length).toBeGreaterThan(200),
    );
    fireEvent.change(country, { target: { value: "AW" } });
    fireEvent.click(await screen.findByText("Add me"));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        country: "AW",
        region: null,
        city: null,
        player_map: false,
      }),
    );
  });

  test("a place saved before the choice asks once and is never widened by a change (#768)", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: { members: 1, on_map: 0, entries: [], attribution: "" },
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        place: {
          country: "AW",
          country_name: "Aruba",
          region: null,
          city: null,
          precision: "country",
          player_map: null,
        },
      },
    });
    const join = vi.spyOn(api, "setPlayerMap").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: { country: "AW", player_map: true } },
    });
    renderWithProviders(<ClanMap clan={clan} />);
    await screen.findByText("New: the player map");
    expect(screen.getByText(/stays on your clan maps only/)).toBeTruthy();
    // Changing the place keeps it on clan maps only unless they choose.
    fireEvent.click(screen.getByRole("button", { name: "Change your place" }));
    const clanOnly = await screen.findByRole("radio", {
      name: /My clan maps only/,
    });
    expect(clanOnly.checked).toBe(true);
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Join the player map" }),
    );
    await waitFor(() => expect(join).toHaveBeenCalledWith(true));
  });

  test("on the player map, the place says so and can leave it, keeping the place (#768)", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: { members: 1, on_map: 0, entries: [], attribution: "" },
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        place: {
          country: "AW",
          country_name: "Aruba",
          precision: "country",
          player_map: true,
        },
      },
    });
    const leave = vi.spyOn(api, "setPlayerMap").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: { country: "AW", player_map: false } },
    });
    const clear = vi.spyOn(api, "clearMyPlace");
    renderWithProviders(<ClanMap clan={clan} />);
    await screen.findByText("On your clan maps, the player map and Near you.");
    fireEvent.click(
      screen.getByRole("button", { name: "Leave the player map" }),
    );
    await waitFor(() => expect(leave).toHaveBeenCalledWith(false));
    expect(clear).not.toHaveBeenCalled();
  });

  test("turned off by the clan's leaders, the map says so", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "social_off" },
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    renderWithProviders(<ClanMap clan={clan} />);
    await screen.findByText(/turned the member map off/);
  });
});
