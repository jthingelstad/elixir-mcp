/**
 * The first-use steps as events (#508): adding a player, and the first read
 * landing while Home's steps are open. Each is a count with no value: never
 * which player, account or tag. Their delivery in a session that began at
 * sign-in is pinned in analytics.test.js; this pins when they are sent.
 */
import { test, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";

const trackEvent = vi.fn();
vi.mock("../src/analytics.js", () => ({
  trackEvent: (...a) => trackEvent(...a),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original()),
  useNavigate: () => () => {},
}));
const answer = { data: undefined };
vi.mock("../src/hooks/useFirstAnswer.js", () => ({
  useFirstAnswer: () => ({ data: answer.data }),
}));

const { NewAccount } = await import("../src/home/NewAccount.jsx");

const player = {
  player_tag: "#2PP0V90Y",
  name: "Test player",
  recording_status: "active",
  profile_available: false,
  battles_30d: 0,
  battles_7d: 0,
};
const first = (p) => ({ ok: true, player: p, connection: null, clan: null });

beforeEach(() => {
  cleanup();
  trackEvent.mockClear();
  answer.data = undefined;
  global.fetch = vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify({ ok: true }),
  }));
});

test("adding a player sends home.player_added, with no value", async () => {
  renderWithProviders(<NewAccount first={first(null)} />);
  fireEvent.change(screen.getByLabelText("Your player tag"), {
    target: { value: player.player_tag },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(trackEvent).toHaveBeenCalled());
  expect(trackEvent.mock.calls).toEqual([["home.player_added"]]);
});

test("a first read landing while the page is open sends home.first_read_landed once", () => {
  const view = renderWithProviders(<NewAccount first={first(player)} />);
  expect(trackEvent).not.toHaveBeenCalled();
  answer.data = first({ ...player, profile_available: true });
  view.rerender(<NewAccount first={first(player)} />);
  view.rerender(<NewAccount first={first(player)} />);
  expect(trackEvent.mock.calls).toEqual([["home.first_read_landed"]]);
});

test("a page that opens with the read already landed sends nothing", () => {
  renderWithProviders(
    <NewAccount first={first({ ...player, profile_available: true })} />,
  );
  expect(trackEvent).not.toHaveBeenCalled();
});
