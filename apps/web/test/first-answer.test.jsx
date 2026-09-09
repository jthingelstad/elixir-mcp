import { test, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { FirstAnswer } from "../src/components/FirstAnswer.jsx";
import { App } from "../src/App.jsx";

const connection = {
  active_connections: 0,
  successful_data_calls_7d: 0,
  data_read_days_7d: 0,
  last_data_read_at: null,
};
const player = {
  player_tag: "#2PP0V90Y",
  name: "Test player",
  recording_status: "active",
  profile_available: false,
  profile_observed_at: null,
  battlelog_observed_at: null,
  battles_30d: 0,
  battles_7d: 0,
  battles_previous_7d: 0,
  distinct_decks_7d: 0,
};
function respond(p = player, c = connection) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        as_of: "2026-09-08T23:00:00Z",
        player: p,
        connection: c,
      }),
  }));
}
beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  respond();
});

test("account journey: add a player, capture arrives, copy a question, open personal connections", async () => {
  let added = false;
  let captured = false;
  const copy = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: copy },
    configurable: true,
  });
  global.fetch = vi.fn(async (path, init = {}) => {
    let data;
    switch (path) {
      case "/api/me":
        data = {
          authenticated: true,
          role: "member",
          timezone: "UTC",
          claims: added
            ? [{ player_tag: player.player_tag, is_primary: true }]
            : [],
          recordings: [],
        };
        break;
      case "/api/me/clans":
        data = { clans: [] };
        break;
      case "/api/me/connections":
        data = { connections: [] };
        break;
      case "/api/claims":
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body).player_tag).toBe(player.player_tag);
        added = true;
        data = { ok: true };
        break;
      case "/api/me/first-answer":
        data = {
          player: added ? { ...player, profile_available: captured } : null,
          connection,
        };
        break;
      default:
        throw new Error(`unmocked request: ${path}`);
    }
    return { ok: true, text: async () => JSON.stringify(data) };
  });
  window.history.pushState({}, "", "/account/overview");
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add your player", exact: true }),
  );
  const input = document.getElementById("add-player-tag");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: player.player_tag } });
  fireEvent.click(input.parentElement.querySelector("button"));
  await screen.findByText("Waiting for the first capture");
  captured = true;
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Copy question: Start with your player snapshot",
    }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain(player.player_tag);
  fireEvent.click(
    screen.getByRole("button", { name: "Connect your client", exact: true }),
  );
  await screen.findByText("Connected clients");
  expect(window.location.pathname).toBe("/account/connections");
});

test("no player leads to the add-player field, not an empty history question", async () => {
  respond(null);
  render(
    <>
      <input id="add-player-tag" aria-label="Player tag" />
      <FirstAnswer claimsKey="" navigate={vi.fn()} />
    </>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Add your player" }),
  );
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
});

test("waiting capture can connect now and refresh into a profile-only question", async () => {
  const navigate = vi.fn();
  render(<FirstAnswer claimsKey="a" navigate={navigate} />);
  await screen.findByText("Waiting for the first capture");
  fireEvent.click(screen.getByRole("button", { name: "Connect your client" }));
  expect(navigate).toHaveBeenCalledWith("/account/connections");
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
  respond({
    ...player,
    profile_available: true,
    profile_observed_at: "2026-09-08T20:00:00Z",
  });
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Start with your player snapshot");
  expect(screen.getAllByRole("button", { name: /Copy question/ })).toHaveLength(
    1,
  );
  expect(screen.queryByText("Compare your decks")).toBeNull();
});

test("questions follow observed samples; successful reads are not claimed to be answers", async () => {
  respond(
    {
      ...player,
      battles_30d: 8,
      battles_7d: 5,
      battles_previous_7d: 3,
      distinct_decks_7d: 2,
    },
    {
      ...connection,
      active_connections: 1,
      successful_data_calls_7d: 2,
      data_read_days_7d: 2,
      last_data_read_at: "2026-09-08T21:00:00Z",
    },
  );
  const copy = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: copy },
    configurable: true,
  });
  render(<FirstAnswer claimsKey="a" navigate={vi.fn()} />);
  await screen.findByText("Compare your decks");
  await screen.findByText("Compare two recorded weeks");
  expect(
    screen.getByText(/2 successful data reads on 2 UTC days/),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Copy question: Review your recorded battles",
    }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain("#2PP0V90Y");
  expect(copy.mock.calls[0][0]).toContain("coverage");
  expect(copy.mock.calls[0][0]).toContain("last 7 days");
  expect(global.fetch).toHaveBeenCalledTimes(1); // copying does not record fake use
});

test("old history does not unlock recent comparisons, and clipboard refusal has a manual fallback", async () => {
  respond({ ...player, battles_30d: 2 });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    configurable: true,
  });
  render(<FirstAnswer claimsKey="a" navigate={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Copy question: Review your recorded battles",
    }),
  );
  const manual = await screen.findByRole("textbox", {
    name: "Question to copy",
  });
  expect(manual.value).toContain("last 30 days");
  expect(screen.queryByText("Compare your decks")).toBeNull();
  expect(screen.queryByText("Compare two recorded weeks")).toBeNull();
});

test("a failed readiness request explains itself and can retry", async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
  render(<FirstAnswer claimsKey="a" navigate={vi.fn()} />);
  await screen.findByText(/Could not check your recorded data/);
  respond();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Waiting for the first capture");
});

test("older retained battles are useful history, not a pending first capture", async () => {
  respond({ ...player, last_battle_at: "2026-07-01T00:00:00Z" });
  render(<FirstAnswer claimsKey="a" navigate={vi.fn()} />);
  await screen.findByRole("button", {
    name: "Copy question: Review your retained history",
  });
  expect(screen.queryByText("Waiting for the first capture")).toBeNull();
  expect(
    screen.getByRole("button", { name: "View the recorded data" }),
  ).toBeTruthy();
});

test("changing primary discards old suggestions even when the earlier request arrives late", async () => {
  let resolve;
  global.fetch = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(<FirstAnswer claimsKey="old" navigate={vi.fn()} />);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  respond(null);
  view.rerender(<FirstAnswer claimsKey="new" navigate={vi.fn()} />);
  await screen.findByRole("button", { name: "Add your player" });
  resolve({
    ok: true,
    text: async () => JSON.stringify({ player, connection }),
  });
  await waitFor(() =>
    expect(screen.queryByText("Waiting for the first capture")).toBeNull(),
  );
});
