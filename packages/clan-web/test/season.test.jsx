import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { seasonReport } from "@elixir-mcp/clan-engine";
import { seasonRecordFixture } from "@elixir-mcp/clan-engine/fixtures";
import { renderWithProviders } from "./helpers.jsx";
import { Season } from "../src/views/Season.jsx";
import { manageApi } from "../src/api.js";
import { analyticsLocation } from "../src/analytics.js";
import { railItems, railKey } from "../src/lib/rail.js";
import { parseClanPath } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "member" };
const answer = () => {
  const f = seasonRecordFixture();
  return {
    ok: true,
    status: 200,
    data: {
      clan_tag: clan.clan_tag,
      clan_name: clan.name,
      as_of: f.part.meta.as_of,
      freshness_seconds: 300,
      ...seasonReport(f.part, f),
    },
  };
};

test("season shows recorded totals, former-member scope and missing readings", async () => {
  vi.spyOn(manageApi, "season").mockResolvedValue(answer());
  renderWithProviders(<Season clan={clan} season="136" navigate={vi.fn()} />);
  await screen.findByRole("heading", { name: "Season 136" });
  const tiles = screen.getByRole("group", { name: "Recorded season totals" });
  expect(tiles.textContent).toContain("84");
  expect(tiles.textContent).toContain("18,100");
  expect(tiles.textContent).toContain("Each player counted once");
  expect(screen.getByText(/2 current and 1 former/)).toBeTruthy();
  expect(screen.getByText(/Missing readings are unknown/)).toBeTruthy();
  expect(screen.getByText("Closed · partial record")).toBeTruthy();
  expect(screen.getByRole("table").textContent).toContain("Partial readings");
  expect(screen.getByRole("table").textContent).not.toMatch(
    /inactive|win rate|donations|battles/i,
  );
});

test("season switching uses a deep URL and the same cached bounded read", async () => {
  const read = vi.spyOn(manageApi, "season").mockResolvedValue(answer());
  const navigate = vi.fn();
  const { rerender } = renderWithProviders(
    <Season clan={clan} season={null} navigate={navigate} />,
  );
  await screen.findByRole("heading", { name: "Season 137" });
  fireEvent.change(screen.getByRole("combobox", { name: "Season" }), {
    target: { value: "136" },
  });
  expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/season/136");
  rerender(<Season clan={clan} season="136" navigate={navigate} />);
  await screen.findByRole("heading", { name: "Season 136" });
  expect(read).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("link", { name: "The week ›" }).getAttribute("href"),
  ).toBe("/clan/2PQRJ8LV/week");
});

test("season outside the bounded read has an honest return link", async () => {
  vi.spyOn(manageApi, "season").mockResolvedValue(answer());
  renderWithProviders(<Season clan={clan} season="100" navigate={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "outside this read",
  );
  expect(
    screen.getByRole("link", { name: "Current season" }).getAttribute("href"),
  ).toBe("/clan/2PQRJ8LV/season");
});

test("season access refusal and unavailable read never show statistics", async () => {
  const read = vi.spyOn(manageApi, "season").mockResolvedValue({
    ok: false,
    status: 403,
    data: { error: "not_your_clan" },
  });
  renderWithProviders(<Season clan={clan} season={null} navigate={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "does not allow",
  );
  expect(
    screen.queryByRole("group", { name: "Recorded season totals" }),
  ).toBeNull();
  cleanup();
  read.mockResolvedValue({
    ok: false,
    status: 502,
    data: { error: "elixir_unavailable" },
  });
  renderWithProviders(<Season clan={clan} season={null} navigate={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "did not answer",
  );
});

test("season rail, routing and measurement use the existing member boundary", () => {
  const items = railItems({
    ok: true,
    clans: [clan],
    selected: { ...clan, verified: false },
    policy: { set: false },
  });
  expect(items.find((i) => i.key === "season").to).toBe(
    "/clan/2PQRJ8LV/season",
  );
  expect(items.findIndex((i) => i.key === "season")).toBe(
    items.findIndex((i) => i.key === "week") + 1,
  );
  expect(railKey("/clan/2PQRJ8LV/season/136")).toBe("season");
  expect(parseClanPath("/clan/2PQRJ8LV/season/136").section).toBe("season");
  expect(
    analyticsLocation("/clan/2PQRJ8LV/season/136", "https://elixir.test").path,
  ).toBe("/clan/season");
});
