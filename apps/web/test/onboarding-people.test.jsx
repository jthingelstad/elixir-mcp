import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { NewAccount } from "../src/home/NewAccount.jsx";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original()),
  useNavigate: () => vi.fn(),
}));
vi.mock("../src/analytics.js", () => ({ trackEvent: vi.fn() }));

const people = [
  {
    tag: "#00JRG2RU",
    name: "Amber",
    free: true,
    why: [{ kind: "battles", friendly: 1, against: 1, days: 30 }],
  },
  {
    tag: "#0LJR0G22",
    name: "<b>Birch</b>",
    free: false,
    why: [{ kind: "battles", with_you: 1, days: 30 }],
  },
];
const first = {
  as_of: new Date().toISOString(),
  player: {
    player_tag: "#00092VJ2",
    name: "Invented Player",
    profile_available: true,
    battlelog_observed_at: null,
    recording_status: "active",
    tracked_since: new Date().toISOString(),
    capture_attempts: [],
  },
  clan: null,
};
const reply = (data, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(data),
});
let listed, sent;
beforeEach(() => {
  cleanup();
  listed = [...people];
  sent = [];
  global.fetch = vi.fn(async (path, init = {}) => {
    if (String(path) === "/api/me/people/starter")
      return reply(
        sent.length
          ? { ok: true, offer: false, people: [] }
          : {
              ok: true,
              offer: sent.length === 0,
              people: sent.length ? [] : listed,
              used: 1,
              limit: 50,
            },
      );
    if (String(path).startsWith("/api/me/follow-plan?"))
      return reply({
        to_follow: 1,
        slots: 1,
        free: 0,
        following: 0,
        used: 50,
        limit: 50,
        fits: false,
      });
    if (String(path) === "/api/me/follow-all") {
      const tags = JSON.parse(init.body).player_tags;
      sent.push(tags);
      listed = listed.filter((p) => !tags.includes(p.tag));
      return reply({ ok: true, followed: tags });
    }
    return reply({});
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("recognizable people appear before the player's battle log, while setup stays available", async () => {
  renderWithProviders(<NewAccount first={first} />);
  expect(
    await screen.findByRole("checkbox", { name: "Follow Amber" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("checkbox", { name: "Follow <b>Birch</b>" }),
  ).toBeTruthy();
  expect(document.querySelector(".kit-starter b")).toBeNull();
  expect(document.querySelector("details").open).toBe(false);
  fireEvent.click(screen.getByText("Finish your setup"));
  expect(screen.getByRole("link", { name: "Prove it" })).toBeTruthy();
  expect(sent).toEqual([]);
});

test("a confirmed first follow stays put, preserves an unticked choice, and offers the Timeline", async () => {
  const open = vi.fn();
  renderWithProviders(<NewAccount first={first} onOpenTimeline={open} />);
  const birch = await screen.findByRole("checkbox", {
    name: "Follow <b>Birch</b>",
  });
  fireEvent.click(birch);
  fireEvent.click(screen.getByRole("button", { name: "Follow these (1)" }));
  expect(sent).toEqual([]);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Follow these",
    ),
  );
  await screen.findByText("Your follows are ready.");
  await waitFor(() => expect(sent).toEqual([["#00JRG2RU"]]));
  expect(
    screen.getByRole("checkbox", { name: "Follow <b>Birch</b>" }).checked,
  ).toBe(false);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Follow <b>Birch</b>" }),
  );
  await screen.findByText(/Only 0 of your 50 player slots are left/);
  expect(
    screen.getByRole("button", { name: "Follow these (1)" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Open Timeline" }));
  expect(open).toHaveBeenCalledOnce();
});

test("a refused roster mint offers a retry until its roster arrives", async () => {
  const retry = vi.fn();
  const view = (state) => (
    <NewAccount
      first={first}
      peopleProgress={{
        data: { state, clan: { tag: "#0U082URG", name: "Grove" } },
        request: { data: { queued: false, reason: "unavailable" } },
        retry,
      }}
    />
  );
  const { rerender } = renderWithProviders(view("roster"));
  await screen.findByText("Your clanmates could not be checked just now.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(view("ready"));
  expect(
    screen.queryByText("Your clanmates could not be checked just now."),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});
