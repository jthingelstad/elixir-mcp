/**
 * Home's side and welcome as the design canvas of 2026-11-13 draws them:
 * the digest chosen in place with the same write Settings makes, the
 * welcome steps one line each with the count at the right, and the race's
 * place on the clan card while a war day runs. Invented names only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomePanels } from "../src/home/Today.jsx";
import { digestChoice, digestWhen } from "../src/home/logic.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const PLAYER = { player_tag: "#00JQ20", name: "Invented One", verified: true };
const CLAN = {
  ok: true,
  state: "member",
  clan_tag: "#0QC8RCGY",
  name: "Ada's Clan",
  role: "member",
  race_now: {
    season_id: 140,
    section_index: 1,
    is_colosseum: false,
    day_kind: "war",
    war_day: 2,
    finished: false,
    place: 2,
    fame: 8400,
  },
  needs: [],
  needs_total: 0,
};

let writes;
beforeEach(() => {
  writes = [];
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path).split("?")[0];
    if (init?.method === "PUT") {
      writes.push([p, JSON.parse(init.body)]);
      return reply({ kind: "tracking_report" });
    }
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    return reply({});
  });
});
afterEach(() => cleanup());

const first = (welcome) => ({ player: PLAYER, welcome });

test("the digest's lit choice is the person's own, else weekly", () => {
  expect(digestChoice(null)).toBe("weekly");
  expect(digestChoice({ enabled: true, cadence: "daily" })).toBe("daily");
  expect(digestChoice({ enabled: false, cadence: "daily" })).toBe("off");
  expect(digestWhen("weekly")).toBe("once a week");
});

test("choosing the digest on Home makes Settings' write, Off included", async () => {
  renderWithProviders(
    <HomePanels
      first={first({ following: 2, digest: null })}
      player={PLAYER}
      feed={null}
    />,
  );
  const group = await screen.findByRole("group", {
    name: "How often your digest comes",
  });
  const weekly = screen.getByRole("button", { name: "Weekly" });
  expect(weekly.getAttribute("aria-pressed")).toBe("true");
  expect(group.closest("section").textContent).toContain("once a week");
  // The lit default saves too: that is how a person chooses it.
  fireEvent.click(weekly);
  await waitFor(() => expect(writes).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Off" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toEqual([
    [
      "/api/me/email",
      { kind: "tracking_report", cadence: "weekly", enabled: true },
    ],
    ["/api/me/email", { kind: "tracking_report", enabled: false }],
  ]);
  expect(screen.getByText(/Your feed is still here/)).toBeTruthy();
});

test("the welcome is one line a step, its count at the head's right", async () => {
  renderWithProviders(
    <HomePanels
      first={first({ following: 0, digest: null })}
      player={PLAYER}
      feed={null}
    />,
  );
  const head = await screen.findByRole("heading", {
    name: "Welcome to Elixir, 2 of 4 done",
  });
  expect(head.querySelector(".kit-welcome__count").textContent).toBe(
    "2 of 4 done",
  );
  const rows = [...document.querySelectorAll(".kit-check")];
  expect(rows.map((r) => r.querySelector("h3").textContent)).toEqual([
    "Add your player",
    "Verify it’s you",
    "Follow a few people",
    "Choose your digest",
  ]);
  const find = screen.getByRole("link", { name: "Find people" });
  expect(find.textContent).toBe("Find");
  expect(find.getAttribute("href")).toBe("/home/find");
  expect(screen.getByRole("link", { name: "Choose your digest" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Verify/ })).toBeNull();
});

test("the clan card draws the race's place while a war day runs", async () => {
  renderWithProviders(
    <HomePanels
      first={first({ following: 2, digest: { enabled: true } })}
      player={PLAYER}
      feed={null}
    />,
  );
  const bar = await screen.findByRole("img", { name: "Second of five clans" });
  expect(bar.className).toContain("kit-racebar--p2");
});
