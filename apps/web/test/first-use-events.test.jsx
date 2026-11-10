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
vi.mock("../src/hooks/useFirstAnswer.js", async (original) => ({
  ...(await original()),
  useFirstAnswer: () => ({ data: answer.data }),
}));

const { NewAccount } = await import("../src/home/NewAccount.jsx");
const { useFirstRead } = await import("../src/home/first-read.js");

/** Home's Today tab in small: the shared first read, then steps or Today. */
function Home({ first }) {
  const read = useFirstRead(first);
  return read.ready ? (
    <p>Today is drawn</p>
  ) : (
    <NewAccount first={read.live} answer={read.answer} landed={read.ready} />
  );
}

const player = {
  player_tag: "#2PP0V90Y",
  name: "Test player",
  recording_status: "active",
  profile_available: false,
  battles_30d: 0,
  battles_7d: 0,
};
const first = (p) => ({
  ok: true,
  as_of: new Date().toISOString(),
  player: p,
  connection: null,
  clan: null,
});

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

const READ = "2026-11-09T01:56:27Z";

test("a first read landing while the page is open sends home.first_read_landed once", () => {
  const view = renderWithProviders(<Home first={first(player)} />);
  expect(trackEvent).not.toHaveBeenCalled();
  answer.data = first({
    ...player,
    profile_available: true,
    battlelog_observed_at: READ,
  });
  view.rerender(<Home first={first(player)} />);
  view.rerender(<Home first={first(player)} />);
  expect(trackEvent.mock.calls).toEqual([["home.first_read_landed"]]);
});

test("a page that opens with the read already landed sends nothing", () => {
  renderWithProviders(
    <Home
      first={first({
        ...player,
        profile_available: true,
        battlelog_observed_at: READ,
      })}
    />,
  );
  expect(trackEvent).not.toHaveBeenCalled();
});

// 2026-11-09, a production walk: the tag added was already on record as an
// opponent (one battle, from another player's log). That battle drew Today
// with "Battle log read: never", and the page never read again.
test("an opponent stub's battle is not the first read: the steps wait, then the read lands once", () => {
  const stub = {
    ...player,
    tracked_since: new Date().toISOString(),
    last_battle_at: "2026-11-02T18:00:00Z",
    battles_30d: 1,
  };
  const view = renderWithProviders(<Home first={first(stub)} />);
  expect(screen.queryByText("Today is drawn")).toBeNull();
  expect(
    screen.getByText(/usually arrive within a minute; at busy times/),
  ).toBeTruthy();
  // No "1 battle on record." while the player's own log is unread.
  expect(screen.queryByText(/on record\./)).toBeNull();
  // The profile lands first: still waiting.
  answer.data = first({ ...stub, profile_available: true });
  view.rerender(<Home first={first(stub)} />);
  expect(screen.queryByText("Today is drawn")).toBeNull();
  expect(trackEvent).not.toHaveBeenCalled();
  // The battle log lands.
  answer.data = first({
    ...stub,
    profile_available: true,
    battlelog_observed_at: READ,
    battles_30d: 6,
  });
  view.rerender(<Home first={first(stub)} />);
  view.rerender(<Home first={first(stub)} />);
  expect(screen.getByText("Today is drawn")).toBeTruthy();
  expect(trackEvent.mock.calls).toEqual([["home.first_read_landed"]]);
});

test("past the fast window, a stub's record draws Today rather than waiting on", () => {
  renderWithProviders(
    <Home
      first={first({
        ...player,
        tracked_since: "2026-11-01T00:00:00Z",
        last_battle_at: "2026-11-02T18:00:00Z",
        battles_30d: 1,
      })}
    />,
  );
  expect(screen.getByText("Today is drawn")).toBeTruthy();
});

test("the First read step says what is true now: profile and battles, usually within a minute (2026-11-09)", () => {
  const before = renderWithProviders(<NewAccount first={first(null)} />);
  expect(
    screen.getByText(
      "Elixir reads your profile and your last 30 battles, usually within a minute.",
    ),
  ).toBeTruthy();
  before.unmount();
  renderWithProviders(<NewAccount first={first(player)} />);
  expect(
    screen.getByText(
      /Your profile and roughly your last 30 battles usually arrive within a minute; at busy times it can take a few\./,
    ),
  ).toBeTruthy();
  // useFirstAnswer: every 5 s for three minutes, then every minute.
  expect(
    screen.getByText(/checks again every few seconds for the first minutes/),
  ).toBeTruthy();
  expect(screen.queryByText(/within a few minutes/)).toBeNull();
});
